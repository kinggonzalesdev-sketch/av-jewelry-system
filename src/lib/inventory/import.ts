import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
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
    staff = await requirePermission('post_live_item_entry');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.import',
        entityType: 'inventory_item',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
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
      grams_per_piece: i.grams?.trim() || null,
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

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.import',
      entityType: 'inventory_item',
      outcome: 'failed',
      reason: error.message,
      context: { attempted: toInsert.length },
    });
    return { ok: false, error: 'The import could not be saved.' };
  }

  const inserted = data?.length ?? 0;
  await recordAuditEvent({
    action: 'inventory_item.import',
    entityType: 'inventory_item',
    context: { inserted, skipped },
  });

  return { ok: true, inserted, skipped };
}
