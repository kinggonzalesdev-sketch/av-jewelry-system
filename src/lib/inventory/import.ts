import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { createClient } from '@/lib/supabase/server';

/**
 * Bulk inventory import (spec §B/§E). Inserts legacy items PRESERVING the original
 * inventory code exactly (never a new simplified code, §C). Gated by
 * `post_live_item_entry` + RLS. Existing codes are SKIPPED, never overwritten
 * (§9 duplicate rule) — nothing is destroyed. Every import is audited.
 *
 * Money (price) and grams stay STRINGS end to end; Postgres casts them.
 */

export type ImportItemInput = {
  /** The original, complete inventory code (e.g. "SBA-N-2683"). Preserved as-is. */
  itemCode: string;
  itemName: string | null;
  price: string | null;
  grams: string | null;
  size: string | null;
  supplier: string | null;
};

export type ImportResult =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string };

export async function importInventoryItems(
  items: ImportItemInput[],
): Promise<ImportResult> {
  const clean = items.filter((i) => i.itemCode && i.itemCode.trim().length > 0);
  if (clean.length === 0) return { ok: false, error: 'No valid rows to import.' };

  let staff;
  try {
    // Bulk import is SUPER ADMIN only (Owner request): an Admin or Staff member
    // cannot bulk-load inventory even by calling this action directly.
    staff = await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.import',
        entityType: 'inventory_item',
        outcome: 'denied',
        reason: cause.message, // logged internally; never shown to the user
      });
      return { ok: false, error: "You don't have permission to import inventory items." };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Skip codes that already exist — never overwrite (§9). The DB unique index on
  // item_code is the real guard; this pre-filter makes "skipped" honest.
  const codes = [...new Set(clean.map((i) => i.itemCode.trim()))];
  const { data: existing } = await supabase
    .from('inventory_items')
    .select('item_code')
    .in('item_code', codes);
  const existingCodes = new Set(
    ((existing ?? []) as Array<{ item_code: string }>).map((r) => r.item_code),
  );

  const seen = new Set<string>();
  const toInsert = clean
    .filter((i) => {
      const code = i.itemCode.trim();
      if (existingCodes.has(code) || seen.has(code)) return false;
      seen.add(code);
      return true;
    })
    .map((i) => ({
      item_code: i.itemCode.trim(),
      item_name: i.itemName?.trim() || null,
      is_unique_item: true,
      quantity_total: 1,
      total_price_per_piece: i.price?.trim() || null,
      // Auto-detect grams: use the supplied value, otherwise parse the grams encoded
      // in the item code (e.g. "SBA-N-2683 1.80g" → 1.80) so every upload lands with
      // its weight already populated.
      grams_per_piece: i.grams?.trim() || parseInventoryCode(i.itemCode).grams || null,
      size: i.size?.trim() || null,
      supplier_name: i.supplier?.trim() || null,
      availability_status: 'available',
      // Ad-hoc CSV upload — a native item, NOT part of a formal migration batch.
      // 'migrated' requires a migration_batch_id (provenance CHECK), which this
      // flow never sets, so 'migrated' would fail every insert.
      source_kind: 'native',
      created_by: staff.staffProfileId,
    }));

  const skipped = clean.length - toInsert.length;

  if (toInsert.length === 0) {
    return { ok: true, inserted: 0, skipped };
  }

  const { data, error } = await supabase
    .from('inventory_items')
    .insert(toInsert)
    .select('id');

  let inserted: number;
  let conflictSkipped = 0;

  if (error) {
    // A UNIQUE lower(item_code) violation means a code collided with a row the
    // visible pre-filter missed (e.g. an archived item). Rather than fail the whole
    // batch, insert row-by-row and SKIP the conflicting ones — a duplicate is never
    // saved, and the rest still import.
    const isConflict = error.code === '23505' || /duplicate key|unique/i.test(error.message);
    if (!isConflict) {
      await recordAuditEvent({
        action: 'inventory_item.import',
        entityType: 'inventory_item',
        outcome: 'failed',
        reason: error.message,
        context: { attempted: toInsert.length },
      });
      return { ok: false, error: 'The import could not be saved.' };
    }
    let ok = 0;
    for (const row of toInsert) {
      const r = await supabase.from('inventory_items').insert(row).select('id').single();
      if (r.error) conflictSkipped += 1;
      else ok += 1;
    }
    inserted = ok;
  } else {
    inserted = data?.length ?? 0;
  }

  const totalSkipped = skipped + conflictSkipped;
  await recordAuditEvent({
    action: 'inventory_item.import',
    entityType: 'inventory_item',
    context: { inserted, skipped: totalSkipped },
  });

  return { ok: true, inserted, skipped: totalSkipped };
}
