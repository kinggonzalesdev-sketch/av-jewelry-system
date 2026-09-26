import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner, requirePermission } from '@/lib/authz/guard';
import {
  duplicateCodeNumberMessage,
  inventoryCodeNumber,
} from '@/lib/inventory/code-number';
import { detectInventoryCodeIssues } from '@/lib/inventory/code-parser';
import type { ItemDeleteLink, ItemDeleteLinksResult } from '@/lib/inventory/delete-links';
import { createClient } from '@/lib/supabase/server';

/**
 * Inventory safe delete & archive (Inventory Safe-Delete spec §1–§9).
 *
 * The domain layer over the guarded SQL functions. Every mutation:
 *   - re-checks permission here (defence in depth + a denied-audit event) AND in
 *     the SECURITY DEFINER function it calls — the database is the real gate;
 *   - is soft/reversible by default (archive), or hard only under the strict
 *     Owner + already-archived + dependency-free rule (permanent delete);
 *   - writes an audit_events row (spec §9). The audit has no FK to the item, so
 *     it survives even a permanent delete — history is preserved.
 */

export const ARCHIVE_REASON_CODES = [
  'incorrectly_encoded',
  'duplicate_entry',
  'test_record',
  'wrong_excel_import',
  'other',
] as const;

export type ArchiveReasonCode = (typeof ARCHIVE_REASON_CODES)[number];

export type InventoryMutationResult = { ok: true } | { ok: false; error: string };

/** A business record connected to an item (spec §3). Any dependency blocks a
 *  permanent delete; an `isActive` one also blocks archive. */
export type ItemDependency = {
  kind: string;
  label: string;
  isActive: boolean;
};

export type ArchivedInventoryRow = {
  inventoryItemId: string;
  itemCode: string;
  itemName: string | null;
  archivedFromStatus: string;
  archiveReasonCode: string;
  archiveReasonDetail: string | null;
  archivedByName: string | null;
  archivedAt: string;
};

export type ArchivedInventoryResult =
  { ok: true; rows: ArchivedInventoryRow[] } | { ok: false; reason: string };

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

/**
 * The Archived / Deleted Items view (spec §5). Distinct from Completed Items:
 * these are incorrect / duplicate / test records, not legitimate sales.
 *
 * Returns an explicit failure rather than an empty array on a read error — an
 * unreadable list must never look like "nothing archived" (the session's rule).
 */
export async function listArchivedInventory(): Promise<ArchivedInventoryResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inventory_items')
    .select(
      `id, item_code, item_name, archived_from_status, archive_reason_code,
       archive_reason_detail, archived_at,
       archived_by_staff:staff_profiles!archived_by ( full_name )`,
    )
    .eq('is_archived', true)
    .order('archived_at', { ascending: false })
    .limit(200);

  if (error) {
    return { ok: false, reason: error.message };
  }

  const rows: ArchivedInventoryRow[] = (
    (data ?? []) as Array<Record<string, unknown>>
  ).map((r) => {
    const staff = one<{ full_name: string }>(r.archived_by_staff);
    return {
      inventoryItemId: r.id as string,
      itemCode: r.item_code as string,
      itemName: (r.item_name as string | null) ?? null,
      archivedFromStatus: (r.archived_from_status as string | null) ?? 'unknown',
      archiveReasonCode: (r.archive_reason_code as string | null) ?? 'unknown',
      archiveReasonDetail: (r.archive_reason_detail as string | null) ?? null,
      archivedByName: staff?.full_name ?? null,
      archivedAt: r.archived_at as string,
    };
  });

  return { ok: true, rows };
}

/**
 * The business records connected to an item (spec §3), so the delete modal can
 * name exactly why a permanent delete is blocked and offer the safer action.
 * Read-only; requires inventory_monitoring (the RPC re-checks).
 */
