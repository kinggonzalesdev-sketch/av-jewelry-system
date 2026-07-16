import 'server-only';

import { getOrderBalance } from '@/lib/payments/balances';
import { createClient } from '@/lib/supabase/server';

/**
 * Official Orders list (Bible §7, §22.9).
 *
 * A consolidated read-only view of Official Orders with their authoritative
 * money and fulfillment status. Every figure comes from the tested reader
 * (getOrderBalance → order_balance()), never recomputed here. RLS scopes the
 * rows to what the caller may already see.
 *
 * This lists; it does not act. Row links point at the workspaces that own the
 * actions (Invoice / Payments / Fulfillment), so nothing here re-implements or
 * bypasses a guarded action.
 */

export type PaymentStatus = 'paid_in_full' | 'partial' | 'awaiting' | 'unavailable';

export type OrderListRow = {
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string;
  customerDisplayName: string;
  status: string;
  createdAt: string;
  /** Authoritative, string money — never a float, never a zero-on-failure. */
  totalAmountPayable: string;
  outstandingBalance: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: string | null;
  /** Layaway arrangement status if this order is a layaway (one per order),
   *  else null. Used by the "For Layaway" status card. */
  layawayStatus: string | null;
  /** Dispatch/ship timestamp from the fulfillment record, or null. Backs the
   *  "Ship Date" filter. */
  shipDate: string | null;
};

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

export type OrdersResult =
  { ok: true; rows: OrderListRow[] } | { ok: false; reason: string };

/**
 * Lists Official Orders, newest first.
 *
 * Returns an explicit failure rather than an empty array on a read error — an
 * unreadable list must never look like "no orders" (the session's rule).
 */
export async function listOrders(limit = 100): Promise<OrdersResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('official_orders')
    .select(
      // fulfillment_records has a single FK back to official_orders, so this
      // embed is unambiguous. official_orders → customers is likewise single.
      // layaway_arrangements is UNIQUE(official_order_id) — one per order.
      `id, order_number, invoice_number, status, created_at,
       customers ( display_name ),
       fulfillment_records ( status, dispatched_at ),
       layaway_arrangements ( status )`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { ok: false, reason: error.message };
  }

  const raw = (data ?? []) as unknown[];

  // Money per order comes from the tested authoritative reader.
  const balances = await Promise.all(
    raw.map((row) => getOrderBalance((row as Record<string, unknown>).id as string)),
  );

  const rows: OrderListRow[] = raw.map((row, index) => {
    const r = row as Record<string, unknown>;
    const customer = one<{ display_name: string }>(r.customers);
    const fulfillment = one<{ status: string; dispatched_at: string | null }>(
      r.fulfillment_records,
    );
    const layaway = one<{ status: string }>(r.layaway_arrangements);
    const balance = balances[index];

    let paymentStatus: PaymentStatus;
    let totalAmountPayable = '';
    let outstandingBalance = '';

    if (!balance || !balance.ok) {
      paymentStatus = 'unavailable';
    } else {
      totalAmountPayable = balance.balance.totalAmountPayable;
      outstandingBalance = balance.balance.outstandingBalance;
      if (balance.balance.paidInFull) {
        paymentStatus = 'paid_in_full';
      } else if (Number(balance.balance.verifiedNetPayments) > 0) {
        paymentStatus = 'partial';
      } else {
        paymentStatus = 'awaiting';
      }
    }

    return {
      officialOrderId: r.id as string,
      orderNumber: (r.order_number as string | null) ?? '—',
      invoiceNumber: (r.invoice_number as string | null) ?? '—',
      customerDisplayName: customer?.display_name ?? 'Unknown',
      status: (r.status as string | null) ?? 'unknown',
      createdAt: r.created_at as string,
      totalAmountPayable,
      outstandingBalance,
      paymentStatus,
      fulfillmentStatus: fulfillment?.status ?? null,
      layawayStatus: layaway?.status ?? null,
      shipDate: fulfillment?.dispatched_at ?? null,
    };
  });

  return { ok: true, rows };
}

export type CaptureItem = {
  id: string;
  itemCode: string;
  itemName: string | null;
  /** Catalogue unit price as an authoritative string (never a JS float), or null. */
  unitPrice: string | null;
  availabilityStatus: string;
};

/**
 * Items the New Order form can pick from — id, code, name, and the catalogue
 * unit price. Read directly (RLS scopes it to active staff); the price comes
 * from the item catalogue, not entered per order. Read-only; creates nothing.
 */
export async function listCaptureItems(limit = 300): Promise<CaptureItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inventory_items')
    .select('id, item_code, item_name, total_price_per_piece, availability_status')
    .order('item_code', { ascending: true })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    itemCode: (r.item_code as string | null) ?? '—',
    itemName: (r.item_name as string | null) ?? null,
    // Money stays a string end-to-end — never coerced to a float here.
    unitPrice:
      r.total_price_per_piece === null || r.total_price_per_piece === undefined
        ? null
        : String(r.total_price_per_piece as string | number),
    availabilityStatus: (r.availability_status as string | null) ?? 'unknown',
  }));
}
