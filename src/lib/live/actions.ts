'use server';

import { revalidatePath } from 'next/cache';

import { captureClaim } from '@/lib/claims/capture';
import { createLiveBatch, transitionLiveBatch } from '@/lib/live/batches';
import { setCurrentFlexItem } from '@/lib/live/flex-item';

/**
 * Phase 3 server actions (Bible §12, §13).
 *
 * These are the thin transport layer only. Every rule — permission, validation,
 * state transition, idempotency, audit — lives in the domain modules and runs
 * server-side, so an action invoked directly (bypassing the UI entirely) is
 * checked exactly the same way. The UI is never the control (ADR §7).
 */

export type ActionState = { error: string | null; success: string | null };

export const EMPTY_ACTION_STATE: ActionState = { error: null, success: null };

/**
 * Reads a text field.
 *
 * `FormData.get` returns `string | File`. Coercing that with String() would turn
 * an uploaded file into the literal text "[object File]" and hand it to a
 * validator as if it were a real value. A File is not text, so it reads as
 * absent and the schema rejects it properly.
 */
function textField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function createLiveBatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await createLiveBatch({
    title: textField(formData, 'title'),
    scopeId: textField(formData, 'scopeId'),
  });

  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath('/live');
  return {
    error: null,
    success: `Live Batch ${result.data.batchReference} created as a draft.`,
  };
}

export async function transitionLiveBatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const transition = textField(formData, 'transition') ?? '';
  const result = await transitionLiveBatch({
    liveBatchId: textField(formData, 'liveBatchId'),
    transition,
  });

  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath('/live');
  return { error: null, success: `Live Batch ${transition}ed.` };
}

export async function setCurrentFlexItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await setCurrentFlexItem({
    liveBatchId: textField(formData, 'liveBatchId'),
    liveBatchItemId: textField(formData, 'liveBatchItemId'),
  });

  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath('/live');
  return {
    error: null,
    success: 'Current Flex Item updated. This affects future capture only.',
  };
}

/**
 * Captures a Pending Claim.
 *
 * The idempotency key comes from the form, so a resubmitted page (the classic
 * flaky-signal double tap during a Live) reuses it and returns the SAME claim.
 */
export async function captureClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const quantityRaw = textField(formData, 'quantity');

  const result = await captureClaim({
    idempotencyKey: textField(formData, 'idempotencyKey'),
    captureMethod: textField(formData, 'captureMethod'),
    liveBatchId: textField(formData, 'liveBatchId'),
    liveBatchItemId: textField(formData, 'liveBatchItemId'),
    inventoryItemId: textField(formData, 'inventoryItemId'),
    customerId: textField(formData, 'customerId'),
    quantity: quantityRaw ? Number(quantityRaw) : 1,
    note: textField(formData, 'note'),
  });

  if (!result.ok) {
    return { error: result.error, success: null };
  }

  revalidatePath('/live');
  revalidatePath('/claims');

  // Says "Pending Claim" on purpose. A capture that reports "order created"
  // would be lying about what just happened.
  return {
    error: null,
    success: result.deduplicated
      ? `Already captured as Pending Claim ${result.claimReference}. No second claim was created.`
      : `Pending Claim ${result.claimReference} captured. No reservation was made.`,
  };
}
