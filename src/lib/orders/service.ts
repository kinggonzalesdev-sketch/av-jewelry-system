import 'server-only';

import { listInventory } from '@/lib/inventory/service';
import { getOrderBalances } from '@/lib/payments/balances';
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
  /** Tracking / air-waybill number saved on Ship Confirm, or null when none yet. */
  waybillNumber: string | null;
  customerDisplayName: string;
  /** Stored Facebook Messenger URL for a quick "Open Chat" button (or null). */
  facebookUrl: string | null;
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
  /** For-Prepare routing destination (shipping/delivery/layaway/pickup/keep), or
   *  null when not yet transferred. Routes the order to its status card. */
  fulfillmentDestination: string | null;
  /** 'walk_in' for a counter sale, else 'online'. Labelling only. */
  orderSource: string;
  /** True once the order was "Set Up as Layaway" — it then leaves the For Layaway
   *  card and is tracked in the Layaway ledger instead. */
  convertedToLayaway: boolean;
  /** Timestamps that drive latest-first sorting. `updatedAt` is bumped by every
   *  real order action (status transitions, payments, verifications, waybill,
   *  cancellation, completion…); `completedAt` backs the Completed card's
   *  completed_at-first order. Both can be null on very old rows. */
  updatedAt: string | null;
  completedAt: string | null;
};

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

export type OrdersResult =
  { ok: true; rows: OrderListRow[] } | { ok: false; reason: string };

/** The ONE embed shape used by both the full list and the server-paginated page, so the
 *  row shape + money are byte-for-byte identical. */
const ORDER_LIST_SELECT = `id, order_number, invoice_number, status, created_at, updated_at, completed_at,
   fulfillment_destination, order_source, converted_to_layaway, waybill_number,
   customers ( display_name, facebook_conversation_url ),
   fulfillment_records ( status, dispatched_at ),
   layaway_arrangements ( status )`;

/** Map ONE official_orders row (+ the batched authoritative balance) to an OrderListRow.
 *  Shared by listOrders and listOrdersPage — the money never comes from anywhere else. */
function toOrderListRow(
  row: unknown,
  balanceById: Awaited<ReturnType<typeof getOrderBalances>>,
): OrderListRow {
  const r = row as Record<string, unknown>;
  const customer = one<{
    display_name: string;
    facebook_conversation_url: string | null;
  }>(r.customers);
  const fulfillment = one<{ status: string; dispatched_at: string | null }>(
    r.fulfillment_records,
  );
  const layaway = one<{ status: string }>(r.layaway_arrangements);
  const balance = balanceById.get(r.id as string);

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
    waybillNumber: (r.waybill_number as string | null) ?? null,
    customerDisplayName: customer?.display_name ?? 'Unknown',
    facebookUrl: customer?.facebook_conversation_url ?? null,
    status: (r.status as string | null) ?? 'unknown',
    createdAt: r.created_at as string,
    totalAmountPayable,
    outstandingBalance,
    paymentStatus,
    fulfillmentStatus: fulfillment?.status ?? null,
    layawayStatus: layaway?.status ?? null,
    shipDate: fulfillment?.dispatched_at ?? null,
    fulfillmentDestination: (r.fulfillment_destination as string | null) ?? null,
    orderSource: (r.order_source as string | null) ?? 'online',
    convertedToLayaway: r.converted_to_layaway === true,
    updatedAt: (r.updated_at as string | null) ?? null,
    completedAt: (r.completed_at as string | null) ?? null,
  };
}

export type OrdersPageResult =
  | {
      ok: true;
      rows: OrderListRow[];
      /** EXACT count of orders matching the active flow-card + search + date. */
      total: number;
      /** Full-store counts per status card (ignores search/date/card — matches the UI). */
      cardCounts: Record<string, number>;
    }
  | { ok: false; reason: string };

