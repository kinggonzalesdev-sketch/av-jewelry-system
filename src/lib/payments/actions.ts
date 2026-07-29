'use server';

import type {
  PaymentActionState,
  RecordPaymentActionState,
} from '@/lib/payments/action-state';
import { revalidatePath } from 'next/cache';

import {
  findOrCreateFinancer,
  setLayawayDetails,
  type FindOrCreateFinancerResult,
} from '@/lib/payments/financer';
import {
  activateLayaway,
  listAvailableLayawayCodes,
  decideForfeiture,
  recordInstallment,
  requestForfeiture,
} from '@/lib/payments/layaway';
import { recordPayment, verifyPayment } from '@/lib/payments/verification';
import { recordDirectDeletion } from '@/lib/authz/deletion-requests';
import {
  createLayawayAccount,
  previewLayawayCode,
  type CreateLayawayInput,
  type CreateLayawayResult,
} from '@/lib/payments/layaway-entry';
import { completeOrderForPaymentIfPaidInFull } from '@/lib/orders/complete-on-payment';
import {
  addLayawayLedgerPayment,
  deleteAllLayawayLedger,
  deleteLayawayLedgerRow,
  getLayawayLedgerDetail,
  importLayawayLedger,
  updateLayawayLedgerAccount,
  type AddLedgerPaymentInput,
  type LayawayLedgerDetail,
  type LayawayLedgerInput,
  type LedgerDeleteResult,
  type LedgerImportResult,
  type LedgerPaymentResult,
  type LedgerUpdateResult,
  type UpdateLedgerAccountInput,
} from '@/lib/payments/layaway-ledger';

/**
 * Phase 6 server actions (Bible §16, §17).
 *
 * Transport only. Permission, stored-state revalidation, the 20% threshold, the
 * money math, and audit all live in the domain modules and the database, so an
 * action invoked directly — bypassing the UI — is checked identically.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Record a submitted payment.
 *
 * The payment is born `submitted_unverified` — always. This action cannot
 * verify, cannot mark Paid in Full, and takes no `status` or `verifiedAmount`
 * field, because recording and verifying are different acts by different
 * authority (§16). Collapsing them would let a screenshot pay for a ring.
 *
 * ⚠️  NO CARD DATA. There is no field here for a card number, CVV, or PIN, and
 *     none may be added — `provider` holds the channel and `referenceNumber` the
 *     approval reference, which is the entire permitted card footprint (§3).
 *     Zod strips anything else a caller sends.
 */
export async function recordPaymentAction(
  _prev: RecordPaymentActionState,
  formData: FormData,
): Promise<RecordPaymentActionState> {
  // Evidence is a REFERENCE, not an upload. V1 records where the proof lives;
  // Storage wiring was never built (documented, not forgotten), so the form
  // captures the reference the staff member can produce on request rather than
  // pretending a file was stored.
  const evidenceRef = text(formData, 'evidenceReference');
  const evidenceNote = text(formData, 'evidenceNote');

  const result = await recordPayment({
    officialOrderId: text(formData, 'officialOrderId'),
    amount: text(formData, 'amount'),
    paymentMethod: text(formData, 'paymentMethod'),
    referenceNumber: text(formData, 'referenceNumber'),
    provider: text(formData, 'provider'),
    transactedAt: text(formData, 'transactedAt'),
    collectionLocation: text(formData, 'collectionLocation'),
    note: text(formData, 'note'),
    evidence: evidenceRef
      ? [{ storagePath: evidenceRef, note: evidenceNote }]
      : undefined,
  });

  if (!result.ok) {
    return { error: result.error, success: null, duplicateReferenceFlagged: false };
  }

  revalidatePath('/orders/payments');

  return {
    error: null,
    duplicateReferenceFlagged: result.duplicateReferenceFlagged,
    // Says exactly what happened, and what did NOT. An operator who reads
    // "payment recorded" and walks away believing the order is paid is the
    // failure this wording exists to prevent.
    success: result.duplicateReferenceFlagged
      ? 'Payment evidence recorded as UNVERIFIED — and its reference number matches an existing payment. Flagged for review, not rejected. It counts toward no balance until verified.'
      : 'Payment evidence recorded as UNVERIFIED. It counts toward no balance until someone with Payment Verification verifies it.',
  };
}

