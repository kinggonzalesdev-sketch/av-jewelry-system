import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Inventory Ops, Returned-to-Stock, Customers & Migration (Bible §19, §10, §22.15–22.16).
 *
 * Standing rules, enforced here AND in the database:
 *   - Stock returns to available ONLY through an APPROVED Returned-to-Stock
 *     Review. Eligibility is not approval.
 *   - A forfeited item is EXCLUDED from automatic return.
 *   - An RTS review DECIDES; it never auto-promotes a 2nd miner or auto-
 *     allocates from the waitlist. "Offer to 2nd miner" is a review, not a gift.
 *   - Customers are NEVER auto-merged. Judging two records duplicates merges
 *     nothing — merge mechanics are deferred.
 *   - Migration preserves its source and fabricates no claim.
 */

export type InventoryResult = { ok: true } | { ok: false; error: string };

export type InventoryRow = {
  inventoryItemId: string;
  itemCode: string;
  itemName: string | null;
  availabilityStatus: string;
  quantityTotal: number;
  availableQuantity: number;
  reservedQuantity: number;
  inRtsReview: boolean;
  isForfeited: boolean;
  /** Custody: who holds the item and where (business requirement F). */
  custodyHolder: 'av_jewelry' | 'financer';
  storageLocation: string | null;
  handlerName: string | null;
  /** Descriptive fields for the View / Edit modals (spec §1). Money stays a
   *  string; price is NOT editable here (an existing-price change is an Owner
   *  price-override, not a correction). */
  gramsPerPiece: string | null;
  size: string | null;
  supplierName: string | null;
  /** Facebook Name — a live-selling label; may be blank, edited later. */
  facebookName: string | null;
  /** When the item was encoded (its created_at) — the "Date Encoded" column. */
  createdAt: string | null;
};

export type CustodyHolder = 'av_jewelry' | 'financer';

export type InventoryListResult =
  { ok: true; rows: InventoryRow[] } | { ok: false; reason: string };

/**
 * Inventory monitoring (§20.3): available vs remaining.
 * Availability is derived by the database, never a stored counter.
 *
 * Returns an explicit failure rather than an empty array on a read error — an
 * unreadable list must never look like "no inventory" (the session's rule).
 */
export async function listInventory(): Promise<InventoryListResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('inventory_monitor');

  if (response.error) {
    return { ok: false, reason: response.error.message };
  }

  // Custody lives on inventory_items (not the monitor RPC). Read it separately
  // and merge by id — RLS scopes both reads to active staff. A failed custody
  // read must not blank the inventory list, so it degrades to "unknown custody".
  const custodyResponse = await supabase
    .from('inventory_items')
    .select(
      'id, custody_holder, storage_location, grams_per_piece, size, supplier_name, facebook_name, created_at, custody_handler:staff_profiles!custody_handler_id ( full_name )',
    );

  const custodyById = new Map<
    string,
    {
      holder: CustodyHolder;
      location: string | null;
      handler: string | null;
      grams: string | null;
      size: string | null;
      supplier: string | null;
      facebookName: string | null;
      createdAt: string | null;
    }
  >();
  for (const row of (custodyResponse.data ?? []) as Array<{
    id: string;
    custody_holder: CustodyHolder | null;
    storage_location: string | null;
    grams_per_piece: string | number | null;
    size: string | null;
    supplier_name: string | null;
    facebook_name: string | null;
    created_at: string | null;
    custody_handler: unknown;
  }>) {
    const handler = one<{ full_name: string }>(row.custody_handler);
    custodyById.set(row.id, {
      holder: row.custody_holder ?? 'av_jewelry',
      location: row.storage_location ?? null,
      handler: handler?.full_name ?? null,
      grams:
        row.grams_per_piece === null || row.grams_per_piece === undefined
          ? null
          : String(row.grams_per_piece),
      size: row.size ?? null,
      supplier: row.supplier_name ?? null,
      facebookName: row.facebook_name ?? null,
      createdAt: row.created_at ?? null,
    });
  }

  const rows = (
    (response.data ?? []) as Array<{
      inventory_item_id: string;
      item_code: string;
      item_name: string | null;
      availability_status: string;
      quantity_total: number;
      available_quantity: number;
      reserved_quantity: number;
      in_rts_review: boolean;
      is_forfeited: boolean;
    }>
  ).map((r) => {
    const custody = custodyById.get(r.inventory_item_id);
    return {
      inventoryItemId: r.inventory_item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      availabilityStatus: r.availability_status,
      quantityTotal: r.quantity_total,
      availableQuantity: r.available_quantity,
      reservedQuantity: r.reserved_quantity,
      inRtsReview: r.in_rts_review,
      isForfeited: r.is_forfeited,
      custodyHolder: custody?.holder ?? 'av_jewelry',
      storageLocation: custody?.location ?? null,
      handlerName: custody?.handler ?? null,
      gramsPerPiece: custody?.grams ?? null,
      size: custody?.size ?? null,
      supplierName: custody?.supplier ?? null,
      facebookName: custody?.facebookName ?? null,
      createdAt: custody?.createdAt ?? null,
    };
  });

  return { ok: true, rows };
}

