'use server';

import type { InventoryActionState } from '@/lib/inventory/action-state';
import { revalidatePath } from 'next/cache';

import {
  decideRtsReview,
  openMigrationBatch,
  returnItemToAvailable,
  reviewDuplicate,
  type FreedUnitOutcome,
} from '@/lib/inventory/service';

/**
 * Phase 8 server actions (Bible §19, §10, §22.15–22.16).
 *
 * Transport only. Authority, the return rule, the no-auto-merge rule, and audit
 * all live in the domain module and the database.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function decideRtsAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const reviewId = text(formData, 'reviewId');
  const decision = text(formData, 'decision');
  const outcome = text(formData, 'freedUnitOutcome');

  if (!reviewId) return { error: 'A review is required.', success: null };
  if (decision !== 'approved_return' && decision !== 'rejected_held') {
    return { error: 'A decision is required.', success: null };
  }
  if (!outcome) {
    return { error: 'Record what happens to the freed unit.', success: null };
  }

  const result = await decideRtsReview(
    reviewId,
    decision,
    outcome as FreedUnitOutcome,
    text(formData, 'note') ?? undefined,
  );

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');

  return {
    error: null,
    success:
      decision === 'approved_return'
        ? 'Review approved. Returning the item to available is a separate step — no miner was promoted and no waitlist was allocated.'
        : 'Review rejected. The unit is held; it did not return to available.',
  };
}

export async function returnToAvailableAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  if (!itemId) return { error: 'An item is required.', success: null };

  const result = await returnItemToAvailable(itemId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: 'Item returned to available via its approved review.' };
}

export async function reviewDuplicateAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const referenceId = text(formData, 'referenceId');
  const judgement = text(formData, 'judgement');

  if (!referenceId) return { error: 'A reference is required.', success: null };
  if (judgement !== 'reviewed_distinct' && judgement !== 'reviewed_duplicate') {
    return { error: 'A judgement is required.', success: null };
  }

  const result = await reviewDuplicate(
    referenceId,
    judgement,
    text(formData, 'note') ?? undefined,
  );

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');

  return {
    error: null,
    // Says plainly that nothing merged, because that is the whole rule.
    success:
      judgement === 'reviewed_duplicate'
        ? 'Recorded as a duplicate. Nothing was merged — merge mechanics are deferred.'
        : 'Recorded as distinct customers.',
  };
}

export async function openMigrationBatchAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const label = text(formData, 'label');
  const source = text(formData, 'sourceDescription');

  if (!label || !source) {
    return {
      error: 'A migration batch needs a label and a source description.',
      success: null,
    };
  }

  const result = await openMigrationBatch(label, source);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return {
    error: null,
    success:
      'Migration batch opened. Migrated records carry this batch and create no claims.',
  };
}
