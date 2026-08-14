import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Edit Items (Owner request 2026-08-09) — the SUPER ADMIN (owner) may change an
 * order's item composition after it exists. Two moves, both money-safe because the
 * order total is DERIVED from the order's `official_order_claims` (nothing stored to
 * mutate) and payments reference the ORDER, so they stay with the original:
 *
 *   - removeOrderItem: the piece returns to Active stock (via the sanctioned
 *     approved Returned-to-Stock review) and the order total drops by its price.
 *   - splitOrderItem: the piece moves to a brand-new For-Invoice order (same
 *     customer, unpaid) so it can be paid/delivered on its own.
 *
 * Every guard (owner, editable status, not the last item, claim belongs to order)
 * is re-checked in the SECURITY DEFINER function — the database is the real gate.
 */

export type EditItemResult = { ok: true } | { ok: false; error: string };
export type SplitItemResult =
  { ok: true; orderNumber: string } | { ok: false; error: string };

function cleanError(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}

export async function removeOrderItem(
  orderId: string,
  claimId: string,
): Promise<EditItemResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.remove_item',
        entityType: 'official_order',
        entityId: orderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_order_item', {
    p_order_id: orderId,
    p_claim_id: claimId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'order.remove_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: cleanError(error.message) };
  }

  await recordAuditEvent({
    action: 'order.remove_item',
    entityType: 'official_order',
    entityId: orderId,
    context: { claimId },
  });
  return { ok: true };
}

export async function splitOrderItem(
  orderId: string,
  claimId: string,
): Promise<SplitItemResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.split_item',
        entityType: 'official_order',
        entityId: orderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('split_order_item', {
    p_order_id: orderId,
    p_claim_id: claimId,
  });

  if (response.error) {
    await recordAuditEvent({
      action: 'order.split_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: cleanError(response.error.message) };
  }

  const payload = response.data as { order_number?: string } | null;
  const orderNumber = payload?.order_number ?? '—';
  await recordAuditEvent({
    action: 'order.split_item',
    entityType: 'official_order',
    entityId: orderId,
    context: { claimId, newOrderNumber: orderNumber },
  });
  return { ok: true, orderNumber };
}

export type AddOrderItemResult =
  | { ok: true; total: string }
  | { ok: false; error: string };

/**
 * Add an item to an existing order (Owner request 2026-08-13). Owner-gated; the DB
 * `add_order_item` re-checks the order is editable and the item is available, sets the
 * sold price, links a confirmed claim, and commits the piece. The order total is
 * DERIVED from its claims, so it rises by the added item's price with nothing stored to
 * mutate. Money crosses as a STRING.
 */
export async function addOrderItem(
  orderId: string,
  itemId: string,
  price: string,
  quantity = 1,
): Promise<AddOrderItemResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.add_item',
        entityType: 'official_order',
        entityId: orderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const response = (await supabase.rpc('add_order_item', {
    p_order_id: orderId,
    p_item_id: itemId,
    p_price: price,
    p_qty: Math.max(1, quantity),
  })) as { data: { total?: number | string } | null; error: { message: string } | null };

  if (response.error) {
    await recordAuditEvent({
      action: 'order.add_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: cleanError(response.error.message) };
  }

  await recordAuditEvent({
    action: 'order.add_item',
    entityType: 'official_order',
    entityId: orderId,
    context: { itemId },
  });
  const total = response.data?.total;
  return { ok: true, total: total != null ? String(total) : '0' };
}

export type OrderEditKind = 'order_add_item' | 'order_remove_item' | 'order_split_item';
export type RequestOrderEditResult = { ok: true } | { ok: false; error: string };

/**
 * A non-owner's "Request edit" (2026-08-13). Creates a pending owner-approval request that
 * carries the edit's params (which item / price / claim) — it changes NOTHING; the Owner
 * approves + executes it in /approvals, which replays add/remove/split_order_item. The DB
 * requires the `initiate_high_risk_action` permission and re-validates the edit up front.
 */
export async function requestOrderEdit(
  actionKind: OrderEditKind,
  orderId: string,
  payload: Record<string, unknown>,
  reason: string,
): Promise<RequestOrderEditResult> {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return { ok: false, error: 'Add a reason for the Owner.' };

  const supabase = await createClient();
  const response = (await supabase.rpc('request_order_edit', {
    p_action_kind: actionKind,
    p_order_id: orderId,
    p_payload: payload,
    p_reason: trimmed,
  })) as { data: unknown; error: { message: string } | null };

  if (response.error) {
    await recordAuditEvent({
      action: 'order.edit_request',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: cleanError(response.error.message) };
  }

  await recordAuditEvent({
    action: 'order.edit_request',
    entityType: 'official_order',
    entityId: orderId,
    context: { actionKind },
  });
  return { ok: true };
}