/** First element of a Supabase embed (array or single). */
function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

/**
 * Updates an item's custody: who holds it (A.V. Jewelry / financer), the physical
 * location, and the responsible staff member. Guarded on inventory_monitoring,
 * re-checked here and by RLS. Records the change on the row and in the audit.
 */
export async function updateItemCustody(input: {
  inventoryItemId: string | null;
  custodyHolder: string | null;
  storageLocation: string | null;
  handlerStaffId: string | null;
}): Promise<InventoryResult> {
  if (!input.inventoryItemId) return { ok: false, error: 'An item is required.' };
  if (input.custodyHolder !== 'av_jewelry' && input.custodyHolder !== 'financer') {
    return { ok: false, error: 'Custody must be A.V. Jewelry or financer.' };
  }

  let staff;
  try {
    staff = await requirePermission('inventory_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.update_custody',
        entityType: 'inventory_item',
        entityId: input.inventoryItemId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const location = input.storageLocation?.trim() || null;

  const { error } = await supabase
    .from('inventory_items')
    .update({
      custody_holder: input.custodyHolder,
      storage_location: location,
      custody_handler_id: input.handlerStaffId ?? null,
      custody_updated_at: new Date().toISOString(),
      custody_updated_by: staff.staffProfileId,
    })
    .eq('id', input.inventoryItemId);

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.update_custody',
      entityType: 'inventory_item',
      entityId: input.inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: 'The custody update could not be saved.' };
  }

  await recordAuditEvent({
    action: 'inventory_item.update_custody',
    entityType: 'inventory_item',
    entityId: input.inventoryItemId,
    context: { custody_holder: input.custodyHolder, storage_location: location },
  });

  return { ok: true };
}

export type RtsRow = {
  id: string;
  inventoryItemId: string;
  itemCode: string;
  triggerKind: string;
  status: string;
  quantity: number;
  freedUnitOutcome: string | null;
  reviewNote: string | null;
};

/** The Returned-to-Stock Review queue. */
export async function listRtsReviews(): Promise<RtsRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('returned_to_stock_reviews')
    .select(
      `id, inventory_item_id, trigger_kind, status, quantity, freed_unit_outcome,
       review_note, inventory_items ( item_code )`,
    )
    .order('created_at', { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const item = Array.isArray(r.inventory_items)
      ? (r.inventory_items[0] as { item_code: string } | undefined)
      : (r.inventory_items as { item_code: string } | null);

    return {
      id: r.id as string,
      inventoryItemId: r.inventory_item_id as string,
      itemCode: item?.item_code ?? '—',
      triggerKind: r.trigger_kind as string,
      status: r.status as string,
      quantity: r.quantity as number,
      freedUnitOutcome: (r.freed_unit_outcome as string | null) ?? null,
      reviewNote: (r.review_note as string | null) ?? null,
    };
  });
}

/** The freed-unit outcomes a reviewer may record (§19.26, provisional). */
export const FREED_UNIT_OUTCOMES = [
  'returned_to_available',
  'offered_to_second_miner_for_review',
  'sent_to_waitlist_for_review',
  'held_unavailable',
] as const;

export type FreedUnitOutcome = (typeof FREED_UNIT_OUTCOMES)[number];

/**
 * Decides a Returned-to-Stock Review.
 *
 * The reviewer records what happens to the freed unit — nothing is inferred.
 * Choosing "offer to the 2nd miner" or "send to the waitlist" creates a REVIEW,
 * not an allocation: no miner is promoted and no waitlist entry is granted here,
 * because automatic promotion and allocation are exactly what §19 forbids.
 */
