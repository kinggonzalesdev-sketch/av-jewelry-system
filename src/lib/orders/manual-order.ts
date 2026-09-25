import 'server-only';

import { createCustomer } from '@/lib/customers/create';
import { createClient } from '@/lib/supabase/server';
import { isMissingFunction } from '@/lib/supabase/missing-schema';
import { resolveAdminName } from '@/lib/authz/admin-name';
import { validLinePricing } from '@/lib/orders/line-pricing';
import type { LinePricing } from '@/lib/orders/item-pricing';

/**
 * New Order manual entry (Bible §12, §13) — MULTI-ITEM.
 *
 * Confirm Order follows the Owner's required flow — validate → save one parent
 * order with MANY order-item records → print → For Invoice. Every item must come
 * from Active Inventory (selected by permanent id); the customer is still
 * pick-OR-type (choose an existing record, or type a new one, created on confirm).
 * A single guarded DB function (`create_new_order_multi`) saves the parent order
 * in `invoiced` (For Invoice, online), links every item as a confirmed claim, and
 * reserves each item (committed) — all atomically, so there are never partial
 * saves. Walk-In sales are a SEPARATE path (`create_walkin_order_multi`) that goes
 * straight to Completed.
 */
export type ManualOrderItemInput = {
  /** Permanent inventory item id (Active Inventory only). */
  inventoryItemId: string;
  /** Unit price (string, never a float) — the entered selling price for the item. */
  unitPrice: string;
  quantity: number;
  /** How the price was entered (Owner 2026-09-26): saved on the order line as the
   *  transaction-time snapshot Send Invoice reads. Omitted = a legacy line. */
  pricing?: LinePricing;
};

export type ManualOrderInput = {
  /** An existing customer id, OR a typed name to create one. */
  customerId: string | null;
  customerName: string | null;
  items: ManualOrderItemInput[];
  /** Admin Name (§2) — the team member the order is attributed to. Only a Super
   *  Admin may name someone else; resolveAdminName and the database both pin
   *  everyone else to their own profile. */
  adminId?: string | null;
};

export type ManualOrderResult =
  | {
      ok: true;
      officialOrderId: string;
      orderNumber: string;
      invoiceNumber: string;
      itemCount: number;
      customerName: string;
    }
  | { ok: false; error: string };

type CreateOrderRow = {
  official_order_id: string;
  order_number: string | null;
  invoice_number: string | null;
  item_count: number | null;
};

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

export async function captureManualOrder(
  input: ManualOrderInput,
): Promise<ManualOrderResult> {
  // ---- Validate the items (Active Inventory ids + positive prices) ----------
  const items = input.items ?? [];
  if (items.length === 0) {
    return { ok: false, error: 'Add at least one item to the order.' };
  }
  const seen = new Set<string>();
  for (const it of items) {
    const id = (it.inventoryItemId ?? '').trim();
    const price = (it.unitPrice ?? '').trim();
    if (!id)
      return { ok: false, error: 'Select an item from Active Inventory for every row.' };
    if (seen.has(id)) {
      return {
        ok: false,
        error: 'The same item was added more than once. Remove the duplicate.',
      };
    }
    seen.add(id);
    if (!PRICE_RE.test(price) || Number(price) <= 0) {
      return { ok: false, error: 'Enter a unit price greater than zero for every item.' };
    }
    if (it.pricing && !validLinePricing(it.pricing, price)) {
      return {
        ok: false,
        error:
          'An item’s price does not match its grams × Price Per Gram. Check the row.',
      };
    }
  }

  // ---- Resolve the customer: chosen id, or create from the typed name -------
  let customerId = input.customerId?.trim() || null;
  let customerName = input.customerName?.trim() || '';
  if (!customerId) {
    if (!customerName) {
      return { ok: false, error: 'Choose a customer, or type a new name.' };
    }
    const created = await createCustomer(customerName);
    if (!created.ok) return { ok: false, error: created.error };
    customerId = created.customerId;
    customerName = created.displayName;
  }

  // ---- Save the OFFICIAL ORDER + all its items in one atomic call -----------
  const payload = items.map((it) => ({
    id: it.inventoryItemId.trim(),
    price: it.unitPrice.trim(),
    qty: Math.max(1, it.quantity),
    ...(it.pricing ? { pricing: it.pricing } : {}),
  }));

  const supabase = await createClient();
  const args = {
    p_customer_id: customerId,
    p_customer_name: customerName || null,
    p_items: payload,
    p_admin_id: await resolveAdminName(input.adminId ?? null),
  };
  type RpcResult = {
    data: CreateOrderRow | null;
    error: { code?: string; message: string } | null;
  };
  // The order AND each line's pricing snapshot in ONE transaction (migration 20260926090000).
  // Before that migration is applied the function does not exist: save exactly as before
  // (create_new_order_multi ignores the extra "pricing" key), so the order is never lost.
  let res = (await supabase.rpc('create_new_order_multi_priced', args)) as RpcResult;
  if (isMissingFunction(res.error)) {
    res = (await supabase.rpc('create_new_order_multi', args)) as RpcResult;
  }

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const row = res.data;
  if (!row) {
    return { ok: false, error: 'The order could not be saved. Please try again.' };
  }

  return {
    ok: true,
    officialOrderId: row.official_order_id,
    orderNumber: row.order_number ?? '',
    invoiceNumber: row.invoice_number ?? '',
    itemCount: Number(row.item_count ?? payload.length),
    customerName: customerName || 'Customer',
  };
}