export async function getItemDependencies(
  inventoryItemId: string,
): Promise<{ ok: true; dependencies: ItemDependency[] } | { ok: false; error: string }> {
  const supabase = await createClient();
  // Not destructured: the RPC is untyped (`any`), and destructuring `data` here
  // trips no-unsafe-assignment. Read the fields off the response instead.
  const response = await supabase.rpc('inventory_item_dependencies', {
    p_item_id: inventoryItemId,
  });

  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const dependencies: ItemDependency[] = (
    (response.data ?? []) as Array<Record<string, unknown>>
  ).map((r) => ({
    kind: r.dependency_kind as string,
    label: (r.reference_label as string | null) ?? '—',
    isActive: r.is_active === true,
  }));

  return { ok: true, dependencies };
}

function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * Every record linked to an item, for the delete popup (Owner 2026-09-26): what it is, its status,
 * the order or layaway account to open, and whether it PROTECTS the item from a force delete. The
 * database decides all of it (inventory_item_delete_links, migration 20260926120000) and the force
 * delete reads the same list. Before that migration is applied the function does not exist, so
 * the older dependency list is shown instead — without links or reasons.
 */
export async function getItemDeleteLinks(
  inventoryItemId: string,
): Promise<ItemDeleteLinksResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('inventory_item_delete_links', {
    p_item_id: inventoryItemId,
  });

  if (!response.error) {
    const links: ItemDeleteLink[] = (
      (response.data ?? []) as Array<Record<string, unknown>>
    ).map((r) => ({
      kind: textOrNull(r.kind) ?? 'record',
      recordId: textOrNull(r.record_id),
      orderId: textOrNull(r.order_id),
      ledgerId: textOrNull(r.ledger_id),
      label: textOrNull(r.label) ?? '—',
      state: textOrNull(r.state) ?? '',
      blocks: r.blocks === true,
      reason: textOrNull(r.reason),
    }));
    return { ok: true, links, exact: true };
  }

  // PGRST202 = the function is not in the schema yet (migration not applied). Any other error is
  // reported as it is — never silently replaced by the older list.
  if (response.error.code === 'PGRST202') {
    const legacy = await getItemDependencies(inventoryItemId);
    if (!legacy.ok) return legacy;
    return {
      ok: true,
      exact: false,
      links: legacy.dependencies.map((d) => ({
        kind: d.kind,
        recordId: null,
        orderId: null,
        ledgerId: null,
        label: d.label,
        state: '',
        // The older list cannot tell a completed sale from closed history, so nothing it shows is
        // ever presented as closed: the popup offers no force delete until the migration is in.
        blocks: true,
        reason: null,
      })),
    };
  }

  return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
}

/**
 * Archive (soft delete) an incorrect / duplicate / test item (spec §2/§4).
 * Reversible; leaves availability_status and every link untouched. The SQL
 * function refuses completed/released items and in-flight links.
 */
export async function archiveInventoryItem(
  inventoryItemId: string,
  reasonCode: string,
  reasonDetail: string | null,
): Promise<InventoryMutationResult> {
  if (!ARCHIVE_REASON_CODES.includes(reasonCode as ArchiveReasonCode)) {
    return { ok: false, error: 'Select a deletion reason.' };
  }
  const detail = (reasonDetail ?? '').trim() || null;
  if (reasonCode === 'other' && !detail) {
    return { ok: false, error: 'Selecting "Other" requires a written explanation.' };
  }

  try {
    await requirePermission('inventory_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.archive',
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
  const { error } = await supabase.rpc('archive_inventory_item', {
    p_item_id: inventoryItemId,
    p_reason_code: reasonCode,
    p_reason_detail: detail,
  });

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.archive',
      entityType: 'inventory_item',
      entityId: inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'inventory_item.archive',
    entityType: 'inventory_item',
    entityId: inventoryItemId,
    reason: detail,
    context: { archive_reason_code: reasonCode, soft_delete: true, reversible: true },
  });

  return { ok: true };
}

