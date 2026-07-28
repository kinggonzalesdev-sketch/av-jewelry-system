import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Completed Items reader (spec §5). The SAME inventory records that left Active
 * Inventory the moment a transaction consumed them — a Walk-In sale, a New Order, a
 * layaway, or a manual entry — read here with their order / customer / fulfillment
 * context. One source of truth; nothing is copied or deleted, and an item appears
 * exactly once. The final sale amount + payment status come from the tested balance
 * functions via one guarded batch call (`completed_items_money`) — never a
 * fabricated zero. `currentStage` tracks where the item is in the live workflow and
 * follows the linked order automatically, because it is DERIVED from that order's
 * status on every read rather than stored and left to go stale.
 */

/**
 * Inventory statuses that still count as ACTIVE, sellable stock. Everything else has
 * been consumed by a transaction and belongs to Completed Items. Kept as an
 * allowlist so a new status can never silently leak back into Active Inventory.
 */
export const ACTIVE_INVENTORY_STATUSES = ['available', 'returned_to_available'] as const;

/** Inventory statuses shown under Completed Items (consumed by a transaction). */
export const CONSUMED_INVENTORY_STATUSES = [
  'provisionally_reserved',
  'committed',
  'sold_released',
  'completed',
  'released',
] as const;

/**
 * The item's stage in the live workflow, derived from the order it belongs to.
 * Destination (set at For Prepare) wins over the raw status because it is the more
 * specific fact: an order routed to Pickup should read "Pickup", not "For Shipping".
 */
function stageFromOrder(
  orderStatus: string | null,
  destination: string | null,
  availability: string,
): string {
  const byDestination: Record<string, string> = {
    shipping: 'Ship Confirm',
    delivery: 'Delivery',
    pickup: 'Pickup',
    layaway: 'For Layaway',
    keep: 'Keep',
    cancelled: 'Cancelled',
  };
  const byStatus: Record<string, string> = {
    invoiced: 'For Invoice',
    awaiting_required_payment: 'For Reminder',
    required_payment_verified: 'For Confirm',
    for_preparation: 'For Prepare',
    for_shipping_or_pickup: 'For Shipping',
    approved_for_release: 'Ship Confirm',
    exceptional_release_pending: 'Ship Confirm',
    dispatched_or_picked_up: 'Delivery',
    for_layaway: 'For Layaway',
    keep: 'Keep',
    completed: 'Completed',
    cancelled: 'Cancelled',
    for_cancel: 'Cancelled',
    expired_overdue: 'Cancelled',
  };

  // A terminal order state is the truth regardless of any earlier routing.
  if (orderStatus && ['completed', 'cancelled', 'for_cancel', 'expired_overdue'].includes(orderStatus)) {
    return byStatus[orderStatus] ?? 'Completed';
  }
  if (destination && byDestination[destination]) return byDestination[destination];
  if (orderStatus && byStatus[orderStatus]) return byStatus[orderStatus];

  // No linked order (e.g. a released item with no order): fall back to the item.
  return availability === 'released' || availability === 'sold_released'
    ? 'Released'
    : availability === 'completed'
      ? 'Completed'
      : '—';
}

export type CompletedInventoryRow = {
  inventoryItemId: string;
  itemCode: string;
  itemName: string | null;
  availabilityStatus: string;
  customerName: string | null;
  orderNumber: string | null;
  invoiceNumber: string | null;
  /** Human label: Store Pickup / Rider Delivery / Delivered / Released. */
  completionType: string;
  courier: string | null;
  trackingNumber: string | null;
  completedDate: string | null;
  currentHolder: string | null;
  currentLocation: string | null;
  /** Final sale amount (order total payable) as an authoritative string, or null. */
  finalSale: string | null;
  /** 'paid_in_full' | 'partial' | 'unpaid', or null when it could not be read. */
  paymentStatus: string | null;
  /** Where the item is in the workflow right now — derived from its order. */
  currentStage: string;
};

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

export type ReturnReviewResult =
  { ok: true; message: string } | { ok: false; error: string };

/**
 * Send a completed/released item BACK to Returned-to-Stock Review (spec §10). It
 * never becomes available directly — this only opens an in-review record; the
 * existing RTS flow (inspection + approval) is the only route back to stock. The
 * SQL function re-checks the permission and the item state.
 */