/**
 * ONE PAGE of Official Orders with an EXACT server-side total + full-store card counts
 * (Owner request — Orders must scale to 50,000+ without loading every row into the
 * browser). The flow-card filter, search (order#/invoice#/waybill/customer), date range,
 * counts, and total are all computed in SQL (`orders_page`); only this page's ids come
 * back, then the SAME `ORDER_LIST_SELECT` + `getOrderBalances` reader builds the rows — so
 * the row shape + money are identical to the full list. Rows keep the RPC's sort order.
 */
export async function listOrdersPage(opts: {
  search?: string;
  card?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  size?: number;
}): Promise<OrdersPageResult> {
  const supabase = await createClient();
  const size = Math.min(Math.max(opts.size ?? 25, 1), 200);
  const page = Math.max(opts.page ?? 1, 1);

  const res = (await supabase.rpc('orders_page', {
    p_search: (opts.search ?? '').trim(),
    p_card: opts.card ?? 'all',
    p_date_from: opts.dateFrom ?? '',
    p_date_to: opts.dateTo ?? '',
    p_limit: size,
    p_offset: (page - 1) * size,
  })) as {
    data: {
      ids?: string[] | null;
      total?: number | null;
      cardCounts?: Record<string, number> | null;
    } | null;
    error: { message: string } | null;
  };
  if (res.error) return { ok: false, reason: res.error.message };

  const ids = (res.data?.ids ?? []).filter((v): v is string => typeof v === 'string');
  const total = Number(res.data?.total ?? 0);
  const cardCounts = res.data?.cardCounts ?? {};
  if (ids.length === 0) return { ok: true, rows: [], total, cardCounts };

  const { data, error } = await supabase
    .from('official_orders')
    .select(ORDER_LIST_SELECT)
    .in('id', ids);
  if (error) return { ok: false, reason: error.message };

  const balanceById = await getOrderBalances(ids);
  const orderIndex = new Map(ids.map((id, i) => [id, i] as const));
  const rows = ((data ?? []) as unknown[])
    .map((row) => toOrderListRow(row, balanceById))
    .sort(
      (a, b) =>
        (orderIndex.get(a.officialOrderId) ?? 0) - (orderIndex.get(b.officialOrderId) ?? 0),
    );

  return { ok: true, rows, total, cardCounts };
}

/**
 * Lists Official Orders, newest first.
 *
 * Returns an explicit failure rather than an empty array on a read error — an
 * unreadable list must never look like "no orders" (the session's rule).
 */
export async function listOrders(): Promise<OrdersResult> {
  const supabase = await createClient();

  // Load EVERY order, not just the first page. The status cards summarise the
  // whole store (Total, Ship Confirm, Pending Payment, …); when this capped at
  // the latest 100 rows the Owner saw "Total 100" while the store held far more,
  // and every card counted only within that 100-row window (Owner report
  // 2026-08-09). PostgREST returns at most 1000 rows per request, so page
  // through with .range() until a short page signals the end. The table still
  // paginates these rows client-side. (When the store grows into the thousands
  // this becomes the server-side-count/pagination refactor already flagged.)
  const PAGE = 1000;
  const raw: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('official_orders')
      // Same embed as the paginated page (ORDER_LIST_SELECT) so the shape stays identical.
      .select(ORDER_LIST_SELECT)
      // Latest activity first (Owner request): updated_at is bumped by every real
      // action, so the most recently touched order sits on top. created_at + id are
      // the stable fallbacks when updated_at ties or is null. Opening/viewing writes
      // nothing, so it never reorders the list.
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) {
      return { ok: false, reason: error.message };
    }

    const batch = (data ?? []) as unknown[];
    raw.push(...batch);
    if (batch.length < PAGE) break;
  }

  // Money per order comes from the tested authoritative reader — but batched into
  // ONE round-trip (getOrderBalances) instead of one RPC per row. At ~100 orders
  // the per-row pattern was ~100 network round-trips and made this page take
  // several seconds; the batch call is a single trip with the identical formula.
  const balanceById = await getOrderBalances(
    raw.map((row) => (row as Record<string, unknown>).id as string),
  );

  const rows = raw.map((row) => toOrderListRow(row, balanceById));

  return { ok: true, rows };
}

