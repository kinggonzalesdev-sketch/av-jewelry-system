'use server';

import type { InventoryActionState } from '@/lib/inventory/action-state';
import { revalidatePath } from 'next/cache';

import {
  requestInventoryDelete,
  requestInventoryEdit,
  type InventoryEditProposal,
  type InventoryRequestResult,
} from '@/lib/inventory/requests';

import {
  archiveInventoryItem,
  deleteAllInventoryItems,
  deleteInventoryItemDirect,
  forceDeleteInventoryItem,
  editInventoryItemDetails,
  getItemDependencies,
  permanentlyDeleteInventoryItem,
  restoreInventoryItem,
  type DeleteAllInventoryResult,
  type ItemDependency,
} from '@/lib/inventory/archive';
import {
  returnCompletedItemToInventory,
  returnCompletedItemToReview,
} from '@/lib/inventory/completed';
import { createInventoryEntry } from '@/lib/inventory/create';
import {
  getInventoryGramsTotals,
  type InventoryGramsTotals,
} from '@/lib/inventory/grams-totals';
import {
  importInventoryItems,
  type ImportItemInput,
  type ImportResult,
} from '@/lib/inventory/import';
import {
  parseInventoryWorkbook,
  type ParseWorkbookResult,
} from '@/lib/inventory/workbook-import';
import {
  decideRtsReview,
  listInventory,
  listInventoryActivePage,
  openMigrationBatch,
  returnItemToAvailable,
  reviewDuplicate,
  updateItemCustody,
  type FreedUnitOutcome,
  type InventoryListResult,
  type InventoryPageResult,
} from '@/lib/inventory/service';
import {
  listCompletedInventory,
  listCompletedInventoryPage,
  type CompletedInventoryPageResult,
  type CompletedInventoryRow,
} from '@/lib/inventory/completed';

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

/** Load one PAGE of Active Inventory (server-side pagination, Owner request). The active
 *  filter + search + status + group + count all happen in SQL; safe + cheap to call from
 *  the workspace on every search / filter / page change. */
export async function loadInventoryActivePageAction(opts: {
  search?: string;
  status?: string;
  group?: string;
  page?: number;
  size?: number;
}): Promise<InventoryPageResult> {
  return listInventoryActivePage(opts);
}

/** Load the FULL Active Inventory for a CSV export (a rare action) — reuses the proven
 *  full reader so the export still contains EVERY filtered row, not just the page. */
export async function loadInventoryForExportAction(): Promise<InventoryListResult> {
  return listInventory();
}

/** Re-read the two GLOBAL Total Grams totals after a mutation (New Entry / Edit / Delete
 *  bump the client reload token). Role-gated in the reader — a Staff session gets null and
 *  the cards never render for them. One cheap SQL aggregate; no polling, no realtime. */
export async function loadInventoryGramsTotalsAction(): Promise<InventoryGramsTotals | null> {
  return getInventoryGramsTotals();
}

/** Lazy-load Completed Items ON DEMAND — it is 900+ rows with order/customer/fulfillment
 *  joins, so it is NO LONGER on the initial page load (that made opening Inventory slow).
 *  The workspace fetches it only when the operator actually opens the Completed Items tab. */
export async function loadCompletedInventoryAction(): Promise<CompletedInventoryRow[]> {
  return listCompletedInventory();
}

/** Load ONE PAGE of Completed Items with an EXACT server-side total + per-type counts
 *  (Owner request — no "999 of 999" cap). The count comes from SQL, never from the number
 *  of rows the browser holds; safe + cheap to call on every search / filter / page change. */
export async function loadCompletedInventoryPageAction(opts: {
  search?: string;
  type?: string;
  page?: number;
  size?: number;
}): Promise<CompletedInventoryPageResult> {
  return listCompletedInventoryPage(opts);
}

/** New Entry: create an inventory item from a required, unique item code, an
 *  optional price, and an editable Date Encoded (Owner request 2026-07-24).
 *  Gated by `post_live_item_entry` in the domain module + RLS. */
