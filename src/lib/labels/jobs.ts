import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { renderLabel, send, type TransportKind } from '@/lib/labels/transport';
import { createClient } from '@/lib/supabase/server';

/**
 * Label jobs and print attempts (Bible §22.7, §24).
 *
 * The rule that shapes this whole module:
 *
 *     A LABEL JOB IS NOT A PHYSICAL PRINT.
 *
 * One label job exists per claim (Phase 1 UNIQUE(claim_id)). Every print, retry,
 * and reprint is an ATTEMPT on that job. That is why "retry/reprint never
 * creates another claim or reservation" is structurally true here rather than a
 * matter of remembering — there is nowhere for a second claim to go.
 *
 * A failed print never rolls back a confirmed claim. Confirmation already
 * happened in its own transaction and is already true: the item IS reserved. A
 * paper jam does not un-sell a ring. The job simply reads failed, and the UI
 * says so honestly ("Claim confirmed — label printing failed").
 */

export type PrintResult =
  | { ok: true; outcome: 'printed'; attemptNumber: number }
  | { ok: true; outcome: 'failed'; attemptNumber: number; reason: string }
  | { ok: true; outcome: 'unsupported'; reason: string }
  | { ok: false; error: string };

type LabelJobRow = {
  id: string;
  claim_id: string;
  status: string;
  customer_display_name: string | null;
  item_code: string | null;
  item_name: string | null;
  grams_per_piece: number | null;
  quantity: number | null;
  total_price: number | null;
  label_size: string;
};

async function loadJob(labelJobId: string): Promise<LabelJobRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('label_jobs')
    .select(
      'id, claim_id, status, customer_display_name, item_code, item_name, grams_per_piece, quantity, total_price, label_size',
    )
    .eq('id', labelJobId)
    .maybeSingle();

  return data ?? null;
}

async function nextAttemptNumber(labelJobId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('print_attempts')
    .select('attempt_number')
    .eq('label_job_id', labelJobId)
    .order('attempt_number', { ascending: false })
    .limit(1);

  const highest = data?.[0]?.attempt_number as number | undefined;
  return (highest ?? 0) + 1;
}

async function claimReferenceFor(claimId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('claims')
    .select('claim_reference')
    .eq('id', claimId)
    .maybeSingle();

  return (data?.claim_reference as string) ?? claimId;
}

/**
 * Records one print attempt against an existing label job.
 *
 * Shared by the first print, retries, and reprints — because to the record they
 * are the same thing (an attempt), differing only in intent and permission.
 * Nothing here touches the claim, the reservation, or any order.
 */
async function attempt(
  labelJobId: string,
  transport: TransportKind,
  options: { isReprint: boolean; reason?: string },
): Promise<PrintResult> {
  const job = await loadJob(labelJobId);
  if (!job) {
    return { ok: false, error: 'That label job could not be found.' };
  }

  if (job.status === 'voided') {
    return { ok: false, error: 'That label job was voided. It cannot be printed.' };
  }

  const content = renderLabel({
    claimReference: await claimReferenceFor(job.claim_id),
    customerDisplayName: job.customer_display_name,
    itemCode: job.item_code,
    itemName: job.item_name,
    gramsPerPiece: job.grams_per_piece,
    quantity: job.quantity,
    totalPrice: job.total_price,
    labelSize: job.label_size,
  });

  const outcome = await send(transport, content);

  // Unsupported is not an attempt. Recording it as a failed print would invite a
  // retry that can never succeed and would pollute the attempt history with
  // something that never reached a device.
  if (outcome.status === 'unsupported') {
    await recordAuditEvent({
      action: 'label_job.print.unsupported',
      entityType: 'label_job',
      entityId: labelJobId,
      outcome: 'failed',
      reason: outcome.reason,
      context: { transport },
    });

    return { ok: true, outcome: 'unsupported', reason: outcome.reason };
  }

  const supabase = await createClient();
  const attemptNumber = await nextAttemptNumber(labelJobId);

  const { error: attemptError } = await supabase.from('print_attempts').insert({
    label_job_id: labelJobId,
    attempt_number: attemptNumber,
    outcome: outcome.status,
    failure_reason: outcome.status === 'failed' ? outcome.reason : null,
    is_reprint: options.isReprint,
    reason: options.reason ?? null,
    transport,
  });

  if (attemptError) {
    return { ok: false, error: 'The print attempt could not be recorded.' };
  }

  // The job's status follows its latest attempt. The claim is untouched.
  await supabase
    .from('label_jobs')
    .update({
      status: outcome.status === 'printed' ? 'printed' : 'failed_print',
      last_error: outcome.status === 'failed' ? outcome.reason : null,
    })
    .eq('id', labelJobId);

  await recordAuditEvent({
    action:
      outcome.status === 'printed'
        ? options.isReprint
          ? 'label_job.reprint'
          : 'label_job.print'
        : 'label_job.print.failed',
    entityType: 'label_job',
    entityId: labelJobId,
    outcome: outcome.status === 'printed' ? 'succeeded' : 'failed',
    reason: outcome.status === 'failed' ? outcome.reason : (options.reason ?? null),
    context: {
      attempt_number: attemptNumber,
      transport,
      is_reprint: options.isReprint,
      // Restated at every attempt: the trail must never suggest otherwise.
      claim_id: job.claim_id,
      created_new_claim: false,
      created_new_reservation: false,
      reconfirmed_claim: false,
    },
  });

  return outcome.status === 'printed'
    ? { ok: true, outcome: 'printed', attemptNumber }
    : { ok: true, outcome: 'failed', attemptNumber, reason: outcome.reason };
}

