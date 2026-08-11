import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import {
  AuthorizationError,
  requireActiveStaff,
  requireOwnerOrAdmin,
} from '@/lib/authz/guard';
import {
  conversationBelongsToPage,
  getActivePancakePageId,
  sendPancakeConversationMessage,
} from '@/lib/integrations/pancake';
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
 * Best-effort: the item screenshot/photo to attach to a Pancake send — the mined
 * capture screenshot if the order has one, else the newest image attachment on the
 * order. Returns a short-lived signed URL, or null (the send then stays text-only).
 * Never throws: a lookup/sign failure simply omits the photo.
 */
async function findOrderImageUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  officialOrderId: string,
): Promise<string | null> {
  const ATTACH_BUCKET = 'attachments';
  // 1) The mined-item capture screenshot linked to this order (the true item photo).
  const cap = (await supabase
    .from('capture_records')
    .select('screenshot_path')
    .eq('official_order_id', officialOrderId)
    .not('screenshot_path', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { screenshot_path?: string | null } | null };
  let path = cap.data?.screenshot_path ?? null;
  // 2) Else the newest image attachment uploaded onto the order.
  if (!path) {
    const att = (await supabase
      .from('attachments')
      .select('storage_path')
      .eq('related_entity_type', 'order')
      .eq('related_entity_id', officialOrderId)
      .ilike('content_type', 'image/%')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { storage_path?: string | null } | null };
    path = att.data?.storage_path ?? null;
  }
  if (!path) return null;
  const signed = (await supabase.storage
    .from(ATTACH_BUCKET)
    .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
  return signed.data?.signedUrl ?? null;
}

/**
 * Best-effort deliver a message to the order's customer via Pancake. NEVER throws
 * and never blocks the workflow: if the customer has no Pancake conversation id it
 * is simply skipped; a send failure is reported so the UI can offer a manual send.
 * When the order has an item screenshot/photo it is attached to the Pancake message.
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
      .select('fb_pancake_conversation_id, customers ( pancake_conversation_id )')
      .eq('id', officialOrderId)
      .maybeSingle()) as {
      data: { fb_pancake_conversation_id?: string | null; customers?: unknown } | null;
    };
    type Cust = { pancake_conversation_id?: string | null };
    const customer = response.data?.customers as Cust | Cust[] | null | undefined;
    const one = Array.isArray(customer) ? customer[0] : customer;
    // Prefer the ORDER's OWN confirmed conversation (spec §6/§7) — it is the exact chat
    // for this transaction and survives customer-profile edits — then fall back to the
    // customer's default link.
    // Only a link on the ACTIVE send page can be delivered — a wrong-page link would be
    // rejected ("conversation_id not found"), so skip it and report "no chat linked yet"
    // honestly instead of a cryptic failure.
    const activePage = await getActivePancakePageId();
    const orderConv = (response.data?.fb_pancake_conversation_id ?? '').trim();
    const custConv = (one?.pancake_conversation_id ?? '').trim();
    const conversationId = conversationBelongsToPage(orderConv, activePage)
      ? orderConv
      : conversationBelongsToPage(custConv, activePage)
        ? custConv
        : '';
    if (!conversationId) {
      return { attempted: false, delivered: false, error: null };
    }
    // Attach the item screenshot/photo when the order has one (best-effort).
    const attachmentUrl = await findOrderImageUrl(supabase, officialOrderId).catch(
      () => null,
    );
    const res = await sendPancakeConversationMessage({
      conversationId,
      message,
      attachmentUrl,
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
    return {
      attempted: true,
      delivered: false,
      error: 'Pancake delivery failed.',
      debug: null,
    };
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
  { ok: true; pancake?: PancakeDelivery } | { ok: false; error: string };

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
  const pancake = await deliverOrderMessageViaPancake(
    supabase,
    orderId,
    rendered.message,
  );
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
  const empty: CustomerMatchInfo = {
    sameNameCount: 0,
    hasConversation: false,
    examples: [],
  };
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
    const c = one<{ display_name: string; facebook_conversation_url: string | null }>(
      r.customers,
    );
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
      .select(
        'reminder_number, body, sent_at, sender:staff_profiles!sent_by ( full_name )',
      )
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
  const response = await supabase.rpc('advance_order_to_reminder', {
    p_order_id: orderId,
  });

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
export async function advanceOrderConfirmPayment(
  orderId: string,
): Promise<ForInvoiceResult> {
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

/**
 * Save (or clear) the confirmed Facebook/Pancake link on ONE order (Owner/Admin). The
 * transaction keeps its OWN conversation + chat URL, so Send Invoice / Open FB Chat use
 * exactly that chat even if the customer profile changes later (spec §6/§7/§8). Passing
 * empty conversation + url clears the order's link (delivery falls back to the customer).
 */
/**
 * AUTO-SEND ON LINK: the moment an order gets a confirmed Pancake conversation, deliver
 * the order's mined capture screenshot to that exact chat — so the buyer receives the
 * photo automatically even when the capture-time resolve (on the phone) missed. This
 * is what makes "tap Capture → the pinned commenter gets the screenshot" reliable: it
 * rides the SAME send path Send Invoice uses, but fires on link instead of a click.
 *
 * IDEMPOTENT + SAFE: skips if the capture was already sent (so a re-link / correction
 * never double-sends), skips in a Test Session, and never throws — linking must succeed
 * regardless. Marks the capture sent/failed via the same RPC the mobile path uses.
 */
async function autoSendCaptureScreenshotOnLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  conversationId: string,
): Promise<void> {
  try {
    const conv = conversationId.trim();
    if (!conv) return;

    // Test Session — record nothing to a real customer.
    const { data: tm } = await supabase
      .from('live_test_state')
      .select('active')
      .maybeSingle();
    if ((tm as { active?: boolean } | null)?.active === true) return;

    // The order's mined capture: idempotency flag + device/capture keys for marking.
    const { data } = (await supabase
      .from('capture_records')
      .select(
        'device_installation_id, capture_id, screenshot_path, message_status, is_test',
      )
      .eq('official_order_id', orderId)
      .not('screenshot_path', 'is', null)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as {
      data: {
        device_installation_id: string | null;
        capture_id: string | null;
        screenshot_path: string | null;
        message_status: string | null;
        is_test: boolean | null;
      } | null;
    };
    if (!data || !data.screenshot_path) return; // no photo to send
    if (data.message_status === 'sent' || data.is_test === true) return; // already delivered / test

    const attachmentUrl = await findOrderImageUrl(supabase, orderId).catch(() => null);
    if (!attachmentUrl) return;

    // Greet by the linked customer's name.
    const { data: ord } = (await supabase
      .from('official_orders')
      .select('customers ( display_name )')
      .eq('id', orderId)
      .maybeSingle()) as { data: { customers?: unknown } | null };
    type C = { display_name?: string | null };
    const cust = ord?.customers as C | C[] | null | undefined;
    const name =
      (Array.isArray(cust) ? cust[0]?.display_name : cust?.display_name)?.trim() || '';
    const message =
      `${name ? `Hi ${name}! ` : ''}📸 Ito po ang inyong na-mine na item. ` +
      `Ihahanda na po namin ang invoice ninyo — maraming salamat! 💛`;

    const res = await sendPancakeConversationMessage({
      conversationId: conv,
      message,
      attachmentUrl,
    });

    // Mark the capture sent/failed (idempotency) via the same RPC the mobile send uses.
    if (data.device_installation_id && data.capture_id) {
      await supabase.rpc('update_capture_dispatch', {
        p_device: data.device_installation_id,
        p_capture_id: data.capture_id,
        p_message_status: res.ok ? 'sent' : 'failed',
        p_print_status: null,
        p_pancake_message_id: res.pancakeMessageId,
        p_screenshot_path: data.screenshot_path,
        p_pancake_conversation_id: conv,
      });
    }
  } catch {
    /* best-effort: a failed auto-send must never block linking */
  }
}

/**
 * Public trigger: resolve the order's conversation (its OWN confirmed one, else the
 * linked customer's) and auto-send the mined screenshot to it — idempotent. Called the
 * moment a capture becomes an order ("Use"), which covers the case the on-link hook
 * misses: a customer who is ALREADY linked, so the order never gets separately
 * FB-linked and setOrderFacebookLink never fires. Combined with the on-link hook, the
 * screenshot reaches the buyer automatically in every case — no Send Invoice click.
 */
export async function autoSendCaptureForOrder(orderId: string): Promise<void> {
  if (!orderId) return;
  try {
    const supabase = await createClient();
    const { data } = (await supabase
      .from('official_orders')
      .select('fb_pancake_conversation_id, customers ( pancake_conversation_id )')
      .eq('id', orderId)
      .maybeSingle()) as {
      data: { fb_pancake_conversation_id?: string | null; customers?: unknown } | null;
    };
    type Cust = { pancake_conversation_id?: string | null };
    const cust = data?.customers as Cust | Cust[] | null | undefined;
    const one = Array.isArray(cust) ? cust[0] : cust;
    // Only a link on the active send page is deliverable (a wrong-page link is rejected);
    // skip it so the on-link hook can set a correct one later.
    const activePage = await getActivePancakePageId();
    const orderConv = (data?.fb_pancake_conversation_id ?? '').trim();
    const custConv = (one?.pancake_conversation_id ?? '').trim();
    const conv = conversationBelongsToPage(orderConv, activePage)
      ? orderConv
      : conversationBelongsToPage(custConv, activePage)
        ? custConv
        : '';
    if (!conv) return; // not linked on this page yet — the on-link hook will fire when it is
    await autoSendCaptureScreenshotOnLink(supabase, orderId, conv);
  } catch {
    /* best-effort — never blocks the caller */
  }
}

export async function setOrderFacebookLink(
  orderId: string,
  input: {
    conversationId?: string | null;
    url?: string | null;
    pancakeCustomerId?: string | null;
    pageId?: string | null;
    method?: string | null;
    confidence?: string | null;
  },
): Promise<ForInvoiceResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const url = (input.url ?? '').trim();
  if (url && !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Enter a full link starting with http:// or https://.' };
  }

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('set_order_facebook_link', {
    p_order_id: orderId,
    p_conversation_id: input.conversationId?.trim() || null,
    p_url: url || null,
    p_pancake_customer_id: input.pancakeCustomerId?.trim() || null,
    p_page_id: input.pageId?.trim() || null,
    p_method: input.method?.trim() || null,
    p_confidence: input.confidence?.trim() || null,
  });
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'order.set_facebook_link',
    entityType: 'official_order',
    entityId: orderId,
    context: {
      hasConversation: Boolean(input.conversationId?.trim()),
      hasUrl: Boolean(url),
      method: input.method ?? null,
    },
  });

  // Now that the exact conversation is confirmed, auto-deliver the mined screenshot to
  // it (idempotent — a re-link never resends). This is the reliable path: even if the
  // phone couldn't resolve the buyer at capture, the photo goes out the moment the
  // order is linked (auto on open, or manually), with no Send Invoice click needed.
  if (input.conversationId?.trim()) {
    await autoSendCaptureScreenshotOnLink(supabase, orderId, input.conversationId.trim());
  }

  return { ok: true };
}

/** Set (or clear) a customer's Pancake conversation id — Owner/Admin only. This is
 *  what lets Send Invoice / Send Reminder auto-deliver through Pancake. */
export async function setCustomerPancakeConversation(
  customerId: string,
  conversationId: string | null,
): Promise<ForInvoiceResult> {
  const trimmed = (conversationId ?? '').trim();
  if (trimmed.length > 200)
    return { ok: false, error: 'That conversation id is too long.' };

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