/**
 * Restore an archived item to its exact prior status (spec §6). The SQL function
 * refuses if another active item now uses the same code.
 */
export async function restoreInventoryItem(
  inventoryItemId: string,
  reason: string | null = null,
): Promise<InventoryMutationResult> {
  const restoreReason = (reason ?? '').trim() || null;
  try {
    await requirePermission('inventory_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.restore',
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
  const { error } = await supabase.rpc('restore_inventory_item', {
    p_item_id: inventoryItemId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.restore',
      entityType: 'inventory_item',
      entityId: inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'inventory_item.restore',
    entityType: 'inventory_item',
    entityId: inventoryItemId,
    reason: restoreReason,
    context: { restored: true },
  });

  return { ok: true };
}

/**
 * Permanently delete an ALREADY-ARCHIVED, dependency-free isolated record
 * (spec §4/§8). Owner-only. The SQL function is the real gate; this adds the
 * denied-audit event and the surviving success/failure trail.
 */
export async function permanentlyDeleteInventoryItem(
  inventoryItemId: string,
): Promise<InventoryMutationResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.permanent_delete',
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
  const { error } = await supabase.rpc('permanently_delete_inventory_item', {
    p_item_id: inventoryItemId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.permanent_delete',
      entityType: 'inventory_item',
      entityId: inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  // The item row is gone; the audit row (no FK to it) preserves the history.
  await recordAuditEvent({
    action: 'inventory_item.permanent_delete',
    entityType: 'inventory_item',
    entityId: inventoryItemId,
    context: { permanent: true, owner_approved: true },
  });

  return { ok: true };
}

/**
 * One-step permanent delete of an inventory item — **Super Admin (owner) ONLY**
 * (Owner request 2026-08-17, supersedes the inventory_delete-grant model incl. Cynthia).
 * An Admin never deletes directly; they submit an approval REQUEST, and this same path
 * runs at approval time in the Owner's session. The SECURITY DEFINER function is the real
 * gate — it re-checks `is_owner()` and BLOCKS the delete when the item is linked to any
 * business record (dependencies are re-counted at EXECUTION time), so an in-use item can
 * never be removed. Irreversible; the audit row survives it.
 */
export async function deleteInventoryItemDirect(
  inventoryItemId: string,
): Promise<InventoryMutationResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.delete',
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
  const { error } = await supabase.rpc('delete_inventory_item_direct', {
    p_item_id: inventoryItemId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.delete',
      entityType: 'inventory_item',
      entityId: inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'inventory_item.delete',
    entityType: 'inventory_item',
    entityId: inventoryItemId,
    context: { permanent: true },
  });
  return { ok: true };
}

/**
 * SUPER ADMIN (owner) force-delete (Owner request 2026-08-09).
 *
 * The normal delete refuses an item linked to ANY business record, including closed history (a
 * cancelled order with no payment, a withdrawn claim, a finished return review, a released hold).
 * This path removes that closed history and the item — and the database function REFUSES while any
 * link still protects the item: the item is not in stock, any order that is not cancelled (live or
 * completed), a cancelled order with a payment, an open claim, an active hold, an open return
 * review, any layaway account, a miner position, an open live batch, a capture that is not on a
 * cancelled order, a pending capture review, or an active waitlist entry (Owner 2026-09-26,
 * migration 20260926120000 — the popup lists the same records). Owner only, and the SECURITY
 * DEFINER function re-checks the role — the database is the real gate.
 * Irreversible; the audit row survives the delete (no FK to the item).
 */
export async function forceDeleteInventoryItem(
  inventoryItemId: string,
): Promise<InventoryMutationResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.force_delete',
        entityType: 'inventory_item',
        entityId: inventoryItemId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  // Read the linked records first so the audit trail says exactly which closed history the delete
  // removed (e.g. the item's line on a cancelled order). Best-effort: the database function below
  // re-checks the same list and refuses on its own while anything protects the item.
  const before = await getItemDeleteLinks(inventoryItemId);
  const removedHistory =
    before.ok && before.exact
      ? before.links.map((l) => ({
          kind: l.kind,
          state: l.state,
          record_id: l.recordId,
          order_id: l.orderId,
        }))
      : undefined;

  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_inventory_item_force', {
    p_item_id: inventoryItemId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.force_delete',
      entityType: 'inventory_item',
      entityId: inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'inventory_item.force_delete',
    entityType: 'inventory_item',
    entityId: inventoryItemId,
    context: { permanent: true, forced: true, removed_history: removedHistory },
  });
  return { ok: true };
}

