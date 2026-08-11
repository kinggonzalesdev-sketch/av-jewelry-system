import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Create a simple, available inventory item from a typed name — with an optional
 * unit price ENTERED MANUALLY for a brand-new item (New Order pick-or-type).
 *
 * Setting the price of a NEW item is defining that item's catalogue price, not a
 * per-order override — so it needs no Owner approval. (Changing an EXISTING
 * item's price IS a price override and stays an Owner approval; that path never
 * comes through here.)
 *
 * Money discipline: the price is a `numeric` in SQL, kept a STRING end to end and
 * cast by Postgres — never parsed into a JS float. Gated by `post_live_item_entry`
 * (matching createPostLiveItem) and by the `inventory_items_insert` RLS policy.
 */
export type CreateManualItemResult =
  { ok: true; inventoryItemId: string } | { ok: false; error: string };

/** A valid non-negative money amount as a STRING, or null. Never a float. */
function normalizePrice(
  raw: string | null,
): { price: string | null } | { error: string } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { price: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { error: 'Enter a price like 8000 or 8000.50 (no negatives).' };
  }
  return { price: trimmed };
}

/** A positive weight in grams as a STRING (up to 3 decimals), or null. */
function normalizeGrams(
  raw: string | null,
): { grams: string | null } | { error: string } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { grams: null };
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed) || Number(trimmed) <= 0) {
    return { error: 'Enter grams like 12.2 (a positive number).' };
  }
  return { grams: trimmed };
}

export async function createManualItem(
  rawName: string,
  rawUnitPrice: string | null,
  rawGrams: string | null = null,
  rawSupplier: string | null = null,
  rawSize: string | null = null,
): Promise<CreateManualItemResult> {
  const itemName = (rawName ?? '').trim();
  if (itemName.length === 0) {
    return { ok: false, error: 'Enter an item name.' };
  }
  if (itemName.length > 160) {
    return { ok: false, error: 'Item name must be 160 characters or fewer.' };
  }

  const normalized = normalizePrice(rawUnitPrice);
  if ('error' in normalized) return { ok: false, error: normalized.error };

  const grams = normalizeGrams(rawGrams);
  if ('error' in grams) return { ok: false, error: grams.error };

  const supplierName = (rawSupplier ?? '').trim() || null;
  const size = (rawSize ?? '').trim() || null;
  if (supplierName && supplierName.length > 160) {
    return { ok: false, error: 'Supplier name must be 160 characters or fewer.' };
  }
  if (size && size.length > 80) {
    return { ok: false, error: 'Size must be 80 characters or fewer.' };
  }

  let staff;
  try {
    staff = await requirePermission('post_live_item_entry');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.manual_create',
        entityType: 'inventory_item',
        outcome: 'denied',
        reason: cause.message, // raw key logged internally, never shown to the user
      });
      return { ok: false, error: "You don't have permission to add inventory items." };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      item_code: `PL-${Date.now()}`,
      item_name: itemName,
      is_unique_item: true,
      quantity_total: 1,
      // String → numeric in SQL. Null when no price was entered.
      total_price_per_piece: normalized.price,
      grams_per_piece: grams.grams,
      supplier_name: supplierName,
      size,
      availability_status: 'available',
      source_kind: 'native',
      created_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !data) {
    await recordAuditEvent({
      action: 'inventory_item.manual_create',
      entityType: 'inventory_item',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    return { ok: false, error: 'The item could not be created.' };
  }

  await recordAuditEvent({
    action: 'inventory_item.manual_create',
    entityType: 'inventory_item',
    entityId: data.id as string,
    context: {
      item_name: itemName,
      unit_price: normalized.price,
      source: 'new_order_manual',
    },
  });

  return { ok: true, inventoryItemId: data.id as string };
}

/**
 * Inventory → New Entry (Owner request 2026-07-24): a simplified entry that takes
 * ONLY a required, unique item code, an optional price, and an editable "Date
 * Encoded". Distinct from createManualItem (which the New Order pick-or-type flow
 * still uses with a name + auto-generated code) so neither path disturbs the other.
 *
 * Money stays a STRING end to end. Uniqueness is enforced case-insensitively via
 * the existing lower(item_code) index — no schema change. Gated by
 * `post_live_item_entry` + the inventory_items insert RLS policy.
 */
export async function createInventoryEntry(
  rawItemCode: string,
  rawPrice: string | null,
  rawDateEncoded: string | null,
): Promise<CreateManualItemResult> {
  const itemCode = (rawItemCode ?? '').trim();
  if (itemCode.length === 0) return { ok: false, error: 'Enter an item code.' };
  if (itemCode.length > 80) {
    return { ok: false, error: 'Item code must be 80 characters or fewer.' };
  }

  const normalized = normalizePrice(rawPrice);
  if ('error' in normalized) return { ok: false, error: normalized.error };

  // Date Encoded — defaults to today (handled by the DB default when omitted) but
  // may be set to any valid date. Stored on created_at; no extra column needed.
  const dateRaw = (rawDateEncoded ?? '').trim();
  let createdAt: string | null = null;
  if (dateRaw !== '') {
    const d = new Date(`${dateRaw}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(d.getTime())) {
      return { ok: false, error: 'Enter a valid date encoded (YYYY-MM-DD).' };
    }
    createdAt = d.toISOString();
  }

  let staff;
  try {
    staff = await requirePermission('post_live_item_entry');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.manual_create',
        entityType: 'inventory_item',
        outcome: 'denied',
        reason: cause.message, // raw key logged internally, never shown to the user
      });
      return { ok: false, error: "You don't have permission to add inventory items." };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Item code must be UNIQUE (case-insensitive). Escape LIKE wildcards so a code
  // containing % or _ is matched literally.
  const pattern = itemCode.replace(/[%_\\]/g, (c) => `\\${c}`);
  const { data: existing } = await supabase
    .from('inventory_items')
    .select('id')
    .ilike('item_code', pattern)
    .limit(1);
  if (existing && existing.length > 0) {
    return {
      ok: false,
      error: `The code “${itemCode}” is already used. Enter a unique code.`,
    };
  }

  const insert: Record<string, unknown> = {
    item_code: itemCode,
    item_name: null,
    is_unique_item: true,
    quantity_total: 1,
    total_price_per_piece: normalized.price,
    availability_status: 'available',
    source_kind: 'native',
    created_by: staff.staffProfileId,
  };
  if (createdAt) insert.created_at = createdAt;

  const { data, error } = await supabase
    .from('inventory_items')
    .insert(insert)
    .select('id')
    .single();

  if (error || !data) {
    await recordAuditEvent({
      action: 'inventory_item.manual_create',
      entityType: 'inventory_item',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    // The DB's unique lower(item_code) index is the final backstop — even a code
    // the visible check missed (e.g. an archived item) is refused here, never saved.
    if (error?.code === '23505' || /duplicate key|unique/i.test(error?.message ?? '')) {
      return {
        ok: false,
        error: `The code “${itemCode}” is already used. Enter a unique code.`,
      };
    }
    return { ok: false, error: 'The item could not be created.' };
  }

  await recordAuditEvent({
    action: 'inventory_item.manual_create',
    entityType: 'inventory_item',
    entityId: data.id as string,
    context: {
      item_code: itemCode,
      unit_price: normalized.price,
      source: 'inventory_new_entry',
    },
  });

  return { ok: true, inventoryItemId: data.id as string };
}
