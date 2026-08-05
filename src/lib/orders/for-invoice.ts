import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireActiveStaff, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { sendPancakeConversationMessage } from '@/lib/integrations/pancake';
import { renderOrderMessage } from '@/lib/messaging/templates';
import { createClient } from '@/lib/supabase/server';
import type { CustomerMatchInfo } from '@/lib/orders/customer-match-types';

/** Outcome of trying to auto-deliver a message through Pancake (best-effort). */
export type PancakeDelivery = {
  /** true when the customer had a Pancake conversation id and a send was attempted. */
  attempted: boolean;
  delivered: boolean;
  error: string | null;
  /** Raw Pancake response snippet (token stripped) for diagnosing a rejection. */
  debug?: string | null;
};

/**
 * Best-effort deliver a message to the order's customer via Pancake. NEVER throws
 * and never blocks the workflow: if the customer has no Pancake conversation id it
 * is simply skipped; a send failure is reported so the UI can offer a manual send.
 */
async function deliverOrderMessageViaPancake(
  supabase: Awaited<ReturnType<typeof createClient>>,
  officialOrderId: string,
  message: string,
): Promise<PancakeDelivery> {
  try {
    // In a Test Session, NEVER send a real message to a real customer — the message
    // is still recorded (is_test), it is just not delivered through Pancake.
    const { data: tm } = await supabase
      .from('live_test_state')
      .select('active')
      .maybeSingle();
    if ((tm as { active?: boolean } | null)?.active === true) {
      return { attempted: false, delivered: false, error: null };
    }

    const response = (await supabase
      .from('official_orders')
      .select('customers ( pancake_conversation_id )')
      .eq('id', officialOrderId)
      .maybeSingle()) as { data: { customers?: unknown } | null };
    type Cust = { pancake_conversation_id?: string | null };
    const customer = response.data?.customers as Cust | Cust[] | null | undefined;
    const one = Array.isArray(customer) ? customer[0] : customer;
    const conversationId = one?.pancake_conversation_id;
    if (!conversationId || !conversationId.trim()) {
      return { attempted: false, delivered: false, error: null };
    }
    const res = await sendPancakeConversationMessage({
      conversationId: conversationId.trim(),
      message,
    });
    // Record the send result on the order's customer_message (message id + a Sent /
    // Failed status) so the UI can show it and a failure can be retried. Best-effort:
    // it can never change or mask the send outcome.
    try {
      await persistSendOutcome(supabase, officialOrderId, res, message);
    } catch {
      /* recording never affects the actual send */
    }
    return {
      attempted: true,
      delivered: res.ok,
      error: res.ok ? null : res.message,
      debug: res.debug ?? null,
    };
  } catch {
    return { attempted: true, delivered: false, error: 'Pancake delivery failed.', debug: null };
  }
}

/**
 * Save the Pancake send outcome onto the order's single customer_message: the
 * returned message id, a 'direct_sent' / 'direct_send_failed' status, and (on
 * success) who/when. Creates the row if the invoice message was never opened/edited.
 */
async function persistSendOutcome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  officialOrderId: string,
  res: { ok: boolean; pancakeMessageId: string | null },
  message: string,
): Promise<void> {
  const staff = await requireActiveStaff();
  const patch = {
    status: res.ok ? 'direct_sent' : 'direct_send_failed',
    body: message,
    pancake_message_id: res.ok ? res.pancakeMessageId : null,
    auto_sent_at: res.ok ? new Date().toISOString() : null,
    auto_sent_by: res.ok ? staff.staffProfileId : null,
  };
  const { data: existing } = await supabase
    .from('customer_messages')
    .select('id')
    .eq('official_order_id', officialOrderId)
    .maybeSingle();
  if (existing) {
    await supabase.from('customer_messages').update(patch).eq('id', existing.id);
    return;
  }
  const { data: ord } = await supabase
    .from('official_orders')
    .select('customer_id')
    .eq('id', officialOrderId)
    .maybeSingle();
  const customerId = (ord as { customer_id?: string } | null)?.customer_id;
  if (customerId) {
    await supabase
      .from('customer_messages')
      .insert({ official_order_id: officialOrderId, customer_id: customerId, ...patch });
  }
}

/**
 * For-Invoice flow (Owner request). Two small, guarded operations:
 *   - "Verified" advances a For-Invoice order (status 'invoiced') to For Reminder
 *     ('awaiting_required_payment'). Idempotent — only a still-invoiced order
 *     moves, so a retry never double-transitions.
 *   - Setting a customer's Facebook Messenger URL powers "Open FB Chat".
 * Both re-check authority (defence in depth) and the database function is the real
 * gate. Neither touches money.
 */

