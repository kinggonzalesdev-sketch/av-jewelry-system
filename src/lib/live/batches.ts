import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission, requireScope } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  LIVE_BATCH_ALLOWED_TRANSITIONS,
  LIVE_BATCH_TRANSITIONS,
  createLiveBatchSchema,
  liveBatchTransitionSchema,
} from '@/lib/validation/live';

/**
 * Live Batch lifecycle (Bible §12, §22.4).
 *
 * Standing rules enforced here:
 *   - Operation and Closure are DIFFERENT permissions. Being allowed to run a
 *     Live does not mean being allowed to close one (§5.13).
 *   - Reopen is NOT in this module. It is one of the non-delegable Owner
 *     approvals (§5.13, §22.4) — staff may only REQUEST it, and a request is
 *     not the action (§22.14).
 *   - Closing a batch never auto-confirms claims, invoices, creates orders, or
 *     touches inventory (§12.57). This module writes to live_batches only.
 *   - Every transition is revalidated against the CURRENT stored status, not
 *     against what the client believed the status was (§29.8).
 */

export type LiveResult<T = void> =
  ({ ok: true } & (T extends void ? object : { data: T })) | { ok: false; error: string };

function failure(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Creates a Live Batch in `draft`.
 *
 * Draft, never `active`: opening is a separate, audited transition. Creating a
 * batch is not running one.
 */
export async function createLiveBatch(
  input: unknown,
): Promise<LiveResult<{ id: string; batchReference: string }>> {
  const parsed = createLiveBatchSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      parsed.error.issues[0]?.message ?? 'The Live Batch details are invalid.',
    );
  }

  let staff;
  try {
    staff = await requirePermission('live_batch_operation');
    await requireScope(parsed.data.scopeId ?? null);
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'live_batch.create',
        entityType: 'live_batch',
        outcome: 'denied',
        reason: cause.message,
      });
      return failure(cause.message);
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('live_batches')
    .insert({
      title: parsed.data.title,
      scope_id: parsed.data.scopeId ?? null,
      status: 'draft',
      created_by: staff.staffProfileId,
    })
    .select('id, batch_reference')
    .single();

  if (error || !data) {
    await recordAuditEvent({
      action: 'live_batch.create',
      entityType: 'live_batch',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    return failure('The Live Batch could not be created.');
  }

  await recordAuditEvent({
    action: 'live_batch.create',
    entityType: 'live_batch',
    entityId: data.id as string,
    context: { batch_reference: data.batch_reference, status: 'draft' },
  });

  return {
    ok: true,
    data: { id: data.id as string, batchReference: data.batch_reference as string },
  };
}

/**
 * Moves a Live Batch through the approved lifecycle.
 *
 * `close` demands the Closure permission; everything else demands Operation.
 * The two are checked separately rather than as one "manage" permission,
 * because collapsing them would silently grant closure to every operator.
 */
export async function transitionLiveBatch(input: unknown): Promise<LiveResult> {
  const parsed = liveBatchTransitionSchema.safeParse(input);
  if (!parsed.success) {
    return failure(parsed.error.issues[0]?.message ?? 'The transition is invalid.');
  }

  const { liveBatchId, transition } = parsed.data;
  const permission =
    transition === 'close' ? 'live_batch_closure' : 'live_batch_operation';

  try {
    await requirePermission(permission);
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: `live_batch.${transition}`,
        entityType: 'live_batch',
        entityId: liveBatchId,
        outcome: 'denied',
        reason: cause.message,
      });
      return failure(cause.message);
    }
    throw cause;
  }

  const supabase = await createClient();

  // Re-read the CURRENT status. The client's idea of the status is not evidence
  // (§29.8) — two staff on one batch would otherwise race each other.
  const { data: batch, error: readError } = await supabase
    .from('live_batches')
    .select('id, status, scope_id')
    .eq('id', liveBatchId)
    .maybeSingle();

  if (readError || !batch) {
    return failure('That Live Batch could not be found.');
  }

  try {
    await requireScope((batch.scope_id as string | null) ?? null);
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: `live_batch.${transition}`,
        entityType: 'live_batch',
        entityId: liveBatchId,
        outcome: 'denied',
        reason: cause.message,
      });
      return failure(cause.message);
    }
    throw cause;
  }

  const current = batch.status as string;
  const allowed = LIVE_BATCH_ALLOWED_TRANSITIONS[current] ?? [];

  if (!allowed.includes(transition)) {
    const reason =
      current === 'closed'
        ? 'That Live Batch is closed. Reopening it requires Owner approval.'
        : `A ${current.replace('_', ' ')} Live Batch cannot be ${transition}ed.`;

    await recordAuditEvent({
      action: `live_batch.${transition}`,
      entityType: 'live_batch',
      entityId: liveBatchId,
      outcome: 'failed',
      reason,
      context: { from_status: current, attempted: transition },
    });
    return failure(reason);
  }

  const nextStatus = LIVE_BATCH_TRANSITIONS[transition];
  const patch: Record<string, unknown> = { status: nextStatus };

  if (transition === 'open') patch.opened_at = new Date().toISOString();
  if (transition === 'end') patch.ended_at = new Date().toISOString();
  if (transition === 'close') patch.closed_at = new Date().toISOString();

  // Guarded by the status we just read: if another staff member moved the batch
  // in between, this matches zero rows and we report the conflict rather than
  // clobbering their transition.
  const { data: updated, error } = await supabase
    .from('live_batches')
    .update(patch)
    .eq('id', liveBatchId)
    .eq('status', current)
    .select('id');

  if (error) {
    await recordAuditEvent({
      action: `live_batch.${transition}`,
      entityType: 'live_batch',
      entityId: liveBatchId,
      outcome: 'failed',
      reason: error.message,
    });
    return failure('The Live Batch could not be updated.');
  }

  if (!updated || updated.length === 0) {
    return failure('That Live Batch was changed by someone else. Reload and try again.');
  }

  await recordAuditEvent({
    action: `live_batch.${transition}`,
    entityType: 'live_batch',
    entityId: liveBatchId,
    context: { from_status: current, to_status: nextStatus },
  });

  return { ok: true };
}

