import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { shopPaymentDetails } from '@/lib/invoicing/shop';
import { createClient } from '@/lib/supabase/server';

/**
 * Invoice messages (Bible §15, §26).
 *
 * THE FOUR STATES ARE NOT THE SAME THING:
 *
 *     Copy  ≠  Sent  ≠  Delivered  ≠  Read
 *
 * Copying text to a clipboard proves the staff member pressed a button.
 * Marking as Sent is a human ATTESTATION that they pasted it somewhere — the
 * system did not witness it. Delivered and Read would require a real messaging
 * integration, which does not exist. So this module can produce Copy and Sent
 * and nothing beyond, and it never claims otherwise.
 *
 * ⚠️  NO REAL FACEBOOK / PANCAKE / META DELIVERY IS IMPLEMENTED (§26, §27).
 *     There is no `delivered_at`, no read receipt, and no direct-send transport
 *     here, because inventing any of them would be a lie about what happened.
 */

export type MessageResult =
  { ok: true; customerMessageId: string; body: string } | { ok: false; error: string };

/**
 * The default invoice message template.
 *
 * PROVISIONAL (§15.34, §26): the exact template and channels are not
 * client-final. This is a documented proposal, not a settled business message.
 *
 * Pure: it formats stored values and contacts nothing.
 */
