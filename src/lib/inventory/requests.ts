import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Inventory approval-request layer (Owner request 2026-08-17). An Admin (or the Owner)
 * INITIATES an Edit/Delete — it creates a Pending owner_approval_request and mutates NO
 * inventory. Only a Super Admin may then approve + execute it. Role-gated in BOTH this
 * layer and the SECURITY DEFINER `request_inventory_change` RPC (defense in depth), so an
 * Admin can submit without the old `inventory_monitoring` error and can never execute.
 */

export type InventoryEditProposal = {
  itemName: string | null;
  grams: string | null;
  size: string | null;
  supplierName: string | null;
  facebookName: string | null;
};

export type InventoryRequestResult = { ok: true } | { ok: false; error: string };

function gramsText(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return '';
}

/** Submit a DELETE request for Super-Admin approval. Nothing is deleted. */
export async function requestInventoryDelete(
  itemId: string,
  reason: string,
): Promise<InventoryRequestResult> {
  if (!itemId) return { ok: false, error: 'An item is required.' };
  const r = (reason ?? '').trim();
  if (!r) return { ok: false, error: 'Add a reason for the Super Admin.' };
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  // Not destructured: the PostgREST response is `any`, so read fields off it.
  const itemRes = await supabase
    .from('inventory_items')
    .select('item_code, item_name, grams_per_piece')
    .eq('id', itemId)
    .maybeSingle();
  const item = (itemRes.data ?? null) as Record<string, unknown> | null;
  const payload = {
    itemCode: (item?.item_code as string | null) ?? null,
    itemName: (item?.item_name as string | null) ?? null,
    grams: gramsText(item?.grams_per_piece) || null,
  };
  const res = (await supabase.rpc('request_inventory_change', {
    p_action_kind: 'inventory_item_delete',
    p_item_id: itemId,
    p_reason: r,
    p_payload: payload,
  })) as { data: unknown; error: { message: string } | null };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'inventory_item.request_delete',
    entityType: 'inventory_item',
    entityId: itemId,
    reason: r,
    context: {
      request_id: typeof res.data === 'string' ? res.data : null,
      executed: false,
      requires_super_admin_approval: true,
    },
  });
  return { ok: true };
}

/** Submit an EDIT request for Super-Admin approval. Captures ORIGINAL + PROPOSED values. */
export async function requestInventoryEdit(
  itemId: string,
  proposed: InventoryEditProposal,
  reason: string,
): Promise<InventoryRequestResult> {
  if (!itemId) return { ok: false, error: 'An item is required.' };
  const name = (proposed.itemName ?? '').trim();
  if (!name) return { ok: false, error: 'Enter an item name.' };
  const gramsRaw = (proposed.grams ?? '').trim();
  if (gramsRaw !== '' && (!/^\d+(\.\d{1,3})?$/.test(gramsRaw) || Number(gramsRaw) <= 0)) {
    return { ok: false, error: 'Enter grams like 12.2 (a positive number).' };
  }
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const itemRes = await supabase
    .from('inventory_items')
    .select('item_code, item_name, grams_per_piece, size, supplier_name, facebook_name')
    .eq('id', itemId)
    .eq('is_archived', false)
    .maybeSingle();
  const item = (itemRes.data ?? null) as Record<string, unknown> | null;
  if (!item) return { ok: false, error: 'Inventory item not found.' };

  const original: InventoryEditProposal = {
    itemName: (item.item_name as string | null) ?? '',
    grams: gramsText(item.grams_per_piece),
    size: (item.size as string | null) ?? '',
    supplierName: (item.supplier_name as string | null) ?? '',
    facebookName: (item.facebook_name as string | null) ?? '',
  };
  const proposedClean: InventoryEditProposal = {
    itemName: name,
    grams: gramsRaw,
    size: (proposed.size ?? '').trim(),
    supplierName: (proposed.supplierName ?? '').trim(),
    facebookName: (proposed.facebookName ?? '').trim(),
  };
  const payload = { itemCode: item.item_code as string, original, proposed: proposedClean };

  const res = (await supabase.rpc('request_inventory_change', {
    p_action_kind: 'inventory_item_edit',
    p_item_id: itemId,
    p_reason: (reason ?? '').trim() || null,
    p_payload: payload,
  })) as { data: unknown; error: { message: string } | null };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'inventory_item.request_edit',
    entityType: 'inventory_item',
    entityId: itemId,
    context: {
      request_id: typeof res.data === 'string' ? res.data : null,
      executed: false,
      requires_super_admin_approval: true,
    },
  });
  return { ok: true };
}