export async function verifyPaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const paymentId = text(formData, 'paymentId');
  const verifiedAmount = text(formData, 'verifiedAmount');

  if (!paymentId) return { error: 'A payment is required.', success: null };
  if (!verifiedAmount) {
    return {
      error: 'Verifying requires the amount that actually arrived.',
      success: null,
    };
  }

  const result = await verifyPayment(paymentId, 'verified', { verifiedAmount });
  if (!result.ok) return { error: result.error, success: null };

  // Auto-complete when this verification makes the order paid in full (Owner
  // decision 2026-07-25). Kept OUT of verifyPayment so verification stays
  // money-only; this is a separate, idempotent step that also retires inventory.
  const completed = await completeOrderForPaymentIfPaidInFull(paymentId);

  revalidatePath('/orders/payments');
  if (completed) {
    revalidatePath('/orders');
    revalidatePath('/orders/inventory');
  }

  return {
    error: null,
    success: result.deduplicated
      ? 'This payment was already decided. No second verification was recorded.'
      : completed
        ? `Payment verified for ₱${verifiedAmount}. The order is now paid in full — moved to Completed and its items retired from inventory.`
        : // Says exactly what happened. Verified is not Paid in Full.
          `Payment verified for ₱${verifiedAmount}. Only the verified amount reduces the balance.`,
  };
}

/**
 * Import a batch of layaway ledger rows (Owner/Admin). Transport only — the
 * dedup, account-number generation, and permission live in the domain module and
 * the database. On success the Layaway page revalidates so the table + cards
 * refresh without a full-page reload.
 */
