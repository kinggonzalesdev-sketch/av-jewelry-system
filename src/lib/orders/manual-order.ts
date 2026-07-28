import 'server-only';

import { createCustomer } from '@/lib/customers/create';
import { createManualItem } from '@/lib/inventory/create';
import { createClient } from '@/lib/supabase/server';

/**
 * New Order manual entry (Bible §12, §13) — the "pick OR type" capture.
 *
 * The New Order form lets the operator either CHOOSE an existing customer/item
 * or TYPE a new one. An order references real records, so a typed name is turned
 * into a real record first (a real customer, a real available inventory item),
 * then a single guarded DB function (`create_new_order`) saves an OFFICIAL ORDER
 * directly into `For Invoice` (invoiced) — not a Pending Claim. That function
 * locks the item, blocks selling it twice, reserves it (committed) linked to the
 * new order, and creates the order + its invoice number atomically. Nothing is
 * faked and nothing bypasses a rule: creating the customer/item each run their
 * own permission + RLS checks, and the order function is gated on claim_capture.
 *
 * Walk-In sales are a SEPARATE path (`create_walkin_order`) that goes straight to
 * Completed; this function is only the regular New Order → For Invoice flow.
 *
 * Returns the saved order's numbers + resolved display names so the client can
 * print an honest label of exactly what was recorded, then transfer it into the
 * For Invoice list.
 */
export type ManualOrderInput = {
  idempotencyKey: string | null;
  quantity: number;
  note: string | null;
  /** An existing customer id, OR a typed name to create one. */
  customerId: string | null;
  customerName: string | null;
  /** An existing inventory item id, OR a typed name to create one. */
  inventoryItemId: string | null;
  itemName: string | null;
  /** Unit price (string, never a float). For a NEW typed item it defines the
   *  item's price; for an EXISTING item the entered selling price is applied to
   *  the item (Owner request — any order creator may set it, no price override). */
  unitPrice: string | null;
  /** Weight per piece (string) for a NEW typed item; ignored for existing. */
  grams: string | null;
};

export type ManualOrderResult =
  | {
      ok: true;
      officialOrderId: string;
      orderNumber: string;
      invoiceNumber: string;
      itemCode: string;
      customerName: string;
      itemName: string;
    }
  | { ok: false; error: string };

type CreateNewOrderRow = {
  official_order_id: string;
  order_number: string | null;
  invoice_number: string | null;
  item_code: string | null;
  item_name: string | null;
};

export async function captureManualOrder(
  input: ManualOrderInput,
): Promise<ManualOrderResult> {
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

  // ---- Price is required and must be a positive amount (Owner request) ------
  const price = input.unitPrice?.trim() || '';
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
    return { ok: false, error: 'Enter a unit price greater than zero.' };
  }

  // ---- Resolve the item: chosen id, or create from the typed name -----------
  let inventoryItemId = input.inventoryItemId?.trim() || null;
  let itemName = input.itemName?.trim() || '';
  if (!inventoryItemId) {
    if (!itemName) {
      return { ok: false, error: 'Choose an item, or type a new item name.' };
    }
    // A typed item becomes a real, available inventory item — with the manually
    // entered unit price. createManualItem enforces its own permission and
    // validates the price; its refusal is surfaced verbatim. (create_new_order
    // re-applies the price on the saved item, so both paths agree.)
    const created = await createManualItem(itemName, price, input.grams);
    if (!created.ok) return { ok: false, error: created.error };
    inventoryItemId = created.inventoryItemId;
  }

  // ---- Save the OFFICIAL ORDER directly into For Invoice --------------------
  // One guarded, item-locking DB call: applies the selling price, creates the
  // confirmed claim + official order (invoiced / online), reserves the item
  // (committed) linked to the order, and returns the order + invoice numbers.
  const supabase = await createClient();
  const res = (await supabase.rpc('create_new_order', {
    p_customer_id: customerId,
    p_customer_name: customerName || null,
    p_inventory_item_id: inventoryItemId,
    p_unit_price: price,
    p_quantity: Math.max(1, input.quantity),
  })) as { data: CreateNewOrderRow | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const row = res.data;
  if (!row) {
    return { ok: false, error: 'The order could not be saved. Please try again.' };
  }

  if (!itemName) itemName = row.item_name?.trim() || 'Item';

  return {
    ok: true,
    officialOrderId: row.official_order_id,
    orderNumber: row.order_number ?? '',
    invoiceNumber: row.invoice_number ?? '',
    itemCode: row.item_code ?? '',
    customerName: customerName || 'Customer',
    itemName,
  };
}