/**
 * First print of a queued label job. Needs the same permission as confirming,
 * because it is the tail of that action.
 */
export async function printLabelJob(
  labelJobId: string,
  transport: TransportKind = 'browser_preview',
): Promise<PrintResult> {
  try {
    await requirePermission('confirm_claim_print_label');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'label_job.print',
        entityType: 'label_job',
        entityId: labelJobId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  return attempt(labelJobId, transport, { isReprint: false });
}

/**
 * Retry Print — re-attempts a FAILED job.
 *
 * Distinct from a reprint: nothing printed yet, so there is nothing to explain.
 * No reason is required, and no business record is created.
 */
export async function retryPrint(
  labelJobId: string,
  transport: TransportKind = 'browser_preview',
): Promise<PrintResult> {
  try {
    await requirePermission('retry_reprint_label');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'label_job.retry',
        entityType: 'label_job',
        entityId: labelJobId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const job = await loadJob(labelJobId);
  if (!job) {
    return { ok: false, error: 'That label job could not be found.' };
  }

  // Retry is for failures. A job that already printed needs a REPRINT, which is
  // a different intent and carries a reason.
  if (job.status === 'printed') {
    return {
      ok: false,
      error: 'That label already printed. Use Reprint with a reason instead.',
    };
  }

  return attempt(labelJobId, transport, { isReprint: false });
}

/**
 * Reprint — deliberately prints again a job that already printed.
 *
 * Requires a reason (§24.17, provisional — required here as the safer default).
 * Creates a new ATTEMPT on the same job: no new claim, no new reservation, no
 * reconfirmation, no Official Order.
 */
export async function reprintLabel(
  labelJobId: string,
  reason: string,
  transport: TransportKind = 'browser_preview',
): Promise<PrintResult> {
  try {
    await requirePermission('retry_reprint_label');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'label_job.reprint',
        entityType: 'label_job',
        entityId: labelJobId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: false, error: 'A reprint requires a reason.' };
  }

  return attempt(labelJobId, transport, { isReprint: true, reason: trimmed });
}

/**
 * Void / Cancel Label Job (Bible §24).
 *
 * Cancels a piece of paper. It does NOT cancel the claim, release the
 * reservation, return stock, or touch an order — the database trigger
 * `label_jobs_void_is_paper_only` refuses if the claim no longer stands.
 */
export async function voidLabelJob(
  labelJobId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('void_cancel_label_job');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'label_job.void',
        entityType: 'label_job',
        entityId: labelJobId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: false, error: 'Voiding a label job requires a reason.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('label_jobs')
    .update({ status: 'voided', voided_reason: trimmed })
    .eq('id', labelJobId)
    .select('id, claim_id');

  if (error || !data || data.length === 0) {
    await recordAuditEvent({
      action: 'label_job.void',
      entityType: 'label_job',
      entityId: labelJobId,
      outcome: 'failed',
      reason: error?.message ?? 'no row updated',
    });
    return { ok: false, error: 'The label job could not be voided.' };
  }

  await recordAuditEvent({
    action: 'label_job.void',
    entityType: 'label_job',
    entityId: labelJobId,
    reason: trimmed,
    context: {
      claim_id: data[0]?.claim_id,
      // The trail states what voiding did not do, because that is the point.
      claim_cancelled: false,
      reservation_released: false,
      stock_returned: false,
      order_changed: false,
    },
  });

  return { ok: true };
}
