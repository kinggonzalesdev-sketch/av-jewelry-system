import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * SUPER ADMIN (Owner) deletion of a CANCELLED order — removes the order + its records
 * and returns any still-reserved item(s) to Active Inventory. The DB function is the
 * real gate: it re-checks Owner AND refuses anything whose status is not 'cancelled',
 * so a live/active order can never be deleted here. Sibling of the test-order delete.
 */
export type DeleteCancelledOrderResult =
  | { ok: true; returnedItems: number; paymentsRemoved: number }
  | { ok: false; error: string };

export async function deleteCancelledOrder(
  officialOrderId: string,
): Promise<DeleteCancelledOrderResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.delete_cancelled',
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
  const res = (await supabase.rpc('delete_cancelled_order', {
    p_order_id: officialOrderId,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.delete_cancelled',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const returnedItems = Number(res.data?.returned_items ?? 0);
  const paymentsRemoved = Number(res.data?.payments_removed ?? 0);
  await recordAuditEvent({
    action: 'order.delete_cancelled',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: { owner_approved: true, returned_items: returnedItems, payments_removed: paymentsRemoved },
  });
  return { ok: true, returnedItems, paymentsRemoved };
}