export async function importLayawayLedgerAction(
  rows: LayawayLedgerInput[],
): Promise<LedgerImportResult> {
  const result = await importLayawayLedger(rows);
  if (result.ok) {
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Load one imported ledger account + its installment schedule & payment history. */
export async function loadLayawayLedgerDetailAction(
  id: string,
): Promise<LayawayLedgerDetail | null> {
  if (!id) return null;
  return getLayawayLedgerDetail(id);
}

/** Record a payment against an imported layaway account (Owner/Admin). Revalidates
 *  the Layaway page + dashboard so Payment/Balance/status refresh without a reload. */
export async function addLayawayLedgerPaymentAction(
  input: AddLedgerPaymentInput,
): Promise<LedgerPaymentResult> {
  const result = await addLayawayLedgerPayment(input);
  if (result.ok) {
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Edit an imported layaway account's correctable fields (Owner/Admin). */
export async function updateLayawayLedgerAccountAction(
  input: UpdateLedgerAccountInput,
): Promise<LedgerUpdateResult> {
  const result = await updateLayawayLedgerAccount(input);
  if (result.ok) {
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
  }
  return result;
}

/**
 * Delete ONE layaway ledger account. Super Admin only in practice — an Admin now
 * uses Request Deletion instead (§2). The delete itself keeps its own guard; this
 * additionally RECORDS the deletion in the register, so a direct deletion by a
 * Super Admin is accounted for like any other.
 */
export async function deleteLayawayLedgerRowAction(
  id: string,
  label?: string,
): Promise<LedgerDeleteResult> {
  const result = await deleteLayawayLedgerRow(id);
  if (result.ok) {
    await recordDirectDeletion({
      entityType: 'layaway_ledger',
      entityId: id,
      entityLabel: label ?? 'Layaway account',
    });
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
    revalidatePath('/admin/deletions');
  }
  return result;
}

/** Delete ALL imported layaway ledger accounts (Owner/Admin). Revalidates on success. */
export async function deleteAllLayawayLedgerAction(): Promise<LedgerDeleteResult> {
  const result = await deleteAllLayawayLedger();
  if (result.ok) {
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
  }
  return result;
}

export async function rejectPaymentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const paymentId = text(formData, 'paymentId');
  const note = text(formData, 'note');

  if (!paymentId) return { error: 'A payment is required.', success: null };
  if (!note) return { error: 'Rejecting evidence requires a reason.', success: null };

  const result = await verifyPayment(paymentId, 'rejected', { note });
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/payments');
  return { error: null, success: 'Evidence rejected. It counts toward no balance.' };
}

/** Free layaway codes for one customer-initial letter (A1–Z200). Read-only. */
export async function loadAvailableLayawayCodesAction(
  letter: string,
): Promise<string[]> {
  return listAvailableLayawayCodes(letter);
}

/** The code that WOULD be assigned for a customer name right now — reserves
 *  nothing. Drives the read-only "Assigned Layaway Code" preview as the operator
 *  types the customer name. */
export async function previewLayawayCodeAction(
  customerName: string,
): Promise<{ letter: string | null; code: string | null }> {
  return previewLayawayCode(customerName);
}

export async function activateLayawayAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const months = text(formData, 'months');

  const result = await activateLayaway({
    officialOrderId: text(formData, 'officialOrderId'),
    depositPaymentId: text(formData, 'depositPaymentId'),
    months: months ? Number(months) : 0,
    finalDueDate: text(formData, 'finalDueDate'),
    layawayCode: text(formData, 'layawayCode'),
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/payments');
  return {
    error: null,
    success: 'Layaway activated. The verified deposit met the 20% threshold.',
  };
}

export async function recordInstallmentAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const number = text(formData, 'installmentNumber');

  const result = await recordInstallment({
    layawayArrangementId: text(formData, 'layawayArrangementId'),
    installmentNumber: number ? Number(number) : 0,
    amountDue: text(formData, 'amountDue'),
    dueDate: text(formData, 'dueDate'),
    paymentId: text(formData, 'paymentId'),
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/payments');
  return {
    error: null,
    // Recording is not verifying, and the message must not imply otherwise.
    success: 'Installment recorded. Its payment still needs separate verification.',
  };
}

/** Find or create a financer by normalized name (manual entry, dedupe). Returns
 *  the resolved financer so the client can select it. */
export async function findOrCreateFinancerAction(
  name: string,
): Promise<FindOrCreateFinancerResult> {
  const result = await findOrCreateFinancer(name);
  if (result.ok) {
    revalidatePath('/orders/payments');
    revalidatePath('/dashboard');
  }
  return result;
}

export async function setLayawayDetailsAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const result = await setLayawayDetails({
    layawayArrangementId: text(formData, 'layawayArrangementId'),
    financerId: text(formData, 'financerId'),
    currentHolder: text(formData, 'currentHolder'),
    currentLocation: text(formData, 'currentLocation'),
    remarks: text(formData, 'remarks'),
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/payments');
  return { error: null, success: result.message };
}

export async function requestForfeitureAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const layawayId = text(formData, 'layawayArrangementId');
  const reason = text(formData, 'reason');

  if (!layawayId) return { error: 'A Layaway is required.', success: null };
  if (!reason) return { error: 'A forfeiture request requires a reason.', success: null };

  const result = await requestForfeiture(layawayId, reason);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/payments');
  return {
    error: null,
    success:
      'Forfeiture requested and sent for Owner approval. Nothing was forfeited and no stock was returned.',
  };
}

export async function decideForfeitureAction(
  _prev: PaymentActionState,
  formData: FormData,
): Promise<PaymentActionState> {
  const requestId = text(formData, 'approvalRequestId');
  const decision = text(formData, 'decision');

  if (!requestId) return { error: 'An approval request is required.', success: null };
  if (decision !== 'approved' && decision !== 'rejected') {
    return { error: 'A decision is required.', success: null };
  }

  const result = await decideForfeiture(
    requestId,
    decision,
    text(formData, 'note') ?? undefined,
  );
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/payments');
  return {
    error: null,
    success:
      decision === 'approved'
        ? 'Forfeiture approved. Execution is a separate step, and the item routes to Returned-to-Stock Review — no stock returned automatically.'
        : 'Forfeiture rejected. The Layaway stands unchanged.',
  };
}

/**
 * Layaway New Entry (§1) — create a layaway account by manual encoding.
 *
 * Transport only; `createLayawayAccount` and the guarded SQL behind it do the
 * work atomically. On success everything the entry touched revalidates —
 * Layaway, Inventory (the item just left Active Inventory), Orders and the
 * Dashboard — so the screens agree without a full-page reload.
 */
export async function createLayawayAccountAction(
  input: CreateLayawayInput,
): Promise<CreateLayawayResult> {
  const result = await createLayawayAccount(input);
  if (result.ok) {
    revalidatePath('/orders/payments');
    revalidatePath('/orders/inventory');
    revalidatePath('/orders');
    revalidatePath('/dashboard');
  }
  return result;
}