export type DeleteAllInventoryResult =
  { ok: true; deleted: number; skipped: number } | { ok: false; error: string };

/**
 * Bulk permanent delete of Active Inventory — SUPER ADMIN (owner) only (Owner
 * request: the everything-at-once action is never offered to an Admin or Staff).
 * The database function is the real gate: it re-checks owner AND skips every item
 * linked to a business record (same dependency rule as the single delete), so
 * in-use inventory is never removed; it returns how many were deleted vs skipped.
 * Irreversible.
 */
export async function deleteAllInventoryItems(): Promise<DeleteAllInventoryResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.delete_all',
        entityType: 'inventory_item',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('delete_all_inventory_items')) as {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  const deleted = Number(d.deleted ?? 0);
  const skipped = Number(d.skipped ?? 0);
  await recordAuditEvent({
    action: 'inventory_item.delete_all',
    entityType: 'inventory_item',
    context: { deleted, skipped },
  });
  return { ok: true, deleted, skipped };
}

/**
 * Correct an item's DESCRIPTIVE details (spec §1/§3 "Correct Item Details").
 * Deliberately excludes the price — changing an existing item's price is an
 * Owner price-override, not a free-text correction (see createManualItem).
 */
export async function editInventoryItemDetails(input: {
  inventoryItemId: string;
  itemName: string | null;
  grams: string | null;
  size: string | null;
  supplierName: string | null;
  facebookName: string | null;
  /** Super-Admin item_code CORRECTION (optional). item_code has no other update path, so a mistyped
   *  code was previously unfixable in the app. Only applied when it actually changes. */
  itemCode?: string | null;
  /** Acknowledge the save-time corruption warnings (the "Save anyway" override). */
  acknowledgeWarnings?: boolean;
}): Promise<InventoryMutationResult> {
  const itemName = (input.itemName ?? '').trim();
  if (itemName.length === 0) return { ok: false, error: 'Enter an item name.' };
  if (itemName.length > 160) {
    return { ok: false, error: 'Item name must be 160 characters or fewer.' };
  }

  const gramsRaw = (input.grams ?? '').trim();
  let grams: string | null = null;
  if (gramsRaw !== '') {
    if (!/^\d+(\.\d{1,3})?$/.test(gramsRaw) || Number(gramsRaw) <= 0) {
      return { ok: false, error: 'Enter grams like 12.2 (a positive number).' };
    }
    grams = gramsRaw;
  }

  const size = (input.size ?? '').trim() || null;
  if (size && size.length > 80) {
    return { ok: false, error: 'Size must be 80 characters or fewer.' };
  }
  const supplierName = (input.supplierName ?? '').trim() || null;
  if (supplierName && supplierName.length > 160) {
    return { ok: false, error: 'Supplier name must be 160 characters or fewer.' };
  }
  const facebookName = (input.facebookName ?? '').trim() || null;
  if (facebookName && facebookName.length > 160) {
    return { ok: false, error: 'Facebook name must be 160 characters or fewer.' };
  }

  // DIRECT edit is Super-Admin only (Owner request 2026-08-17). An Admin edits via an
  // approval REQUEST (see requestInventoryEdit); the owner-gated apply_inventory_item_edit
  // RPC then applies it after approval. This closes the direct-mutation path for Admins.
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.correct_details',
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

  const updates: Record<string, unknown> = {
    item_name: itemName,
    grams_per_piece: grams,
    size,
    supplier_name: supplierName,
    facebook_name: facebookName,
  };

  // Super-Admin item_code CORRECTION (this function is owner-gated). item_code has no other update
  // path, so a mistyped code was previously unfixable in the app. Applies the SAME save-time
  // corruption guard as New Entry + a case-insensitive uniqueness check — and ONLY when the code
  // actually changes (so editing other fields never disturbs a code the operator left alone).
  const newCode = (input.itemCode ?? '').trim();
  let codeChange: { from: string; to: string } | null = null;
  if (newCode !== '') {
    if (newCode.length > 80) {
      return { ok: false, error: 'Item code must be 80 characters or fewer.' };
    }
    const { data: cur } = await supabase
      .from('inventory_items')
      .select('item_code')
      .eq('id', input.inventoryItemId)
      .single();
    const currentCode = ((cur?.item_code as string | null) ?? '').trim();
    if (newCode !== currentCode) {
      if (!input.acknowledgeWarnings) {
        const issues = detectInventoryCodeIssues(newCode);
        if (issues.length > 0) {
          return { ok: false, error: `Please check the code — ${issues.join(' ')}` };
        }
      }
      // NUMERIC identity check (Owner 2026-09-15) — a corrected code must not TAKE another
      // live item's sequence number. Mirrors the DB trigger exactly: a correction that keeps
      // the item's own number (fixing a typo around it, or retagging a grandfathered
      // duplicate's prefix) stays allowed — only a CHANGED number is checked for a clash.
      const newNumber = inventoryCodeNumber(newCode);
      if (newNumber && inventoryCodeNumber(currentCode) !== newNumber) {
        const { data: numHits } = await supabase
          .from('inventory_items')
          .select('id, item_code')
          .eq('is_archived', false)
          .neq('id', input.inventoryItemId)
          .like('item_code', `%${newNumber}%`)
          .limit(25);
        const clash = ((numHits ?? []) as Array<{ item_code: string }>).find(
          (r) => inventoryCodeNumber(r.item_code) === newNumber,
        );
        if (clash) {
          return {
            ok: false,
            error: duplicateCodeNumberMessage(newNumber, clash.item_code),
          };
        }
      }
      const pattern = newCode.replace(/[%_\\]/g, (c) => `\\${c}`);
      const { data: dup } = await supabase
        .from('inventory_items')
        .select('id')
        .ilike('item_code', pattern)
        .neq('id', input.inventoryItemId)
        .limit(1);
      if (dup && dup.length > 0) {
        return {
          ok: false,
          error: `The code “${newCode}” is already used by another item.`,
        };
      }
      updates.item_code = newCode;
      codeChange = { from: currentCode, to: newCode };
    }
  }

  const { error } = await supabase
    .from('inventory_items')
    .update(updates)
    .eq('id', input.inventoryItemId)
    .eq('is_archived', false);

  if (error) {
    await recordAuditEvent({
      action: 'inventory_item.correct_details',
      entityType: 'inventory_item',
      entityId: input.inventoryItemId,
      outcome: 'failed',
      reason: error.message,
    });
    // Uniqueness backstop even if the visible check missed a race.
    if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) {
      if (/already assigned to/.test(error.message)) {
        return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
      }
      return { ok: false, error: 'That item code is already used by another item.' };
    }
    return { ok: false, error: 'The correction could not be saved.' };
  }

  await recordAuditEvent({
    action: 'inventory_item.correct_details',
    entityType: 'inventory_item',
    entityId: input.inventoryItemId,
    context: {
      item_name: itemName,
      price_unchanged: true,
      // Traceable when the unique code itself was corrected.
      code_corrected: codeChange ?? undefined,
    },
  });

  return { ok: true };
}