export type ForInvoiceResult =
  | { ok: true; pancake?: PancakeDelivery }
  | { ok: false; error: string };

export type OrderInvoiceMessage = {
  body: string;
  status: string;
  /** When the message was attested as manually sent, or null (not yet sent). */
  sentAt: string | null;
  sentByName: string | null;
  preparedByName: string | null;
};

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

/**
 * The prepared invoice message for an order (for "View Message"). Read-only,
 * RLS-scoped. Returns null when no message has been prepared yet. Nothing here
 * claims delivery — only what was prepared and, if attested, who marked it sent.
 */
export async function getOrderInvoiceMessage(
  officialOrderId: string,
): Promise<
  { ok: true; message: OrderInvoiceMessage | null } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_messages')
    .select(
      `body, status, manually_sent_at,
       sent_by:staff_profiles!manually_sent_by ( full_name ),
       prepared_by:staff_profiles!created_by ( full_name )`,
    )
    .eq('official_order_id', officialOrderId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, message: null };

  const r = data as Record<string, unknown>;
  return {
    ok: true,
    message: {
      body: (r.body as string | null) ?? '',
      status: (r.status as string | null) ?? 'unknown',
      sentAt: (r.manually_sent_at as string | null) ?? null,
      sentByName: one<{ full_name: string }>(r.sent_by)?.full_name ?? null,
      preparedByName: one<{ full_name: string }>(r.prepared_by)?.full_name ?? null,
    },
  };
}

/**
 * Save (edit) the invoice message body for an order. RLS gates the write to
 * message_preparation / message_sending — the same authority that prepares and
 * sends the invoice. Updates the order's existing prepared message; if none exists
 * yet it creates one (ready to copy or send) for the order's customer. Touches no
 * money and changes no status — only the copy the operator sends on Facebook.
 */
export async function saveOrderInvoiceMessage(
  officialOrderId: string,
  customerId: string,
  body: string,
): Promise<ForInvoiceResult> {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return { ok: false, error: 'The message cannot be empty.' };
  if (trimmed.length > 5000) return { ok: false, error: 'That message is too long.' };

  const supabase = await createClient();
  const existing = await supabase
    .from('customer_messages')
    .select('id')
    .eq('official_order_id', officialOrderId)
    .maybeSingle();
  if (existing.error) return { ok: false, error: existing.error.message };

  const write = existing.data
    ? await supabase
        .from('customer_messages')
        .update({ body: trimmed })
        .eq('id', existing.data.id)
    : await supabase.from('customer_messages').insert({
        official_order_id: officialOrderId,
        customer_id: customerId,
        body: trimmed,
        status: 'ready_to_copy_or_send',
      });

  if (write.error) {
    return { ok: false, error: write.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'order.invoice_message_edited',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: { length: trimmed.length, created: !existing.data },
  });
  return { ok: true };
}

/**
 * Re-deliver the invoice message to the customer's Pancake conversation WITHOUT
 * advancing the order — a safe Retry Send. Reuses the same delivery path (which
 * records the message id + Sent/Failed status). Never creates another order.
 */
export async function resendOrderInvoice(orderId: string): Promise<ForInvoiceResult> {
  const rendered = await renderOrderMessage(orderId, 'invoice');
  if (!rendered.ok) return { ok: false, error: rendered.error };

  const supabase = await createClient();
  const pancake = await deliverOrderMessageViaPancake(supabase, orderId, rendered.message);
  if (!pancake.attempted) {
    return {
      ok: false,
      error:
        'Not sent — the customer has no linked Pancake conversation, or a test session is active.',
    };
  }
  if (!pancake.delivered) {
    return { ok: false, error: pancake.error ?? 'Pancake could not send the message.' };
  }

  await recordAuditEvent({
    action: 'order.invoice_resent',
    entityType: 'official_order',
    entityId: orderId,
    context: { via: 'pancake' },
  });
  return { ok: true, pancake };
}

/**
 * Send the invoice to the customer's Facebook (Pancake) chat WITHOUT advancing the
 * order (Owner flow: the order stays in For Invoice; the Admin later transfers it to a
 * destination). Delivers best-effort and records the Sent / Failed outcome + message
 * id. Never changes status and never throws — it reports whether it actually reached
 * the customer so the UI can say so plainly.
 */