export async function createInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const result = await createInventoryEntry(
    text(formData, 'itemCode') ?? '',
    text(formData, 'unitPrice'),
    text(formData, 'dateEncoded'),
    text(formData, 'acknowledgeWarning') === '1',
  );
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: 'New item added to inventory.' };
}

/**
 * Owner-only: parse an uploaded Excel/CSV workbook (every worksheet) and return the
 * detected inventory candidates + summary for the preview. Nothing is written; the
 * confirmed insert is `importInventoryItemsAction`.
 */
export async function parseInventoryWorkbookAction(
  formData: FormData,
): Promise<ParseWorkbookResult> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose a file to import.' };
  const buffer = await file.arrayBuffer();
  return parseInventoryWorkbook(file.name, buffer);
}

/** Bulk import of validated inventory rows (spec §B). Preserves original codes,
 *  skips existing, permission-gated + audited in the domain module. */
export async function importInventoryItemsAction(
  items: ImportItemInput[],
): Promise<ImportResult> {
  const result = await importInventoryItems(items);
  if (result.ok) revalidatePath('/orders/inventory');
  return result;
}

/** Return a completed/released item to Returned-to-Stock Review (§10). Never makes
 *  it available directly — opens an in-review record for inspection + approval. */
export async function returnCompletedItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  if (!itemId) return { error: 'An item is required.', success: null };

  const result = await returnCompletedItemToReview(itemId, text(formData, 'note'));
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: result.message };
}

/**
 * SUPER ADMIN (Owner) correction for a Completed item (mistake fix): remove the
 * order/customer info and RETURN the item to Active Inventory. Requires typing
 * DELETE. The domain fn + DB function are the real gate (Owner-only, money
 * protected). Reports how many linked orders were removed alongside the return.
 */
export async function returnCompletedItemToInventoryAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  const confirm = text(formData, 'confirm');
  if (!itemId) return { error: 'An item is required.', success: null };
  if (confirm !== 'DELETE') {
    return {
      error: 'Type DELETE to confirm returning this item to inventory.',
      success: null,
    };
  }

  const result = await returnCompletedItemToInventory(itemId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return {
    error: null,
    success:
      result.deletedOrders > 0
        ? `Item returned to Active Inventory. ${result.deletedOrders} linked order(s) removed.`
        : 'Item returned to Active Inventory. The order info was removed.',
  };
}

export async function updateItemCustodyAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const result = await updateItemCustody({
    inventoryItemId: text(formData, 'inventoryItemId'),
    custodyHolder: text(formData, 'custodyHolder'),
    storageLocation: text(formData, 'storageLocation'),
    handlerStaffId: text(formData, 'handlerStaffId'),
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: 'Custody updated.' };
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

/** Read the business records connected to an item (spec §3), for the delete
 *  confirmation modal. Read-only; the RPC re-checks inventory_monitoring. */
export async function checkItemDependenciesAction(
  inventoryItemId: string,
): Promise<{ ok: true; dependencies: ItemDependency[] } | { ok: false; error: string }> {
  return getItemDependencies(inventoryItemId);
}

/** Archive (soft delete) an incorrect / duplicate / test item (spec §2/§4). */
export async function archiveInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  if (!itemId) return { error: 'An item is required.', success: null };

  const result = await archiveInventoryItem(
    itemId,
    text(formData, 'reasonCode') ?? '',
    text(formData, 'reasonDetail'),
  );
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return {
    error: null,
    success: 'Item archived. It has left Active Inventory and can be restored.',
  };
}

/** Restore an archived item to its prior status (spec §6). */
export async function restoreInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  if (!itemId) return { error: 'An item is required.', success: null };

  const result = await restoreInventoryItem(itemId, text(formData, 'reason'));
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: 'Item restored to Active Inventory.' };
}

