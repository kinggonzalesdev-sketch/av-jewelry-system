import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Edit Items (Owner request 2026-08-09) — the SUPER ADMIN (owner) may change an
 * order's item composition after it exists. Two moves, both money-safe because the
 * order total is DERIVED from the order's `official_order_claims` (nothing stored to
 * mutate) and payments reference the ORDER, so they stay with the original:
 *
 *   - removeOrderItem: the piece returns to Active stock (via the sanctioned
 *     approved Returned-to-Stock review) and the order total drops by its price.
 *   - splitOrderItem: the piece moves to a brand-new For-Invoice order (same
 *     customer, unpaid) so it can be paid/delivered on its own.
 *
 * Every guard (owner, editable status, not the last item, claim belongs to order)
 * is re-checked in the SECURITY DEFINER function — the database is the real gate.
 */

export type EditItemResult = { ok: true } | { ok: false; error: string };
export type SplitItemResult =
  { ok: true; orderNumber: string } | { ok: false; error: string };

function cleanError(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}

export async function removeOrderItem(
  orderId: string,
  claimId: string,
): Promise<EditItemResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.remove_item',
        entityType: 'official_order',
        entityId: orderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_order_item', {
    p_order_id: orderId,
    p_claim_id: claimId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'order.remove_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: cleanError(error.message) };
  }

  await recordAuditEvent({
    action: 'order.remove_item',
    entityType: 'official_order',
    entityId: orderId,
    context: { claimId },
  });
  return { ok: true };
}

export async function splitOrderItem(
  orderId: string,
  claimId: string,
): Promise<SplitItemResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.split_item',
        entityType: 'official_order',
        entityId: orderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('split_order_item', {
    p_order_id: orderId,
    p_claim_id: claimId,
  });

  if (response.error) {
    await recordAuditEvent({
      action: 'order.split_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: cleanError(response.error.message) };
  }

  const payload = response.data as { order_number?: string } | null;
  const orderNumber = payload?.order_number ?? '—';
  await recordAuditEvent({
    action: 'order.split_item',
    entityType: 'official_order',
    entityId: orderId,
    context: { claimId, newOrderNumber: orderNumber },
  });
  return { ok: true, orderNumber };
}
