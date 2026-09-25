import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import type { LinePricing } from '@/lib/orders/item-pricing';
import { validLinePricing } from '@/lib/orders/line-pricing';
import { createClient } from '@/lib/supabase/server';
import { isMissingFunction } from '@/lib/supabase/missing-schema';

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

export type PaidRemovalSnapshot = {
  inventoryCode: string | null;
  previousTotal: string;
  newTotal: string;
  paid: string;
  overpaymentCredit: string;
  outstandingBalance: string;
};
export type RemovePaidItemResult =
  { ok: true; snapshot: PaidRemovalSnapshot } | { ok: false; error: string };

/** The jsonb `remove_paid_order_item` returns — money arrives as numeric or text, never an object. */
type RemovePaidOrderItemRow = {
  inventory_item_id?: string | null;
  inventory_code?: string | null;
  previous_total?: number | string | null;
  new_total?: number | string | null;
  verified_net_payments?: number | string | null;
  overpayment_credit?: number | string | null;
  outstanding_balance?: number | string | null;
  order_status?: string | null;
};

/**
 * PAID-ORDER item removal (Owner 2026-09-03). The SUPER ADMIN may remove an item from a Fully-Paid /
 * settled (LOCKED) order. The DB `remove_paid_order_item` (SECURITY DEFINER, owner-re-checked, reason
 * mandatory) restocks the EXACT piece to Active inventory, recalculates the DERIVED order total, and
 * PRESERVES every payment record (payments reference the order, never a claim) — any resulting
 * overpayment surfaces as a CREDIT via order_balance, never an auto-refund. The financial snapshot it
 * returns is written to a PAID_ORDER_ITEM_REMOVED_AND_RESTOCKED audit with the reason.
 */
export async function removePaidOrderItem(
  orderId: string,
  claimId: string,
  reason: string,
): Promise<RemovePaidItemResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.remove_paid_item',
        entityType: 'official_order',
        entityId: orderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: 'A reason is required to remove an item from a paid order.',
    };
  }

  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('remove_paid_order_item', {
    p_order_id: orderId,
    p_claim_id: claimId,
    p_reason: trimmed,
  })) as { data: RemovePaidOrderItemRow | null; error: { message: string } | null };

  if (error) {
    await recordAuditEvent({
      action: 'order.remove_paid_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: cleanError(error.message) };
  }

  const d: RemovePaidOrderItemRow = data ?? {};
  const snapshot: PaidRemovalSnapshot = {
    inventoryCode: d.inventory_code ?? null,
    previousTotal: String(d.previous_total ?? '0'),
    newTotal: String(d.new_total ?? '0'),
    paid: String(d.verified_net_payments ?? '0'),
    overpaymentCredit: String(d.overpayment_credit ?? '0'),
    outstandingBalance: String(d.outstanding_balance ?? '0'),
  };

  // Financial audit — the spec's PAID_ORDER_ITEM_REMOVED_AND_RESTOCKED, with the full money snapshot.
  await recordAuditEvent({
    action: 'order.paid_item_removed_and_restocked',
    entityType: 'official_order',
    entityId: orderId,
    context: {
      auditAction: 'PAID_ORDER_ITEM_REMOVED_AND_RESTOCKED',
      claimId,
      inventoryItemId: d.inventory_item_id ?? null,
      inventoryCode: snapshot.inventoryCode,
      previousTotal: snapshot.previousTotal,
      newTotal: snapshot.newTotal,
      paid: snapshot.paid,
      overpaymentCredit: snapshot.overpaymentCredit,
      outstandingBalance: snapshot.outstandingBalance,
      orderStatus: d.order_status ?? null,
      reason: trimmed,
    },
  });
  return { ok: true, snapshot };
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
  /** `addedCount` > 0 only on a database without migration 20260926090000, where items are added
   *  one by one: that many WERE added before the failure. */
  | { ok: false; error: string; addedCount?: number };

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

export type AddOrderItemInput = {
  itemId: string;
  /** The line price (grams × rate, or the fixed price) as a string. */
  price: string;
  quantity?: number;
  /** How the price was entered — saved on the line as its transaction-time snapshot. */
  pricing?: LinePricing;
};

const PRICE_TEXT_RE = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Edit → Add Item (Owner 2026-09-26): add one or more Active Inventory items to an existing
 * order — For Invoice included — ALL OR NOTHING. The DB `add_order_items_priced` locks the order,
 * adds each item through the unchanged `add_order_item` (which locks the inventory row, so the
 * same piece can never land on two orders) and saves each line's pricing snapshot, in one
 * transaction: a refused row adds nothing. Owner-gated here and in the database. Never prints.
 *
 * Before migration 20260926090000 is applied that function does not exist: the items are added
 * one by one through `add_order_item` exactly as before (no snapshot).
 */
export async function addOrderItems(
  orderId: string,
  items: ReadonlyArray<AddOrderItemInput>,
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

  if (items.length === 0) return { ok: false, error: 'Pick at least one item.' };
  const seen = new Set<string>();
  for (const it of items) {
    if (!it.itemId) return { ok: false, error: 'Pick an item from Active Inventory.' };
    if (seen.has(it.itemId)) {
      return {
        ok: false,
        error: 'The same item was added more than once. Remove the duplicate.',
      };
    }
    seen.add(it.itemId);
    if (!PRICE_TEXT_RE.test(it.price) || Number(it.price) <= 0) {
      return { ok: false, error: 'Enter a price greater than zero for every item.' };
    }
    if (it.pricing && !validLinePricing(it.pricing, it.price)) {
      return {
        ok: false,
        error:
          'An item’s price does not match its grams × Price Per Gram. Check the row.',
      };
    }
  }

  const supabase = await createClient();
  const payload = items.map((it) => ({
    id: it.itemId,
    price: it.price,
    qty: Math.max(1, it.quantity ?? 1),
    ...(it.pricing ? { pricing: it.pricing } : {}),
  }));
  type Rpc = {
    data: { total?: number | string } | null;
    error: { code?: string; message: string } | null;
  };
  let response = (await supabase.rpc('add_order_items_priced', {
    p_order_id: orderId,
    p_items: payload,
  })) as Rpc;

  let addedBeforeFailure = 0;
  if (isMissingFunction(response.error)) {
    // Legacy database: one add per item, as before this change — NOT all-or-nothing, so a
    // failure part-way is reported with how many were already added.
    for (const p of payload) {
      response = (await supabase.rpc('add_order_item', {
        p_order_id: orderId,
        p_item_id: p.id,
        p_price: p.price,
        p_qty: p.qty,
      })) as Rpc;
      if (response.error) break;
      addedBeforeFailure += 1;
    }
  }

  if (response.error) {
    await recordAuditEvent({
      action: 'order.add_item',
      entityType: 'official_order',
      entityId: orderId,
      outcome: 'failed',
      reason: response.error.message,
      context: { addedBeforeFailure },
    });
    return addedBeforeFailure > 0
      ? {
          ok: false,
          addedCount: addedBeforeFailure,
          error: `Added ${addedBeforeFailure} of ${payload.length} items, then one failed: ${cleanError(response.error.message)}`,
        }
      : { ok: false, error: cleanError(response.error.message) };
  }

  await recordAuditEvent({
    action: 'order.add_item',
    entityType: 'official_order',
    entityId: orderId,
    context: {
      itemIds: items.map((i) => i.itemId),
      pricing: items.map((i) => i.pricing ?? null),
    },
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