/** Owner-only permanent delete of an archived, dependency-free record (spec §4/§8). */
export async function permanentlyDeleteInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  if (!itemId) return { error: 'An item is required.', success: null };

  const result = await permanentlyDeleteInventoryItem(itemId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return {
    error: null,
    success: 'Item permanently deleted. The audit trail is preserved.',
  };
}

/**
 * One-step permanent delete of an inventory item (Owner/Admin). Requires typing
 * DELETE; the database blocks the delete when the item is linked to any business
 * record. Supersedes the archive delete flow (Owner request 2026-07-24).
 */
export async function deleteInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  const confirm = text(formData, 'confirm');
  if (!itemId) return { error: 'An item is required.', success: null };
  if (confirm !== 'DELETE') {
    return { error: 'Type DELETE to permanently delete this item.', success: null };
  }

  const result = await deleteInventoryItemDirect(itemId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return {
    error: null,
    success: 'Item permanently deleted. The audit trail is preserved.',
  };
}

/**
 * SUPER ADMIN (owner) force-delete — removes an item blocked only by resolved
 * records (a closed return review, a released reservation, a past live-batch
 * row). The database still refuses an item tied to a real order, payment, active
 * hold, layaway, or sale. Owner-only + type-DELETE gated. Revalidates.
 */
/**
 * Approvals Phase 2: a non-owner Admin asks the Owner to approve deleting an item.
 * Creates a pending Owner-approval request — deletes nothing until the Owner
 * approves + executes it in /approvals (which then runs delete_inventory_item_direct).
 */
export async function requestInventoryItemDeletionAction(
  itemId: string,
  _itemLabel: string,
  reason: string,
): Promise<InventoryRequestResult> {
  const result = await requestInventoryDelete(itemId, reason);
  if (result.ok) revalidatePath('/orders/inventory');
  return result;
}

/**
 * Admin (or Owner) submits an inventory EDIT for Super-Admin approval. Captures the
 * ORIGINAL + PROPOSED values in the request payload; NOTHING is mutated until a Super
 * Admin approves + executes it.
 */
export async function requestInventoryEditAction(
  itemId: string,
  proposed: InventoryEditProposal,
  reason: string,
): Promise<InventoryRequestResult> {
  const result = await requestInventoryEdit(itemId, proposed, reason);
  if (result.ok) revalidatePath('/orders/inventory');
  return result;
}

export async function forceDeleteInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  const confirm = text(formData, 'confirm');
  if (!itemId) return { error: 'An item is required.', success: null };
  if (confirm !== 'DELETE') {
    return { error: 'Type DELETE to permanently delete this item.', success: null };
  }

  const result = await forceDeleteInventoryItem(itemId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: 'Item force-deleted. The audit trail is preserved.' };
}

/** Bulk permanent delete of Active Inventory (Owner/Admin, type-DELETE gated in the
 *  UI). Items linked to a business record are skipped in the DB. Revalidates. */
export async function deleteAllInventoryItemsAction(
  confirm: string,
): Promise<DeleteAllInventoryResult> {
  if (confirm !== 'DELETE') {
    return { ok: false, error: 'Type DELETE to permanently delete all items.' };
  }
  const result = await deleteAllInventoryItems();
  if (result.ok) revalidatePath('/orders/inventory');
  return result;
}

/** Correct an item's descriptive details (spec §1/§3). Never changes price. */
export async function editInventoryItemAction(
  _prev: InventoryActionState,
  formData: FormData,
): Promise<InventoryActionState> {
  const itemId = text(formData, 'inventoryItemId');
  if (!itemId) return { error: 'An item is required.', success: null };

  const result = await editInventoryItemDetails({
    inventoryItemId: itemId,
    itemName: text(formData, 'itemName'),
    grams: text(formData, 'grams'),
    size: text(formData, 'size'),
    supplierName: text(formData, 'supplierName'),
    facebookName: text(formData, 'facebookName'),
  });
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/orders/inventory');
  return { error: null, success: 'Item details corrected.' };
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
