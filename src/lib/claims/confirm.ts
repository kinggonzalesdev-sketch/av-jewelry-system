import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Confirm Claim & Print Label (Bible §6.4, §22.3, §22.6, §22.7).
 *
 * THE RESERVATION POINT. This is the only place inventory is ever provisionally
 * deducted, and it deducts EXACTLY ONCE.
 *
 * What confirmation does:
 *   Pending Claim -> Confirmed Claim + one provisional reservation + one label
 *   job, queued. The claim then reads as For Invoice.
 *
 * What it does NOT do:
 *   - create an Official Order      -> Phase 5 (Approve & Send Invoice)
 *   - create an invoice             -> Phase 5
 *   - print anything                -> a label job is not a physical print
 *   - promote a miner               -> never automatic
 *   - allocate from the waitlist    -> never automatic
 *   - return stock                  -> never automatic
 *
 * The whole transaction lives in public.confirm_claim_and_print() because the
 * JS client cannot span statements, and a Confirmed Claim without a reservation
 * is the one partial state that must never exist — the item would look
 * available and be sold twice.
 *
 * Idempotent by claim: confirming twice returns the same reservation and label
 * job. Concurrency is settled by a row lock inside the function, so two staff
 * confirming at once produce one reservation, not two.
 */

export type ConfirmResult =
  | {
      ok: true;
      claimId: string;
      reservationId: string;
      labelJobId: string;
      deduplicated: boolean;
    }
  | { ok: false; error: string; code?: 'denied' | 'invalid_state' | 'no_stock' };

/**
 * Confirms a Pending Claim and queues its label job.
 *
 * `printerTarget` is recorded, not contacted. Printing is a separate, later,
 * separately-observable step (see printing.ts).
 */
export async function confirmClaimAndPrint(
  claimId: string,
  options?: { printerTarget?: string | null; labelSize?: string },
): Promise<ConfirmResult> {
  if (!claimId) {
    return { ok: false, error: 'A claim reference is required.' };
  }

  try {
    await requirePermission('confirm_claim_print_label');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'claim.confirm',
        entityType: 'claim',
        entityId: claimId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message, code: 'denied' };
    }
    throw cause;
  }

  const supabase = await createClient();

  const response = await supabase.rpc('confirm_claim_and_print', {
    p_claim_id: claimId,
    p_printer_target: options?.printerTarget ?? null,
    p_label_size: options?.labelSize ?? '40x30mm',
  });

  const error = response.error;
  const data: unknown = response.data;

  if (error) {
    // The function raises with specific SQLSTATEs so the caller can tell a
    // refusal from a conflict from a stock shortage. The message is already
    // written for a human — it is surfaced rather than replaced with a generic.
    const code =
      error.code === '42501'
        ? ('denied' as const)
        : error.message.includes('available stock')
          ? ('no_stock' as const)
          : ('invalid_state' as const);

    await recordAuditEvent({
      action: 'claim.confirm',
      entityType: 'claim',
      entityId: claimId,
      outcome: code === 'denied' ? 'denied' : 'failed',
      reason: error.message,
    });

    return { ok: false, error: cleanPgError(error.message), code };
  }

  const result = data as {
    claim_id: string;
    reservation_id: string;
    label_job_id: string;
    deduplicated: boolean;
  };

  // A deduplicated retry is NOT a new confirmation. Auditing it as one would
  // make the trail claim the item was reserved twice.
  await recordAuditEvent({
    action: result.deduplicated ? 'claim.confirm.deduplicated' : 'claim.confirm',
    entityType: 'claim',
    entityId: claimId,
    context: {
      reservation_id: result.reservation_id,
      label_job_id: result.label_job_id,
      before_status: result.deduplicated ? 'confirmed_claim' : 'pending_claim',
      after_status: 'confirmed_claim',
      reservation_created: !result.deduplicated,
      // Stated so the trail itself testifies to what confirmation did not do.
      official_order_created: false,
      invoice_created: false,
      printed: false,
    },
  });

  if (!result.deduplicated) {
    await recordAuditEvent({
      action: 'reservation.create',
      entityType: 'inventory_reservation',
      entityId: result.reservation_id,
      context: { claim_id: claimId, state: 'provisional' },
    });

    await recordAuditEvent({
      action: 'label_job.create',
      entityType: 'label_job',
      entityId: result.label_job_id,
      context: { claim_id: claimId, status: 'pending_print' },
    });
  }

  return {
    ok: true,
    claimId: result.claim_id,
    reservationId: result.reservation_id,
    labelJobId: result.label_job_id,
    deduplicated: result.deduplicated,
  };
}

/**
 * Postgres prefixes raised messages with context the operator does not need.
 * The message itself is already human-written, so only the noise is stripped.
 */
function cleanPgError(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}
