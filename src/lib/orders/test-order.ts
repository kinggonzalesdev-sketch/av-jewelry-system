import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * SUPER ADMIN (Owner) safe deletion of a TEST order, returning its item(s) to Active
 * Inventory. Unlike the production return-to-inventory flow, this DELIBERATELY allows
 * a recorded TEST payment — it removes the test payment + verification. The database
 * function is the real gate: it re-checks Owner AND refuses anything that is not
 * `is_test = true`, so a production order can never be deleted here. Test rows are
 * excluded from every dashboard/report, so removing them changes no financial figure.
 */

export type DeleteTestOrderResult =
  | { ok: true; returnedItems: number; paymentsRemoved: number }
  | { ok: false; error: string };

export async function deleteTestOrderAndReturnItems(
  officialOrderId: string,
): Promise<DeleteTestOrderResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.delete_test',
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
  const res = (await supabase.rpc('delete_test_order_and_return_items', {
    p_order_id: officialOrderId,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.delete_test',
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
    action: 'order.delete_test',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: {
      owner_approved: true,
      returned_items: returnedItems,
      payments_removed: paymentsRemoved,
    },
  });
  return { ok: true, returnedItems, paymentsRemoved };
}
