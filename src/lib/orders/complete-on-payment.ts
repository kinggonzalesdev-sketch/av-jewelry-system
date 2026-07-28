import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';

/**
 * Auto-complete an order when its verified payments cover the full payable amount
 * (Owner decision 2026-07-25). Called as a SEPARATE step AFTER a successful
 * verify — verification itself stays money-only (see verification.ts). The SQL
 * function `complete_order_on_full_payment` is idempotent and safe: it no-ops
 * unless the order is live and paid in full, so calling it on every verify is
 * harmless. The status flip AND the inventory retirement happen atomically in the
 * database. The audit row records who (the caller) and when.
 *
 * Returns true only when THIS call transitioned the order to Completed.
 */
export async function completeOrderForPaymentIfPaidInFull(
  paymentId: string,
): Promise<boolean> {
  const supabase = await createClient();

  const { data: pay } = await supabase
    .from('payments')
    .select('official_order_id')
    .eq('id', paymentId)
    .maybeSingle();
  const orderId = (pay?.official_order_id as string | undefined) ?? null;
  if (!orderId) return false;

  // The RPC is typed `any`; read fields off the response rather than
  // destructuring, to keep no-unsafe-assignment happy (matches archive.ts).
  const response = await supabase.rpc('complete_order_on_full_payment', {
    p_order_id: orderId,
  });

  if (response.error) {
    // Non-fatal: the payment is already verified and the balance is correct;
    // completion can be retried on the next verify. Record it, do not throw.
    await recordAuditEvent({
      action: 'order.auto_complete',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return false;
  }

  if (response.data === true) {
    await recordAuditEvent({
      action: 'order.auto_complete',
      entityType: 'official_order',
      entityId: orderId,
      context: { trigger: 'paid_in_full', inventory_retired: true },
    });
    return true;
  }

  return false;
}