export function renderInvoiceMessage(input: {
  customerDisplayName: string;
  orderNumber: string;
  invoiceNumber: string;
  totalAmount: number;
  holdExpiresAt: string;
  /** Each line already formatted with item, grams, and price. */
  itemLines: string[];
  /** Downpayment / payment instructions (from shop settings). */
  paymentDetails: string;
}): string {
  const hold = new Date(input.holdExpiresAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return [
    'Thank you for choosing A.V. Jewelry! 💍',
    `Hi ${input.customerDisplayName}, ito po ang item na na-mine nyo:`,
    '',
    ...input.itemLines.map((line) => `• ${line}`),
    '',
    `Total: PHP ${input.totalAmount.toFixed(2)}`,
    `Invoice: ${input.invoiceNumber}`,
    '',
    'For your downpayment:',
    input.paymentDetails,
    '',
    `Please settle by ${hold} to keep your items reserved.`,
    '',
    'Maraming salamat po! 🙏',
  ].join('\n');
}

/**
 * Prepares the invoice message for an Official Order.
 *
 * Preparation is not sending (§22.14's spirit: producing a thing is not doing
 * the thing). The message is created ready_to_copy_or_send and waits for a human.
 */
export async function prepareInvoiceMessage(
  officialOrderId: string,
): Promise<MessageResult> {
  let staff;
  try {
    staff = await requirePermission('message_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'message.prepare',
        entityType: 'official_order',
        entityId: officialOrderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Idempotent: one prepared message per order is enough. Re-preparing would
  // orphan the first and confuse "which one did we send?".
  const { data: existing } = await supabase
    .from('customer_messages')
    .select('id, body')
    .eq('official_order_id', officialOrderId)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      customerMessageId: existing.id as string,
      body: existing.body as string,
    };
  }

  const { data: order } = await supabase
    .from('official_orders')
    .select(
      `id, order_number, invoice_number, hold_expires_at, customer_id,
       customers ( display_name ),
       official_order_claims ( claim_id )`,
    )
    .eq('id', officialOrderId)
    .maybeSingle();

  if (!order) return { ok: false, error: 'That Official Order could not be found.' };

  const o = order as Record<string, unknown>;
  const customer = Array.isArray(o.customers)
    ? (o.customers[0] as { display_name: string } | undefined)
    : (o.customers as { display_name: string } | null);

  const claimIds = ((o.official_order_claims as Array<{ claim_id: string }>) ?? []).map(
    (l) => l.claim_id,
  );

  // Totals and item lines come from STORED data, never from a caller. Grams are
  // included per the Owner's requested invoice format (name · grams · price).
  const { data: claims } = await supabase
    .from('claims')
    .select(
      'quantity, inventory_items ( item_name, item_code, total_price_per_piece, grams_per_piece )',
    )
    .in('id', claimIds.length > 0 ? claimIds : ['00000000-0000-0000-0000-000000000000']);

  let total = 0;
  const itemLines: string[] = [];

  for (const row of claims ?? []) {
    const r = row as unknown as {
      quantity: number;
      inventory_items:
        | {
            item_name: string | null;
            item_code: string | null;
            total_price_per_piece: number | null;
            grams_per_piece: number | null;
          }
        | Array<{
            item_name: string | null;
            item_code: string | null;
            total_price_per_piece: number | null;
            grams_per_piece: number | null;
          }>
        | null;
    };
    const item = Array.isArray(r.inventory_items)
      ? r.inventory_items[0]
      : r.inventory_items;
    const price = item?.total_price_per_piece ?? 0;
    total += price * r.quantity;
    const name = item?.item_name ?? item?.item_code ?? 'Item';
    const grams = item?.grams_per_piece != null ? `${item.grams_per_piece}g · ` : '';
    itemLines.push(
      `${name} ×${r.quantity} · ${grams}PHP ${(price * r.quantity).toFixed(2)}`,
    );
  }

  const body = renderInvoiceMessage({
    customerDisplayName: customer?.display_name ?? 'there',
    orderNumber: o.order_number as string,
    invoiceNumber: o.invoice_number as string,
    totalAmount: total,
    holdExpiresAt: o.hold_expires_at as string,
    itemLines,
    paymentDetails: shopPaymentDetails(),
  });

  const { data: created, error } = await supabase
    .from('customer_messages')
    .insert({
      customer_id: o.customer_id as string,
      official_order_id: officialOrderId,
      status: 'ready_to_copy_or_send',
      body,
      created_by: staff.staffProfileId,
    })
    .select('id, body')
    .single();

  if (error || !created) {
    await recordAuditEvent({
      action: 'message.prepare',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    return { ok: false, error: 'The invoice message could not be prepared.' };
  }

  await recordAuditEvent({
    action: 'message.prepare',
    entityType: 'customer_message',
    entityId: created.id as string,
    context: {
      official_order_id: officialOrderId,
      status: 'ready_to_copy_or_send',
      // Preparing is not sending, and the trail says so.
      sent: false,
      delivered: false,
    },
  });

  return {
    ok: true,
    customerMessageId: created.id as string,
    body: created.body as string,
  };
}

/**
 * Records that the message text was copied.
 *
 * COPY IS NOT SENT. This changes no status — it is an audit fact only, so that
 * "we copied it but never pasted it" stays visible instead of looking like a
 * delivery.
 */
export async function recordMessageCopied(
  customerMessageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('message_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  await recordAuditEvent({
    action: 'message.copied',
    entityType: 'customer_message',
    entityId: customerMessageId,
    context: { copied: true, sent: false, delivered: false },
  });

  return { ok: true };
}

/**
 * Mark as Sent — a human attestation (Bible §26).
 *
 * The system did not observe delivery and does not claim it. This records WHO
 * attested and WHEN, which is the only honest thing available without a real
 * integration. Requires the separate Message Sending permission: preparing a
 * message is not attesting that it went out.
 */
export async function markMessageSent(
  customerMessageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('message_sending');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'message.mark_sent',
        entityType: 'customer_message',
        entityId: customerMessageId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_messages')
    .update({
      status: 'manually_sent',
      manually_sent_at: new Date().toISOString(),
      manually_sent_by: staff.staffProfileId,
    })
    .eq('id', customerMessageId)
    .select('id, official_order_id');

  if (error || !data || data.length === 0) {
    await recordAuditEvent({
      action: 'message.mark_sent',
      entityType: 'customer_message',
      entityId: customerMessageId,
      outcome: 'failed',
      reason: error?.message ?? 'no row updated',
    });
    return { ok: false, error: 'The message could not be marked sent.' };
  }

  const attemptNumber = await nextAttemptNumber(customerMessageId);
  await supabase.from('message_send_attempts').insert({
    customer_message_id: customerMessageId,
    attempt_number: attemptNumber,
    channel: 'manual',
    outcome: 'sent',
    attempted_by: staff.staffProfileId,
  });

  await recordAuditEvent({
    action: 'message.mark_sent',
    entityType: 'customer_message',
    entityId: customerMessageId,
    context: {
      channel: 'manual',
      attempt_number: attemptNumber,
      // Sent is an attestation. Delivery and read were never observed.
      attested_by_staff: true,
      delivery_confirmed: false,
      read_confirmed: false,
      // Retrying a message never touches the order.
      official_order_created: false,
    },
  });

  return { ok: true };
}

/**
 * Records a failed send attempt so a retry is possible.
 *
 * Retrying only re-attempts the MESSAGE. It can never create another Official
 * Order — this module does not touch official_orders at all.
 */
export async function recordSendFailure(
  customerMessageId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('message_sending');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: false, error: 'A failed send needs a reason.' };
  }

  const supabase = await createClient();
  const attemptNumber = await nextAttemptNumber(customerMessageId);

  const { error } = await supabase.from('message_send_attempts').insert({
    customer_message_id: customerMessageId,
    attempt_number: attemptNumber,
    channel: 'manual',
    outcome: 'failed',
    failure_reason: trimmed,
    attempted_by: staff.staffProfileId,
  });

  if (error) return { ok: false, error: 'The failed attempt could not be recorded.' };

  await recordAuditEvent({
    action: 'message.send_failed',
    entityType: 'customer_message',
    entityId: customerMessageId,
    outcome: 'failed',
    reason: trimmed,
    context: { attempt_number: attemptNumber, official_order_created: false },
  });

  return { ok: true };
}

async function nextAttemptNumber(customerMessageId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_send_attempts')
    .select('attempt_number')
    .eq('customer_message_id', customerMessageId)
    .order('attempt_number', { ascending: false })
    .limit(1);

  const highest = data?.[0]?.attempt_number as number | undefined;
  return (highest ?? 0) + 1;
}
