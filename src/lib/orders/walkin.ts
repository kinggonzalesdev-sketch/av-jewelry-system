import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { resolveAdminName } from '@/lib/authz/admin-name';

/**
 * Walk-In sale (Owner decision 2026-07-25). A counter sale that creates a
 * fully-paid, Completed order in ONE atomic database step and retires its item to
 * the Completed section of inventory. It deliberately does NOT go through the
 * capture → invoice → approve pipeline; the SECURITY DEFINER `create_walkin_order`
 * builds the whole chain (customer, item, confirmed claim, order, verified full
 * payment, completion) and is the real gate. Money stays a string end-to-end;
 * the database computes and verifies the amount.
 */

export type WalkInItemInput = {
  inventoryItemId: string;
  price: string;
  quantity: number;
};

export type WalkInResult =
  | {
      ok: true;
      officialOrderId: string;
      orderNumber: string;
      invoiceNumber: string;
      itemCount: number;
    }
  | { ok: false; error: string };

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

export async function createWalkInOrder(input: {
  customerName: string | null;
  items: WalkInItemInput[];
  paymentMethod: string | null;
  saleDate: string | null;
  /** Admin Name (§2) — a REQUEST. resolveAdminName pins a non-Super-Admin to
   *  themselves, and the database re-applies the same rule. */
  adminId?: string | null;
}): Promise<WalkInResult> {
  const customerName = (input.customerName ?? '').trim();
  const items = input.items ?? [];

  if (!customerName) return { ok: false, error: 'Enter the customer name.' };
  if (items.length === 0) {
    return { ok: false, error: 'Add at least one item from Active Inventory.' };
  }
  const seen = new Set<string>();
  for (const it of items) {
    const id = (it.inventoryItemId ?? '').trim();
    const price = (it.price ?? '').trim();
    if (!id) return { ok: false, error: 'Select an item from Active Inventory for every row.' };
    if (seen.has(id)) {
      return { ok: false, error: 'The same item was added more than once. Remove the duplicate.' };
    }
    seen.add(id);
    if (!PRICE_RE.test(price) || Number(price) <= 0) {
      return { ok: false, error: 'Enter a price greater than zero for every item.' };
    }
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
  // Money crosses as STRINGS; PostgREST casts them. Permanent inventory item ids
  // (never names) identify the items sold.
  const payload = items.map((it) => ({
    id: it.inventoryItemId.trim(),
    price: it.price.trim(),
    qty: Math.max(1, it.quantity),
  }));
  const response = await supabase.rpc('create_walkin_order_multi', {
    p_customer_name: customerName,
    p_items: payload,
    p_payment_method: input.paymentMethod ?? 'cash',
    p_sale_date: input.saleDate || null,
    p_admin_id: await resolveAdminName(input.adminId ?? null),
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
    item_count?: number;
  };

  await recordAuditEvent({
    action: 'order.walkin',
    entityType: 'official_order',
    ...(data.official_order_id ? { entityId: data.official_order_id } : {}),
    context: { completed: true, inventory_retired: true, source: 'walk_in' },
  });

  return {
    ok: true,
    officialOrderId: data.official_order_id ?? '',
    orderNumber: data.order_number ?? '—',
    invoiceNumber: data.invoice_number ?? '—',
    itemCount: Number(data.item_count ?? payload.length),
  };
}

/** One payment in a Walk-In save (up to two). Money crosses as a string. */
export type WalkInPaymentInput = {
  method: string;
  amount: string;
  reference?: string | null;
  date?: string | null;
};

export type SaveWalkInInput = {
  customerName: string | null;
  items: WalkInItemInput[];
  /** Up to two payment methods. */
  payments: WalkInPaymentInput[];
  saleDate: string | null;
  adminId?: string | null;
};

export type SaveWalkInResult =
  | {
      ok: true;
      officialOrderId: string;
      orderNumber: string;
      invoiceNumber: string;
      itemCount: number;
      total: string;
      verifiedPaid: string;
      balance: string;
    }
  | { ok: false; error: string };

function money(v: unknown): string {
  return typeof v === 'number' || typeof v === 'string' ? String(v) : '0';
}

/**
 * Save a Walk-In WITHOUT completing it (Owner request). The guarded SQL creates
 * the order in the hold state (For Invoice), consumes the items, and records up to
 * two verified payments — the operator then transfers it to For Reminder or
 * Completed. Never auto-completes and never prints.
 */
export async function saveWalkInOrder(input: SaveWalkInInput): Promise<SaveWalkInResult> {
  const customerName = (input.customerName ?? '').trim();
  const items = input.items ?? [];
  if (!customerName) return { ok: false, error: 'Enter the customer name.' };
  if (items.length === 0) {
    return { ok: false, error: 'Add at least one item from Active Inventory.' };
  }
  const payments = (input.payments ?? []).filter((p) => (p.amount ?? '').trim() !== '');
  if (payments.length > 3) {
    return { ok: false, error: 'A Walk-In accepts at most three payment methods.' };
  }

  try {
    await requirePermission('claim_capture');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const itemPayload = items.map((it) => ({
    id: it.inventoryItemId.trim(),
    price: it.price.trim(),
  }));
  const payPayload = payments.map((p) => ({
    method: p.method,
    amount: p.amount.trim(),
    reference: p.reference?.trim() || null,
    date: p.date || null,
  }));

  const res = (await supabase.rpc('save_walkin_order', {
    p_customer_name: customerName,
    p_items: itemPayload,
    p_payments: payPayload,
    p_sale_date: input.saleDate || null,
    p_admin_id: await resolveAdminName(input.adminId ?? null),
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  await recordAuditEvent({
    action: 'order.walkin_saved',
    entityType: 'official_order',
    ...(typeof d.official_order_id === 'string' ? { entityId: d.official_order_id } : {}),
    context: { total: money(d.total), verified_paid: money(d.verified_paid), payments: payPayload.length },
  });

  return {
    ok: true,
    officialOrderId: money(d.official_order_id),
    orderNumber: money(d.order_number) || '—',
    invoiceNumber: money(d.invoice_number) || '—',
    itemCount: Number(d.item_count ?? itemPayload.length),
    total: money(d.total),
    verifiedPaid: money(d.verified_paid),
    balance: money(d.balance),
  };
}

/** Complete a saved Walk-In → Completed (fully-paid gate in the DB). */
export async function completeWalkInOrder(
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  const supabase = await createClient();
  const res = (await supabase.rpc('complete_walkin_order', { p_order_id: orderId })) as {
    error: { message: string } | null;
  };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'order.walkin_completed',
    entityType: 'official_order',
    entityId: orderId,
  });
  return { ok: true };
}

/** Update an inventory item's grams (editable Walk-In grams). Audited in the DB. */
export async function updateInventoryGrams(
  itemId: string,
  newGrams: string,
): Promise<{ ok: true; previous: string; next: string } | { ok: false; error: string }> {
  if (!itemId) return { ok: false, error: 'An item is required.' };
  const n = Number(newGrams);
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: 'Grams must be greater than zero.' };
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('update_inventory_grams', {
    p_item_id: itemId,
    p_new_grams: newGrams,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  return { ok: true, previous: money(d.previous_grams), next: money(d.new_grams) };
}

/** Set / update the shipping waybill on an order (Ship Confirm). Audited in the DB. */
export async function setOrderWaybill(
  orderId: string,
  waybill: string,
): Promise<{ ok: true; waybill: string } | { ok: false; error: string }> {
  if (!orderId) return { ok: false, error: 'An order is required.' };
  if (!waybill.trim()) return { ok: false, error: 'A waybill number is required.' };
  const supabase = await createClient();
  const res = (await supabase.rpc('set_order_waybill', {
    p_order_id: orderId,
    p_waybill: waybill.trim(),
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true, waybill: money(res.data?.waybill) };
}
