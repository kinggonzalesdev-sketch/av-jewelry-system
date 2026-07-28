import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Walk-In sale (Owner decision 2026-07-25). A counter sale that creates a
 * fully-paid, Completed order in ONE atomic database step and retires its item to
 * the Completed section of inventory. It deliberately does NOT go through the
 * capture → invoice → approve pipeline; the SECURITY DEFINER `create_walkin_order`
 * builds the whole chain (customer, item, confirmed claim, order, verified full
 * payment, completion) and is the real gate. Money stays a string end-to-end;
 * the database computes and verifies the amount.
 */

export type WalkInResult =
  | { ok: true; orderNumber: string; invoiceNumber: string; itemCode: string }
  | { ok: false; error: string };

export async function createWalkInOrder(input: {
  customerName: string | null;
  inventoryItemId: string | null;
  price: string | null;
  paymentMethod: string | null;
  saleDate: string | null;
}): Promise<WalkInResult> {
  const customerName = (input.customerName ?? '').trim();
  const inventoryItemId = (input.inventoryItemId ?? '').trim();
  const price = (input.price ?? '').trim();

  if (!customerName) return { ok: false, error: 'Enter the customer name.' };
  if (!inventoryItemId) {
    return { ok: false, error: 'Select an item from Active Inventory.' };
  }
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
    return { ok: false, error: 'Enter a price like 1500 or 1500.50 (greater than zero).' };
  }

  try {
    await requirePermission('claim_capture');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.walkin',
        entityType: 'official_order',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  // Money crosses as a STRING; PostgREST casts it to the numeric parameter. The
  // permanent inventory item ID (never the name) identifies the item sold.
  const response = await supabase.rpc('create_walkin_order', {
    p_customer_name: customerName,
    p_inventory_item_id: inventoryItemId,
    p_price: price,
    p_payment_method: input.paymentMethod ?? 'cash',
    p_sale_date: input.saleDate || null,
  });

  if (response.error) {
    await recordAuditEvent({
      action: 'order.walkin',
      entityType: 'official_order',
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const data = (response.data ?? {}) as {
    official_order_id?: string;
    order_number?: string;
    invoice_number?: string;
    item_code?: string;
  };

  await recordAuditEvent({
    action: 'order.walkin',
    entityType: 'official_order',
    ...(data.official_order_id ? { entityId: data.official_order_id } : {}),
    context: { completed: true, inventory_retired: true, source: 'walk_in' },
  });

  return {
    ok: true,
    orderNumber: data.order_number ?? '—',
    invoiceNumber: data.invoice_number ?? '—',
    itemCode: data.item_code ?? '—',
  };
}
