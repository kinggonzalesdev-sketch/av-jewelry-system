import 'server-only';

import { getOrderBalance } from '@/lib/payments/balances';
import { createClient } from '@/lib/supabase/server';

/**
 * Waybill data (#3 deeper). A waybill is a printable dispatch slip for one
 * Official Order — sender, recipient, order reference, courier/channel, and the
 * COD amount to collect. Every field is REAL and RLS-scoped: the shipping label
 * is only as trustworthy as the record behind it, so nothing here is invented.
 *
 * Money (the COD amount to collect) is the order's outstanding balance — numeric
 * in SQL, a string here. When the balance cannot be read the amount is null and
 * the waybill says so, rather than printing a false ₱0 a rider would collect on.
 */

export type Waybill = {
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string | null;
  customerName: string;
  customerContact: string | null;
  method: string | null;
  courier: string | null;
  trackingNumber: string | null;
  collectionChannel: string | null;
  isCod: boolean;
  /** Outstanding balance to collect on COD, as a string; null if unreadable. */
  codAmount: string | null;
  /** True when isCod but the amount could not be read — do not print a figure. */
  codAmountUnavailable: boolean;
  dispatchedAt: string | null;
  generatedAt: string;
};

export type WaybillResult =
  { ok: true; waybill: Waybill } | { ok: false; reason: string };

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

export async function getWaybill(officialOrderId: string): Promise<WaybillResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('fulfillment_records')
    .select(
      `official_order_id, method, courier, tracking_number, is_cod, collection_channel,
       dispatched_at,
       official_orders ( order_number, invoice_number, customers ( display_name, contact_number ) )`,
    )
    .eq('official_order_id', officialOrderId)
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: 'No fulfillment record for that order.' };

  const r = data as Record<string, unknown>;
  const order = one<{
    order_number: string;
    invoice_number: string | null;
    customers: unknown;
  }>(r.official_orders);
  const customer = one<{ display_name: string; contact_number: string | null }>(
    order?.customers,
  );

  const isCod = r.is_cod === true;

  // Only read a balance when it is a COD order — a non-COD waybill collects nothing.
  let codAmount: string | null = null;
  let codAmountUnavailable = false;
  if (isCod) {
    const balance = await getOrderBalance(officialOrderId);
    if (balance.ok) codAmount = balance.balance.outstandingBalance;
    else codAmountUnavailable = true;
  }

  return {
    ok: true,
    waybill: {
      officialOrderId,
      orderNumber: order?.order_number ?? '—',
      invoiceNumber: (order?.invoice_number as string | null) ?? null,
      customerName: customer?.display_name ?? 'Unknown',
      customerContact: (customer?.contact_number as string | null) ?? null,
      method: (r.method as string | null) ?? null,
      courier: (r.courier as string | null) ?? null,
      trackingNumber: (r.tracking_number as string | null) ?? null,
      collectionChannel: (r.collection_channel as string | null) ?? null,
      isCod,
      codAmount,
      codAmountUnavailable,
      dispatchedAt: (r.dispatched_at as string | null) ?? null,
      generatedAt: new Date().toISOString(),
    },
  };
}
