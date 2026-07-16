'use server';

import type { InvoiceActionState } from '@/lib/invoicing/action-state';
import { EMPTY_INVOICE_STATE } from '@/lib/invoicing/action-state';
import { revalidatePath } from 'next/cache';

import {
  approveAllReadyInvoices,
  approveAndSendInvoice,
  markDraftReviewed,
} from '@/lib/invoicing/approve';
import { prepareAllEligibleInvoices, removeClaimFromDraft } from '@/lib/invoicing/drafts';
import {
  markMessageSent,
  prepareInvoiceMessage,
  recordMessageCopied,
} from '@/lib/invoicing/messages';

/**
 * Phase 5 server actions (Bible §15, §22.8–22.9).
 *
 * Transport only: permission, eligibility, grouping, idempotency, and audit all
 * live in the domain modules and the database.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function prepareAllEligibleAction(
  _prev: InvoiceActionState,
  _formData: FormData,
): Promise<InvoiceActionState> {
  const result = await prepareAllEligibleInvoices();
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  revalidatePath('/invoice');

  const { created, skipped, excluded } = result.data;

  return {
    ...EMPTY_INVOICE_STATE,
    success:
      `Prepared ${created.length} Invoice Draft(s). ` +
      `${skipped.length} skipped, ${excluded.length} claim(s) excluded. ` +
      'No Official Order was created and no message was sent.',
  };
}

/**
 * Approve & Send Invoice.
 *
 * The order and the message are reported separately. If the order exists and the
 * message fails, the honest result is "Official Order created — message sending
 * failed", never a failure — the stock really is committed.
 */
export async function approveAndSendAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const draftId = text(formData, 'invoiceDraftId');
  if (!draftId) return { ...EMPTY_INVOICE_STATE, error: 'An Invoice Draft is required.' };

  const result = await approveAndSendInvoice(draftId);
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  revalidatePath('/invoice');

  const order = {
    officialOrderId: result.officialOrderId,
    orderNumber: result.orderNumber,
    invoiceNumber: result.invoiceNumber,
  };

  // The order stands from here on. Everything below is about the message.
  const message = await prepareInvoiceMessage(result.officialOrderId);

  if (!message.ok) {
    return { ...EMPTY_INVOICE_STATE, order, messageProblem: message.error };
  }

  return {
    ...EMPTY_INVOICE_STATE,
    order,
    messageBody: message.body,
    messageId: message.customerMessageId,
    success: result.deduplicated
      ? `This draft was already sent as ${result.orderNumber}. No second Official Order was created.`
      : `Official Order ${result.orderNumber} created (invoice ${result.invoiceNumber}). Copy the message and send it.`,
  };
}

export async function approveAllReadyAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  // Bulk approval is explicit. Without the confirmation token this is a no-op,
  // so a stray click cannot commit every ready invoice at once.
  if (text(formData, 'confirm') !== 'yes') {
    return {
      ...EMPTY_INVOICE_STATE,
      error: 'Bulk approval requires explicit confirmation.',
    };
  }

  const result = await approveAllReadyInvoices();
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  revalidatePath('/invoice');

  const { succeeded, failed } = result.data;

  return {
    ...EMPTY_INVOICE_STATE,
    success: `${succeeded.length} Official Order(s) created. ${failed.length} draft(s) failed and were left untouched — successful orders were not rolled back.`,
    ...(failed.length > 0
      ? { messageProblem: failed.map((f) => f.error).join(' · ') }
      : {}),
  };
}

export async function markReviewedAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const draftId = text(formData, 'invoiceDraftId');
  if (!draftId) return { ...EMPTY_INVOICE_STATE, error: 'An Invoice Draft is required.' };

  const result = await markDraftReviewed(draftId);
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  revalidatePath('/invoice');
  return { ...EMPTY_INVOICE_STATE, success: 'Draft reviewed and ready to send.' };
}

export async function removeClaimAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const draftId = text(formData, 'invoiceDraftId');
  const claimId = text(formData, 'claimId');
  const reason = text(formData, 'reason');

  if (!draftId || !claimId)
    return { ...EMPTY_INVOICE_STATE, error: 'A claim is required.' };
  if (!reason)
    return { ...EMPTY_INVOICE_STATE, error: 'Removing a claim requires a reason.' };

  const result = await removeClaimFromDraft(draftId, claimId, reason);
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  revalidatePath('/invoice');
  return {
    ...EMPTY_INVOICE_STATE,
    success: 'Claim removed from the draft. Its reservation is unchanged.',
  };
}

/** Records the copy. Copying is not sending, and this changes no status. */
export async function copyMessageAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const messageId = text(formData, 'messageId');
  if (!messageId) return { ...EMPTY_INVOICE_STATE, error: 'A message is required.' };

  const result = await recordMessageCopied(messageId);
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  return {
    ...EMPTY_INVOICE_STATE,
    success:
      'Copied. Copying is not sending — use Mark as Sent once you have actually sent it.',
  };
}

export async function markSentAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const messageId = text(formData, 'messageId');
  if (!messageId) return { ...EMPTY_INVOICE_STATE, error: 'A message is required.' };

  const result = await markMessageSent(messageId);
  if (!result.ok) return { ...EMPTY_INVOICE_STATE, error: result.error };

  revalidatePath('/invoice');
  return {
    ...EMPTY_INVOICE_STATE,
    success:
      'Marked as sent. This records your attestation — the system did not observe delivery.',
  };
}

/**
 * Retries only the MESSAGE for an order that already exists.
 * It cannot create another Official Order: it never touches official_orders.
 */
export async function retryMessageAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const orderId = text(formData, 'officialOrderId');
  if (!orderId)
    return { ...EMPTY_INVOICE_STATE, error: 'An Official Order is required.' };

  const message = await prepareInvoiceMessage(orderId);
  if (!message.ok) return { ...EMPTY_INVOICE_STATE, messageProblem: message.error };

  revalidatePath('/invoice');
  return {
    ...EMPTY_INVOICE_STATE,
    messageBody: message.body,
    messageId: message.customerMessageId,
    success: 'Message ready. No second Official Order was created.',
  };
}