export async function decideRtsReview(
  reviewId: string,
  decision: 'approved_return' | 'rejected_held',
  freedUnitOutcome: FreedUnitOutcome,
  note?: string,
): Promise<InventoryResult> {
  let staff;
  try {
    staff = await requirePermission('inventory_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'rts_review.decide',
        entityType: 'returned_to_stock_review',
        entityId: reviewId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('returned_to_stock_reviews')
    .update({
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: staff.staffProfileId,
      freed_unit_outcome: freedUnitOutcome,
      review_note: note ?? null,
    })
    .eq('id', reviewId)
    .eq('status', 'in_review')
    .select('id, inventory_item_id');

  if (error || !data || data.length === 0) {
    await recordAuditEvent({
      action: 'rts_review.decide',
      entityType: 'returned_to_stock_review',
      entityId: reviewId,
      outcome: 'failed',
      reason: error?.message ?? 'already decided or not found',
    });
    return {
      ok: false,
      error: error
        ? error.message.replace(/^ERROR:\s*/i, '').trim()
        : 'That review could not be decided. It may already have been decided.',
    };
  }

  await recordAuditEvent({
    action: 'rts_review.decide',
    entityType: 'returned_to_stock_review',
    entityId: reviewId,
    reason: note ?? null,
    context: {
      decision,
      freed_unit_outcome: freedUnitOutcome,
      inventory_item_id: data[0]?.inventory_item_id,
      // The trail states what a review does NOT do.
      miner_promoted: false,
      waitlist_allocated: false,
      auto_returned: false,
    },
  });

  return { ok: true };
}

/**
 * Returns an approved item to available.
 *
 * A SEPARATE step from approving the review — approving authorizes, this acts.
 * The database refuses if no approved review exists, or if the item was
 * forfeited.
 */
export async function returnItemToAvailable(
  inventoryItemId: string,
): Promise<InventoryResult> {
  try {
    await requirePermission('inventory_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory.return_to_available',
        entityType: 'inventory_item',
        entityId: inventoryItemId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('inventory_items')
    .update({ availability_status: 'returned_to_available' })
    .eq('id', inventoryItemId);

  if (error) {
    await recordAuditEvent({
      action: 'inventory.return_to_available',
      entityType: 'inventory_item',
      entityId: inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    // The database names the exact rule that refused; surface it.
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'inventory.return_to_available',
    entityType: 'inventory_item',
    entityId: inventoryItemId,
    context: { via_approved_review: true, automatic: false },
  });

  return { ok: true };
}

export type DuplicateRow = {
  id: string;
  customerId: string;
  customerName: string;
  duplicateId: string;
  duplicateName: string;
  status: string;
};

/** Possible-duplicate customer references awaiting a human judgement. */
export async function listDuplicateReferences(): Promise<DuplicateRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('customer_duplicate_references')
    .select(
      `id, status, customer_id, possible_duplicate_customer_id,
       customer:customers!customer_duplicate_references_customer_id_fkey ( display_name ),
       duplicate:customers!customer_duplicate_references_possible_duplicate_customer_id_fkey ( display_name )`,
    )
    .order('created_at', { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const one = <T>(v: unknown): T | null =>
      Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null);

    return {
      id: r.id as string,
      customerId: r.customer_id as string,
      customerName: one<{ display_name: string }>(r.customer)?.display_name ?? 'Unknown',
      duplicateId: r.possible_duplicate_customer_id as string,
      duplicateName:
        one<{ display_name: string }>(r.duplicate)?.display_name ?? 'Unknown',
      status: r.status as string,
    };
  });
}

/**
 * Records a judgement on a possible duplicate.
 *
 * MERGES NOTHING — even concluding "duplicate". Merge mechanics are deferred,
 * and a silent merge would rewrite whose order is whose.
 */
export async function reviewDuplicate(
  referenceId: string,
  judgement: 'reviewed_distinct' | 'reviewed_duplicate',
  note?: string,
): Promise<InventoryResult> {
  let staff;
  try {
    staff = await requirePermission('claim_review');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'customer.duplicate_reviewed',
        entityType: 'customer_duplicate_reference',
        entityId: referenceId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customer_duplicate_references')
    .update({
      status: judgement,
      reviewed_at: new Date().toISOString(),
      reviewed_by: staff.staffProfileId,
      note: note ?? null,
    })
    .eq('id', referenceId)
    .eq('status', 'open')
    .select('id');

  if (error || !data || data.length === 0) {
    return {
      ok: false,
      error: 'That reference could not be reviewed. It may already have been reviewed.',
    };
  }

  await recordAuditEvent({
    action: 'customer.duplicate_reviewed',
    entityType: 'customer_duplicate_reference',
    entityId: referenceId,
    reason: note ?? null,
    context: {
      judgement,
      // Recording a judgement merges nothing. The trail must be unambiguous.
      customers_merged: false,
      merge_mechanics: 'deferred_post_v1',
    },
  });

  return { ok: true };
}

/**
 * Opens a migration batch (Existing Record Entry / Migration, §22.16).
 *
 * Migration is SEPARATE from live intake. A migrated record carries its batch —
 * the database refuses one that does not — and no fake claim is fabricated.
 */
export async function openMigrationBatch(
  label: string,
  sourceDescription: string,
): Promise<{ ok: true; batchId: string } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('existing_record_entry');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'migration.open_batch',
        entityType: 'migration_batch',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  if (!label?.trim() || !sourceDescription?.trim()) {
    return {
      ok: false,
      error: 'A migration batch needs a label and a source description.',
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('migration_batches')
    .insert({
      label: label.trim(),
      source_description: sourceDescription.trim(),
      status: 'in_progress',
      imported_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !data)
    return { ok: false, error: 'The migration batch could not be opened.' };

  await recordAuditEvent({
    action: 'migration.open_batch',
    entityType: 'migration_batch',
    entityId: data.id as string,
    context: {
      label: label.trim(),
      // Migration preserves history; it does not invent claims.
      creates_claims: false,
      separate_from_live_intake: true,
    },
  });

  return { ok: true, batchId: data.id as string };
}

export type MigrationBatchRow = {
  id: string;
  label: string;
  sourceDescription: string;
  status: string;
  recordCount: number | null;
};

export async function listMigrationBatches(): Promise<MigrationBatchRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('migration_batches')
    .select('id, label, source_description, status, record_count')
    .order('imported_at', { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      label: r.label as string,
      sourceDescription: r.source_description as string,
      status: r.status as string,
      recordCount: (r.record_count as number | null) ?? null,
    };
  });
}