export async function sendOrderInvoice(
  orderId: string,
  message?: string | null,
): Promise<{ ok: true; pancake: PancakeDelivery } | { ok: false; error: string }> {
  let body = (message ?? '').trim();
  if (!body) {
    const rendered = await renderOrderMessage(orderId, 'invoice');
    if (!rendered.ok) return { ok: false, error: rendered.error };
    body = rendered.message;
  }

  const supabase = await createClient();
  const pancake = await deliverOrderMessageViaPancake(supabase, orderId, body);

  await recordAuditEvent({
    action: 'order.invoice_sent',
    entityType: 'official_order',
    entityId: orderId,
    context: {
      via: 'pancake',
      attempted: pancake.attempted,
      delivered: pancake.delivered,
      advanced: false,
    },
  });
  return { ok: true, pancake };
}

/**
 * Ambiguity check before sending (§6): how many OTHER active customers share this
 * customer's exact name, and whether this one has a linked Pancake conversation.
 * The UI warns the operator to verify the right person when a name is shared or no
 * conversation is linked, instead of trusting the Facebook name blindly.
 */
export async function getCustomerMatchInfo(
  customerId: string,
): Promise<CustomerMatchInfo> {
  const empty: CustomerMatchInfo = { sameNameCount: 0, hasConversation: false, examples: [] };
  if (!customerId) return empty;

  const supabase = await createClient();
  const { data: me } = await supabase
    .from('customers')
    .select('display_name, pancake_conversation_id')
    .eq('id', customerId)
    .maybeSingle();
  if (!me) return empty;

  const name = ((me.display_name as string | null) ?? '').trim();
  const hasConversation = Boolean(me.pancake_conversation_id);
  if (!name) return { sameNameCount: 0, hasConversation, examples: [] };

  // ilike with no wildcards is a case-insensitive EXACT match — same name, different
  // record. Never trust the display name alone; this surfaces the collision.
  const { data: others } = await supabase
    .from('customers')
    .select('display_name')
    .eq('is_active', true)
    .neq('id', customerId)
    .ilike('display_name', name)
    .limit(10);

  const list = (others ?? []) as Array<{ display_name: string | null }>;
  return {
    sameNameCount: list.length,
    hasConversation,
    examples: list.slice(0, 3).map((o) => o.display_name ?? '—'),
  };
}

export type BulkInvoiceOrder = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  /** True when the customer has a saved Facebook chat link (send-eligible). */
  hasChat: boolean;
};

/** For-Invoice orders + whether each has a Facebook chat connection. Powers the
 *  "Send All Invoices" plan (eligible = has chat; skipped = no chat). */
export async function getForInvoiceOrders(): Promise<BulkInvoiceOrder[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('official_orders')
    .select('id, order_number, customers ( display_name, facebook_conversation_url )')
    .eq('status', 'invoiced')
    .order('created_at', { ascending: true });

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const c = one<{ display_name: string; facebook_conversation_url: string | null }>(r.customers);
    return {
      orderId: r.id as string,
      orderNumber: (r.order_number as string | null) ?? '—',
      customerName: c?.display_name ?? 'Unknown',
      hasChat: Boolean(c?.facebook_conversation_url),
    };
  });
}

export type OrderReminder = {
  number: number;
  body: string;
  sentAt: string;
  sentByName: string | null;
};

/** Reminders already sent for an order, plus the recorded customer response. */
export async function getOrderReminders(
  officialOrderId: string,
): Promise<{ reminders: OrderReminder[]; customerResponse: string | null }> {
  const supabase = await createClient();
  const [{ data: reminders }, { data: order }] = await Promise.all([
    supabase
      .from('order_reminders')
      .select('reminder_number, body, sent_at, sender:staff_profiles!sent_by ( full_name )')
      .eq('official_order_id', officialOrderId)
      .order('reminder_number', { ascending: true }),
    supabase
      .from('official_orders')
      .select('customer_response')
      .eq('id', officialOrderId)
      .maybeSingle(),
  ]);

  const rows = (reminders ?? []) as Array<Record<string, unknown>>;
  const orderRow = (order ?? null) as Record<string, unknown> | null;
  return {
    reminders: rows.map((r) => ({
      number: r.reminder_number as number,
      body: (r.body as string | null) ?? '',
      sentAt: r.sent_at as string,
      sentByName: one<{ full_name: string }>(r.sender)?.full_name ?? null,
    })),
    customerResponse: (orderRow?.customer_response as string | null) ?? null,
  };
}

/** Record a reminder (1..3) as sent. Sequence + duplicate rules live in the DB. */
export async function sendOrderReminder(
  officialOrderId: string,
  reminderNumber: number,
  body: string,
): Promise<ForInvoiceResult> {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return { ok: false, error: 'The reminder message is empty.' };

  const supabase = await createClient();
  const response = await supabase.rpc('record_order_reminder', {
    p_order_id: officialOrderId,
    p_number: reminderNumber,
    p_body: trimmed,
    p_channel: 'facebook_manual',
  });
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  // Best-effort auto-delivery through Pancake (never blocks the reminder record).
  const pancake = await deliverOrderMessageViaPancake(supabase, officialOrderId, trimmed);

  await recordAuditEvent({
    action: 'order.reminder_sent',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: {
      reminder_number: reminderNumber,
      channel: pancake.delivered ? 'pancake' : 'facebook_manual',
      pancake_delivered: pancake.delivered,
    },
  });
  return { ok: true, pancake };
}

