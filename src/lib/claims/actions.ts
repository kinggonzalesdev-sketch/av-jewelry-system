'use server';

import type { ConfirmActionState, LabelActionState } from '@/lib/claims/action-state';
import { EMPTY_CONFIRM_STATE } from '@/lib/claims/action-state';
import { revalidatePath } from 'next/cache';

import { confirmClaimAndPrint } from '@/lib/claims/confirm';
import { printLabelJob, reprintLabel, retryPrint, voidLabelJob } from '@/lib/labels/jobs';

/**
 * Phase 4 server actions (Bible §22.6, §22.7, §24).
 *
 * Transport only. Permission, state, availability, idempotency, and audit all
 * live in the domain modules and the database, so invoking these directly —
 * bypassing the UI entirely — is checked identically.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Confirm Claim & Print Label.
 *
 * Confirmation and printing are reported SEPARATELY, because they are separate
 * facts. If the claim is confirmed and the printer fails, the honest message is
 * "Claim confirmed — label printing failed", not "confirmation failed": the item
 * really is reserved, and telling the operator otherwise would send them to
 * confirm it again.
 */
export async function confirmClaimAction(
  _prev: ConfirmActionState,
  formData: FormData,
): Promise<ConfirmActionState> {
  const claimId = text(formData, 'claimId');
  if (!claimId) {
    return { ...EMPTY_CONFIRM_STATE, error: 'A claim reference is required.' };
  }

  const result = await confirmClaimAndPrint(claimId, {
    printerTarget: text(formData, 'printerTarget'),
    labelSize: text(formData, 'labelSize') ?? '40x30mm',
  });

  if (!result.ok) {
    // Confirmation itself failed. Nothing was reserved.
    return { ...EMPTY_CONFIRM_STATE, error: result.error };
  }

  revalidatePath('/claims');

  const confirmed = {
    claimId: result.claimId,
    labelJobId: result.labelJobId,
    deduplicated: result.deduplicated,
  };

  // The claim is now confirmed and reserved. Everything below is about paper.
  const print = await printLabelJob(result.labelJobId, 'browser_preview');

  if (!print.ok) {
    return {
      ...EMPTY_CONFIRM_STATE,
      confirmed,
      printProblem: print.error,
    };
  }

  if (print.outcome === 'unsupported') {
    return { ...EMPTY_CONFIRM_STATE, confirmed, printProblem: print.reason };
  }

  if (print.outcome === 'failed') {
    return { ...EMPTY_CONFIRM_STATE, confirmed, printProblem: print.reason };
  }

  return {
    ...EMPTY_CONFIRM_STATE,
    confirmed,
    success: result.deduplicated
      ? 'This claim was already confirmed. No second reservation was created.'
      : 'Claim confirmed and reserved. Label sent to preview.',
  };
}

export async function retryPrintAction(
  _prev: LabelActionState,
  formData: FormData,
): Promise<LabelActionState> {
  const labelJobId = text(formData, 'labelJobId');
  if (!labelJobId) return { error: 'A label job is required.', success: null };

  const result = await retryPrint(labelJobId, 'browser_preview');
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/claims');

  if (result.outcome === 'unsupported') return { error: result.reason, success: null };
  if (result.outcome === 'failed') {
    return { error: `Print failed again: ${result.reason}`, success: null };
  }

  return {
    error: null,
    success: `Printed on attempt ${result.attemptNumber}. No new claim or reservation was created.`,
  };
}

export async function reprintLabelAction(
  _prev: LabelActionState,
  formData: FormData,
): Promise<LabelActionState> {
  const labelJobId = text(formData, 'labelJobId');
  const reason = text(formData, 'reason');

  if (!labelJobId) return { error: 'A label job is required.', success: null };
  if (!reason) return { error: 'A reprint requires a reason.', success: null };

  const result = await reprintLabel(labelJobId, reason, 'browser_preview');
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/claims');

  if (result.outcome === 'unsupported') return { error: result.reason, success: null };
  if (result.outcome === 'failed') {
    return { error: `Reprint failed: ${result.reason}`, success: null };
  }

  return {
    error: null,
    success: `Reprinted as attempt ${result.attemptNumber}. No business record was duplicated.`,
  };
}

export async function voidLabelJobAction(
  _prev: LabelActionState,
  formData: FormData,
): Promise<LabelActionState> {
  const labelJobId = text(formData, 'labelJobId');
  const reason = text(formData, 'reason');

  if (!labelJobId) return { error: 'A label job is required.', success: null };
  if (!reason) return { error: 'Voiding a label job requires a reason.', success: null };

  const result = await voidLabelJob(labelJobId, reason);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/claims');

  return {
    error: null,
    success: 'Label job voided. The claim stands and the reservation is unchanged.',
  };
}
