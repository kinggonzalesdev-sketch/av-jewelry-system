import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Completed Items reader (spec §5). The SAME inventory records that left Active
 * Inventory when their order completed — read here with their order / customer /
 * fulfillment context. One source of truth; nothing is copied or deleted. The
 * money figure (final sale) is intentionally omitted for now — it is derived by
 * the tested order-balance reader and would be a per-row RPC; add it deliberately.
 */

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
    .in('availability_status', ['completed', 'released'])
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
           order_number, invoice_number,
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
    };
  });
}
