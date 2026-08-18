import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';

/**
 * Operational fulfillment details on the ORDER (Fulfillment Phase A). official_orders is the
 * single source of truth: these write only `courier` / `pickup_contact` / `dispatched_at` on the
 * order. They touch NO money and NO inventory, and they never complete the order — final
 * completion stays with the existing `transfer_order_to_completed` (its payment + waybill gates
 * and the inventory completion guard are unchanged). Both RPCs re-check `fulfillment_preparation`.
 */

export type FulfillmentDetailResult = { ok: true } | { ok: false; error: string };

function clean(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}

/**
 * Save courier (shipping/delivery) and/or store-pickup contact. A field left `undefined`/`null`
 * is unchanged; a provided value sets it (empty string clears it).
 */
export async function setFulfillmentDetails(
  orderId: string,
  fields: { courier?: string | null; pickupContact?: string | null },
): Promise<FulfillmentDetailResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const supabase = await createClient();
  const res = (await supabase.rpc('set_fulfillment_details', {
    p_order_id: orderId,
    p_courier: fields.courier ?? null,
    p_pickup_contact: fields.pickupContact ?? null,
  })) as { error: { message: string } | null };

  if (res.error) {
    const error = clean(res.error.message);
    await recordAuditEvent({
      action: 'order.fulfillment_details',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  await recordAuditEvent({
    action: 'order.fulfillment_details',
    entityType: 'official_order',
    entityId: orderId,
    context: {
      courier: fields.courier ?? null,
      pickup_contact: fields.pickupContact ?? null,
    },
  });
  return { ok: true };
}

/**
 * Shipping only: stamp `dispatched_at` (goods left the shop). This does NOT complete the order —
 * the final completion still runs through `transfer_order_to_completed` with its payment + waybill
 * gates. Idempotent (a second press keeps the first dispatch time).
 */
export async function markOrderDispatched(orderId: string): Promise<FulfillmentDetailResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const supabase = await createClient();
  const res = (await supabase.rpc('mark_order_dispatched', {
    p_order_id: orderId,
  })) as { error: { message: string } | null };

  if (res.error) {
    const error = clean(res.error.message);
    await recordAuditEvent({
      action: 'order.dispatched',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  await recordAuditEvent({
    action: 'order.dispatched',
    entityType: 'official_order',
    entityId: orderId,
    context: { dispatched: true },
  });
  return { ok: true };
}