export async function returnCompletedItemToReview(
  itemId: string,
  note: string | null,
): Promise<ReturnReviewResult> {
  try {
    await requirePermission('inventory_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory.return_completed_to_review',
        entityType: 'inventory_item',
        entityId: itemId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('return_completed_item_to_review', {
    p_item_id: itemId,
    p_note: note,
  });

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };

  await recordAuditEvent({
    action: 'inventory.return_completed_to_review',
    entityType: 'inventory_item',
    entityId: itemId,
    context: { trigger_kind: 'delivered_return' },
  });

  return {
    ok: true,
    message: 'Item sent to Returned-to-Stock Review — inspection and approval required.',
  };
}

/** Derive a readable completion type from the fulfillment method + channel. */
function completionLabel(f?: {
  method: string | null;
  collection_channel: string | null;
  status: string | null;
}): string {
  if (!f) return 'Released';
  if (f.method === 'pickup') return 'Store Pickup';
  if (f.method === 'shipping') {
    return f.collection_channel === 'rider' ? 'Rider Delivery' : 'Delivered';
  }
  return 'Released';
}

export async function listCompletedInventory(): Promise<CompletedInventoryRow[]> {
  const supabase = await createClient();

  // The completed/released items themselves (RLS-scoped to active staff).
  const { data: itemData, error } = await supabase
    .from('inventory_items')
    .select(
      'id, item_code, item_name, availability_status, custody_holder, storage_location',
    )
    .in('availability_status', [...CONSUMED_INVENTORY_STATUSES])
    .order('item_code', { ascending: true });

  if (error || !itemData) return [];

  let items = itemData as Array<{
    id: string;
    item_code: string;
    item_name: string | null;
    availability_status: string;
    custody_holder: string | null;
    storage_location: string | null;
  }>;
  if (items.length === 0) return [];

  // An item sent back through Returned-to-Stock Review has LEFT Completed Items —
  // it now lives under RTS Review until inspected/approved (§10). Exclude it here.
  const { data: openReviews } = await supabase
    .from('returned_to_stock_reviews')
    .select('inventory_item_id')
    .eq('status', 'in_review')
    .in(
      'inventory_item_id',
      items.map((i) => i.id),
    );
  const underReview = new Set(
    ((openReviews ?? []) as Array<{ inventory_item_id: string }>).map(
      (r) => r.inventory_item_id,
    ),
  );
  items = items.filter((i) => !underReview.has(i.id));
  if (items.length === 0) return [];

  // The completing order + customer + fulfillment, keyed by inventory item.
  const itemIds = items.map((i) => i.id);
  const { data: claimData } = await supabase
    .from('claims')
    .select(
      `inventory_item_id,
       official_order_claims (
         official_orders (
           order_number, invoice_number, status, fulfillment_destination, created_at,
           customers ( display_name ),
           fulfillment_records (
             status, method, courier, tracking_number, completed_at, collection_channel
           )
         )
       )`,
    )
    .in('inventory_item_id', itemIds);

  type OrderShape = {
    order_number: string | null;
    invoice_number: string | null;
    status: string | null;
    fulfillment_destination: string | null;
    customers: unknown;
    fulfillment_records: unknown;
  };
  const byItem = new Map<string, OrderShape>();
  for (const row of (claimData ?? []) as Array<Record<string, unknown>>) {
    const itemId = row.inventory_item_id as string;
    if (byItem.has(itemId)) continue;
    const ooc = one<{ official_orders: unknown }>(row.official_order_claims);
    const order = one<OrderShape>(ooc?.official_orders);
    if (order) byItem.set(itemId, order);
  }

  // Final sale amount + payment status per item, from the tested balance functions
  // (one guarded batch call — never a fabricated zero).
  const moneyRes = (await supabase.rpc('completed_items_money', {
    p_item_ids: itemIds,
  })) as { data: Array<Record<string, unknown>> | null };
  const moneyByItem = new Map<string, { finalSale: string | null; paymentStatus: string | null }>();
  for (const m of moneyRes.data ?? []) {
    const id = m.inventory_item_id as string;
    moneyByItem.set(id, {
      finalSale:
        typeof m.final_sale === 'number' || typeof m.final_sale === 'string'
          ? String(m.final_sale)
          : null,
      paymentStatus: (m.payment_status as string | null) ?? null,
    });
  }

  return items.map((i) => {
    const order = byItem.get(i.id);
    const customer = one<{ display_name: string }>(order?.customers);
    const fulfillment = one<{
      method: string | null;
      collection_channel: string | null;
      status: string | null;
      courier: string | null;
      tracking_number: string | null;
      completed_at: string | null;
    }>(order?.fulfillment_records);

    return {
      inventoryItemId: i.id,
      itemCode: i.item_code,
      itemName: i.item_name,
      availabilityStatus: i.availability_status,
      customerName: customer?.display_name ?? null,
      orderNumber: order?.order_number ?? null,
      invoiceNumber: order?.invoice_number ?? null,
      completionType: completionLabel(fulfillment),
      courier: fulfillment?.courier ?? null,
      trackingNumber: fulfillment?.tracking_number ?? null,
      completedDate: fulfillment?.completed_at ?? null,
      currentHolder: i.custody_holder === 'financer' ? 'Financer' : 'A.V. Jewelry',
      currentLocation: i.storage_location,
      currentStage: stageFromOrder(
        order?.status ?? null,
        order?.fulfillment_destination ?? null,
        i.availability_status,
      ),
      finalSale: moneyByItem.get(i.id)?.finalSale ?? null,
      paymentStatus: moneyByItem.get(i.id)?.paymentStatus ?? null,
    };
  });
}
