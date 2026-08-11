import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';

/**
 * Completed transfer (§5): Delivery's "Done" and the general "Transfer to
 * Completed".
 *
 * Both are thin transports over guarded SQL. `transfer_order_to_completed` locks
 * the order row, re-checks eligibility through `order_completion_block`, stamps
 * completed_by / completed_at, closes the fulfillment record and retires the items
 * — all in one transaction, so a half-completed order is not representable.
 *
 * Duplicate completion is prevented by REFUSAL rather than silence: a second press
 * returns "This order is already completed." instead of writing a second stamp.
 */

export type CompletionResult = { ok: true } | { ok: false; error: string };

function clean(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}

/**
 * Why this order may NOT be completed right now, or null when it may.
 * The SAME function the write path calls, so the button and the server agree.
 */
export async function orderCompletionBlock(orderId: string): Promise<string | null> {
  if (!orderId) return 'An order is required.';
  const supabase = await createClient();
  const res = (await supabase.rpc('order_completion_block', {
    p_order_id: orderId,
  })) as { data: string | null; error: { message: string } | null };
  // A failed read is NOT an eligible order — never fall open.
  if (res.error) return clean(res.error.message);
  return res.data ?? null;
}

/** Delivery → Done: record the handover and complete, atomically. */
export async function markOrderDone(orderId: string): Promise<CompletionResult> {
  return runCompletion(orderId, 'mark_order_done', 'order.done');
}

/** Transfer to Completed from any eligible active stage. */
export async function transferOrderToCompleted(
  orderId: string,
): Promise<CompletionResult> {
  return runCompletion(
    orderId,
    'transfer_order_to_completed',
    'order.transfer_completed',
  );
}

async function runCompletion(
  orderId: string,
  fn: 'mark_order_done' | 'transfer_order_to_completed',
  action: string,
): Promise<CompletionResult> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const supabase = await createClient();

  // Capture the status BEFORE completion so the audit trail records what the order
  // moved from (the DB overwrites it to 'completed' atomically). Best-effort — a
  // read failure never blocks the completion itself.
  const { data: prior } = await supabase
    .from('official_orders')
    .select('status')
    .eq('id', orderId)
    .maybeSingle();
  const previousStatus = (prior?.status as string | null) ?? null;

  const res = (await supabase.rpc(fn, { p_order_id: orderId })) as {
    error: { message: string } | null;
  };

  if (res.error) {
    const error = clean(res.error.message);
    await recordAuditEvent({
      action,
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  await recordAuditEvent({
    action,
    entityType: 'official_order',
    entityId: orderId,
    // Previous → completed, plus who/when (the DB stamps completed_by / completed_at).
    context: {
      completed: true,
      previous_status: previousStatus,
      new_status: 'completed',
    },
  });
  return { ok: true };
}
