import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';

/**
 * Order cancellation — deliberately TWO steps, so stopping an order and releasing
 * its stock are separate decisions.
 *
 *   request  → `for_cancel`. The order stops immediately and a PENDING Owner
 *              approval request is raised. The linked inventory stays RESERVED —
 *              nothing goes back to stock until a human has reviewed it.
 *   finalize → `cancelled`. Owner / Selected Admin only. The approval is recorded
 *              as decided + executed, and each item that was merely reserved (never
 *              dispatched, delivered, picked up, sold, released, or forfeited) is
 *              returned to Active Inventory THROUGH the Returned-to-Stock Review the
 *              system requires — not around it.
 *
 * Nothing is ever deleted: payments, invoices, items, and history all survive a
 * cancellation. Both calls are idempotent, so a repeated request cannot stack a
 * second approval and a repeated finalize cannot return the same stock twice.
 */

export type CancellationResult = { ok: true; changed: boolean } | { ok: false; error: string };

export type FinalizeCancellationResult =
  | { ok: true; changed: boolean; returned: number; kept: number }
  | { ok: false; error: string };

function clean(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}

/** Step 1 — stop the order and raise the cancellation for review. */
export async function requestOrderCancellation(
  officialOrderId: string,
  reason: string,
): Promise<CancellationResult> {
  if (!officialOrderId) return { ok: false, error: 'An order is required.' };
  if (!reason.trim()) return { ok: false, error: 'A cancellation reason is required.' };

  const supabase = await createClient();
  const res = (await supabase.rpc('request_order_cancellation', {
    p_order_id: officialOrderId,
    p_reason: reason.trim(),
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.cancellation_requested',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: clean(res.error.message) };
  }

  const changed = res.data?.changed === true;
  if (changed) {
    await recordAuditEvent({
      action: 'order.cancellation_requested',
      entityType: 'official_order',
      entityId: officialOrderId,
      reason: reason.trim(),
      context: { status: 'for_cancel', inventory_released: false },
    });
  }
  return { ok: true, changed };
}

/** Step 2 — finalize: mark cancelled and return only stock that is safe to return. */
export async function finalizeOrderCancellation(
  officialOrderId: string,
): Promise<FinalizeCancellationResult> {
  if (!officialOrderId) return { ok: false, error: 'An order is required.' };

  const supabase = await createClient();
  const res = (await supabase.rpc('finalize_order_cancellation', {
    p_order_id: officialOrderId,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.cancellation_finalized',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: clean(res.error.message) };
  }

  const d = res.data ?? {};
  const changed = d.changed === true;
  const returned = Number(d.returned ?? 0);
  const kept = Number(d.kept ?? 0);

  if (changed) {
    // The stock return is part of the money/inventory trail — record it explicitly.
    await recordAuditEvent({
      action: 'order.cancellation_finalized',
      entityType: 'official_order',
      entityId: officialOrderId,
      context: {
        status: 'cancelled',
        items_returned_to_inventory: returned,
        items_kept_out_of_stock: kept,
      },
    });
  }
  return { ok: true, changed, returned, kept };
}