export type CaptureItem = {
  id: string;
  itemCode: string;
  itemName: string | null;
  /** Catalogue unit price as an authoritative string (never a JS float), or null. */
  unitPrice: string | null;
  /** Weight per piece as a string (e.g. "12.2"), or null. Used on the sticker. */
  gramsPerPiece: string | null;
  availabilityStatus: string;
};

/**
 * Items the New Order form can pick from — id, code, name, and the catalogue
 * unit price. Read directly (RLS scopes it to active staff); the price comes
 * from the item catalogue, not entered per order. Read-only; creates nothing.
 */
export async function listCaptureItems(): Promise<CaptureItem[]> {
  const supabase = await createClient();

  // Loads EVERY available item so the New Order + Layaway pickers always detect all
  // active inventory. A previous 500-most-recent cap silently dropped the older
  // stock (2,400+ items on the live catalogue), so items genuinely in Active
  // Inventory were "sometimes not found". PostgREST caps a single response at ~1000
  // rows, so we page through in 1000s (same pattern as listInventory). Archived /
  // committed / sold items are never offered. searchCaptureItems remains for very
  // large future catalogues; here the picker gets the complete list.
  const PAGE = 1000;
  const out: CaptureItem[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('inventory_items')
      .select(
        'id, item_code, item_name, total_price_per_piece, grams_per_piece, availability_status',
      )
      .eq('is_archived', false)
      .in('availability_status', ['available', 'returned_to_available'])
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as Array<Record<string, unknown>>) {
      // Cast to the concrete numeric/string type BEFORE stringifying so lint knows
      // it's a real value (not an object), while money stays a string end-to-end.
      const price = r.total_price_per_piece as string | number | null | undefined;
      const grams = r.grams_per_piece as string | number | null | undefined;
      out.push({
        id: r.id as string,
        itemCode: (r.item_code as string | null) ?? '—',
        itemName: (r.item_name as string | null) ?? null,
        unitPrice: price === null || price === undefined ? null : String(price),
        gramsPerPiece: grams === null || grams === undefined ? null : String(grams),
        availabilityStatus: (r.availability_status as string | null) ?? 'unknown',
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Server-side search for the New Order item picker (scales to 20k+ items). Returns the
 * top matches among AVAILABLE inventory for a typed query, ranked exact-code → code
 * prefix → code contains → name contains. Uses the trigram + (availability_status,
 * item_code) indexes. Read-only. The query is sanitized to alphanumerics/space/dash so
 * it can never break the PostgREST `or` filter or inject.
 */
export async function searchCaptureItems(
  query: string,
  limit = 30,
): Promise<CaptureItem[]> {
  const safe = query.replace(/[^a-zA-Z0-9 -]/g, ' ').trim();
  if (safe.length < 1) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('inventory_items')
    .select(
      'id, item_code, item_name, total_price_per_piece, grams_per_piece, availability_status',
    )
    .eq('is_archived', false)
    .in('availability_status', ['available', 'returned_to_available'])
    .or(`item_code.ilike.%${safe}%,item_name.ilike.%${safe}%`)
    .limit(limit * 3);
  if (error || !data) return [];

  const rows = data as Array<Record<string, unknown>>;
  const mapped: CaptureItem[] = rows.map((r) => ({
    id: r.id as string,
    itemCode: (r.item_code as string | null) ?? '—',
    itemName: (r.item_name as string | null) ?? null,
    unitPrice:
      r.total_price_per_piece === null || r.total_price_per_piece === undefined
        ? null
        : String(r.total_price_per_piece as string | number),
    gramsPerPiece:
      r.grams_per_piece === null || r.grams_per_piece === undefined
        ? null
        : String(r.grams_per_piece as string | number),
    availabilityStatus: (r.availability_status as string | null) ?? 'unknown',
  }));

  const q = safe.toLowerCase();
  const rank = (it: CaptureItem): number => {
    const code = it.itemCode.toLowerCase();
    const name = (it.itemName ?? '').toLowerCase();
    if (code === q) return 0;
    if (code.startsWith(q)) return 1;
    if (code.includes(q)) return 2;
    if (name.includes(q)) return 3;
    return 4;
  };
  return mapped
    .sort((a, b) => rank(a) - rank(b) || a.itemCode.localeCompare(b.itemCode))
    .slice(0, limit);
}

/** A single Active-Inventory item the Walk-In selector may sell — its permanent
 *  ID, code, Facebook name, and grams. Only truly-sellable items are returned. */
export type WalkInItem = {
  id: string;
  itemCode: string;
  facebookName: string | null;
  grams: string | null;
};

/**
 * Active-Inventory items available for a Walk-In sale. Reuses the tested
 * `listInventory` (inventory_monitor) status logic: `availableQuantity > 0`
 * already means NOT reserved, NOT completed/released, and NOT archived — so this
 * returns exactly the items that are available, not reserved, not completed, not
 * deleted. Read-only; sells nothing.
 */
export async function listWalkInItems(): Promise<WalkInItem[]> {
  const result = await listInventory();
  if (!result.ok) return [];
  return result.rows
    .filter(
      (r) =>
        r.availableQuantity > 0 &&
        !r.inRtsReview &&
        (r.availabilityStatus === 'available' ||
          r.availabilityStatus === 'returned_to_available'),
    )
    .map((r) => ({
      id: r.inventoryItemId,
      itemCode: r.itemCode,
      facebookName: r.facebookName,
      grams: r.gramsPerPiece,
    }));
}

/** One line of an Official Order — the claimed item, its weight, quantity, and
 *  catalogue unit price. Money/weight stay authoritative strings (never floats). */
export type OrderLineItem = {
  /** The claim uuid — targets this line for Edit Items (Remove / Split). */
  claimId: string;
  claimReference: string;
  itemName: string | null;
  itemCode: string | null;
  gramsPerPiece: string | null;
  quantity: number;
  unitPrice: string | null;
};

/**
 * The line items of one Official Order (its claimed items). RLS-scoped: it returns
 * rows only for an order the caller may already read — read-only, creates nothing.
 * Used by the Order Details drawer to show what item(s) the order is for and how
 * many grams.
 */
export async function getOrderLineItems(
  officialOrderId: string,
): Promise<OrderLineItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('official_order_claims')
    .select(
      `claim_id,
       claims (
         quantity, claim_reference,
         inventory_items ( item_name, item_code, grams_per_piece, total_price_per_piece )
       )`,
    )
    .eq('official_order_id', officialOrderId);

  if (error || !data) return [];

  type ItemShape = {
    item_name: string | null;
    item_code: string | null;
    grams_per_piece: string | number | null;
    total_price_per_piece: string | number | null;
  };
  type ClaimShape = {
    quantity: string | number | null;
    claim_reference: string | null;
    inventory_items: ItemShape | ItemShape[] | null;
  };

  return (
    data as Array<{ claim_id: string; claims: ClaimShape | ClaimShape[] | null }>
  ).map((row) => {
    const claim = one<ClaimShape>(row.claims);
    const item = one<ItemShape>(claim?.inventory_items);
    return {
      claimId: row.claim_id,
      claimReference: claim?.claim_reference ?? '—',
      itemName: item?.item_name ?? null,
      itemCode: item?.item_code ?? null,
      gramsPerPiece:
        item?.grams_per_piece === null || item?.grams_per_piece === undefined
          ? null
          : String(item.grams_per_piece),
      quantity: Number(claim?.quantity ?? 0),
      unitPrice:
        item?.total_price_per_piece === null || item?.total_price_per_piece === undefined
          ? null
          : String(item.total_price_per_piece),
    };
  });
}