/**
 * Lists Live Batches the caller may see. RLS narrows this to their scope; the
 * query does not re-implement that filter, it relies on it.
 */
export type LiveBatchItemRow = {
  liveBatchItemId: string;
  inventoryItemId: string;
  itemCode: string;
  itemName: string | null;
  isCurrentFlexItem: boolean;
  /** From the approved SQL. Advisory here: capture reserves nothing anyway. */
  availableQuantity: number | null;
};

/**
 * The items on one Live Batch, for Current Flex Item control and capture.
 *
 * Withdrawn items are excluded — a withdrawn item is not something to flex to.
 */
export async function listLiveBatchItems(
  liveBatchId: string,
): Promise<LiveBatchItemRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('live_batch_items')
    .select(
      'id, inventory_item_id, is_current_flex_item, inventory_items ( item_code, item_name )',
    )
    .eq('live_batch_id', liveBatchId)
    .is('withdrawn_at', null)
    .order('added_at', { ascending: true });

  if (error || !data) return [];

  const rows = data as unknown[];

  // Available stock for every item in ONE round-trip (available_quantities_for)
  // instead of one available_quantity_for() RPC per row — the batch may hold many
  // items, and per-row RPCs made this view slow. Same computation, same RLS; an
  // item whose quantity can't be read is absent from the map → rendered as null.
  const availResponse = await supabase.rpc('available_quantities_for', {
    p_item_ids: rows.map((row) => (row as Record<string, unknown>).inventory_item_id as string),
  });
  const qtyById = new Map<string, number>();
  if (Array.isArray(availResponse.data)) {
    for (const a of availResponse.data as Array<{
      item_id: string;
      available_quantity: number | null;
    }>) {
      if (typeof a?.item_id === 'string' && typeof a.available_quantity === 'number') {
        qtyById.set(a.item_id, a.available_quantity);
      }
    }
  }

  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    const item = Array.isArray(r.inventory_items)
      ? (r.inventory_items[0] as { item_code: string; item_name: string | null })
      : (r.inventory_items as { item_code: string; item_name: string | null } | null);

    return {
      liveBatchItemId: r.id as string,
      inventoryItemId: r.inventory_item_id as string,
      itemCode: item?.item_code ?? '—',
      itemName: item?.item_name ?? null,
      isCurrentFlexItem: r.is_current_flex_item === true,
      availableQuantity: qtyById.get(r.inventory_item_id as string) ?? null,
    };
  });
}

/** Customers a claim can be captured against. RLS scopes this. */
export async function listCaptureCustomers(
  limit = 200,
): Promise<Array<{ id: string; displayName: string }>> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('customers')
    .select('id, display_name')
    .eq('is_active', true)
    .order('display_name')
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    displayName: row.display_name as string,
  }));
}

export async function listLiveBatches(): Promise<
  Array<{ id: string; batchReference: string; title: string; status: string }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('live_batches')
    .select('id, batch_reference, title, status')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    batchReference: row.batch_reference as string,
    title: row.title as string,
    status: row.status as string,
  }));
}