/** Confirm the customer response and route the order per the mapping. */
export async function setOrderCustomerResponse(
  officialOrderId: string,
  responseValue: string,
): Promise<ForInvoiceResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('set_order_customer_response', {
    p_order_id: officialOrderId,
    p_response: responseValue,
  });
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'order.customer_response_confirmed',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: { response: responseValue, moved_to: response.data },
  });
  return { ok: true };
}

/** Advance a For-Invoice order to For Reminder (invoiced → awaiting_required_payment).
 *  When an invoice `message` is given, it is also best-effort delivered via Pancake. */
export async function advanceOrderToReminder(
  orderId: string,
  message?: string | null,
): Promise<ForInvoiceResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('advance_order_to_reminder', { p_order_id: orderId });

  if (response.error) {
    await recordAuditEvent({
      action: 'order.for_invoice_verified',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  // Best-effort auto-delivery of the invoice message through Pancake.
  const body = (message ?? '').trim();
  const pancake = body
    ? await deliverOrderMessageViaPancake(supabase, orderId, body)
    : undefined;

  // true = this call transitioned it; false = it was already advanced (no-op).
  await recordAuditEvent({
    action: 'order.for_invoice_verified',
    entityType: 'official_order',
    entityId: orderId,
    context: {
      moved_to: 'for_reminder',
      transitioned: response.data === true,
      pancake_delivered: pancake?.delivered ?? false,
    },
  });
  return pancake ? { ok: true, pancake } : { ok: true };
}

/**
 * For Reminder → For Confirm (Orders Workflow). The database enforces the money
 * gate: the required down payment (20% of payable) must be verified. Idempotent —
 * only a still-awaiting order moves. Touches no money.
 */
export async function advanceOrderConfirmPayment(orderId: string): Promise<ForInvoiceResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('advance_order_confirm_payment', {
    p_order_id: orderId,
  });
  if (response.error) {
    await recordAuditEvent({
      action: 'order.confirm_required_payment',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'order.confirm_required_payment',
    entityType: 'official_order',
    entityId: orderId,
    context: { moved_to: 'for_confirm', transitioned: response.data === true },
  });
  return { ok: true };
}

/**
 * For Confirm → For Prepare (Orders Workflow). Hands the order to preparation once
 * the required payment is verified. Idempotent; touches no money.
 */
export async function advanceOrderReadyForPreparation(
  orderId: string,
): Promise<ForInvoiceResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('advance_order_ready_for_preparation', {
    p_order_id: orderId,
  });
  if (response.error) {
    await recordAuditEvent({
      action: 'order.ready_for_preparation',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'order.ready_for_preparation',
    entityType: 'official_order',
    entityId: orderId,
    context: { moved_to: 'for_prepare', transitioned: response.data === true },
  });
  return { ok: true };
}

/** Set (or clear) a customer's Facebook Messenger URL — Owner/Admin only. */
export async function setCustomerFacebookUrl(
  customerId: string,
  url: string | null,
): Promise<ForInvoiceResult> {
  const trimmed = (url ?? '').trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: 'Enter a full link starting with http:// or https://.' };
  }
  if (trimmed.length > 500) {
    return { ok: false, error: 'That link is too long.' };
  }

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('set_customer_facebook_url', {
    p_customer_id: customerId,
    p_url: trimmed,
  });

  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'customer.set_facebook_url',
    entityType: 'customer',
    entityId: customerId,
    context: { set: trimmed.length > 0 },
  });
  return { ok: true };
}

/** Set (or clear) a customer's Pancake conversation id — Owner/Admin only. This is
 *  what lets Send Invoice / Send Reminder auto-deliver through Pancake. */
export async function setCustomerPancakeConversation(
  customerId: string,
  conversationId: string | null,
): Promise<ForInvoiceResult> {
  const trimmed = (conversationId ?? '').trim();
  if (trimmed.length > 200) return { ok: false, error: 'That conversation id is too long.' };

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('set_customer_pancake_conversation', {
    p_customer_id: customerId,
    p_conversation_id: trimmed,
  });
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'customer.set_pancake_conversation',
    entityType: 'customer',
    entityId: customerId,
    context: { set: trimmed.length > 0 },
  });
  return { ok: true };
}
