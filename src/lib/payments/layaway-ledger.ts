import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import {
  AuthorizationError,
  requireActiveStaff,
  requireOwner,
  requireOwnerOrAdmin,
  requirePermission,
} from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { layawayDedupKey } from '@/lib/import/layaway-csv';

/**
 * Imported layaway ledger (Owner request). A FLAT list of existing layaway
 * accounts imported from a spreadsheet, shown in Layaway Accounts. Deliberately
 * separate from the order-derived layaway/money machinery — it creates no orders,
 * arrangements, or payments, so existing calculations and workflows are untouched.
 *
 * Money crosses as STRINGS end to end; Postgres numeric is exact.
 */

export type LayawayLedgerRow = {
  id: string;
  /** Reusable short code (A1–Z200) for active accounts; null once released. */
  code: string | null;
  /** The linked inventory item's Unique Code (item_code). Null for historical /
   *  imported rows with no inventory link — the UI shows "Not linked". */
  uniqueCode: string | null;
  /** Row origin: 'imported' (legacy Excel — often a balance-only account with no item)
   *  or 'manual'. Lets the UI show "Imported (no item)" for a legacy row instead of a
   *  scary "Not linked" (the item Unique Code was never part of the import). */
  sourceKind: string | null;
  /** Stored Facebook Messenger URL for a quick "Open Chat" button (or null). */
  facebookUrl: string | null;
  accountNo: string;
  customerName: string;
  status: string; // 'active' | 'completed'
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  balanceMismatch: boolean;
  nextDueDate: string | null;
  /** Date of the newest recorded payment — the completion date once fully paid. */
  lastPaymentDate: string | null;
  createdAt: string;
};

export type LayawayLedgerDetail = {
  id: string;
  code: string | null;
  /** Linked inventory Unique Code (item_code); null → "Not linked". */
  uniqueCode: string | null;
  /** Row origin: 'imported' (legacy Excel, often no item) or 'manual'. */
  sourceKind: string | null;
  accountNo: string;
  customerName: string;
  status: string;
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  balanceMismatch: boolean;
  nextDueDate: string | null;
  monthlyInterest: string | null;
  totalInstallmentInterest: string | null;
  lastPaymentDate: string | null;
  modeOfPayment: string | null;
  latestPaymentDp: string | null;
  resize: string | null;
  screw: string | null;
  notes: string | null;
  interestType: string | null;
  layawayTerm: number | null;
  interestRate: string | null;
  fixedInterest: string | null;
  /** Per-gram interest summary (null for legacy/imported accounts). Every figure
   *  is computed by SQL from the real charges — the modal only displays it. */
  perGram: {
    grams: string | null;
    monthlyInterest: string;
    interestCharged: string;
    chargesCount: number;
    nextInterestDate: string | null;
    remainingMonths: number;
    term: number | null;
  } | null;
  installments: Array<{
    sequence: number;
    dueDate: string | null;
    interest: string | null;
    expectedDp: string | null;
    status: string | null;
  }>;
  payments: Array<{
    sequence: number;
    paymentDate: string | null;
    amount: string | null;
    mop: string | null;
    reference: string | null;
    /** Staff who recorded the payment (Received By), when known. */
    receivedBy: string | null;
  }>;
  /** The layaway's items (multi-item, 2026-08-09). A row `id` is null when it is
   *  SYNTHESIZED from the account's single stored item (no layaway_ledger_items row
   *  yet) — such an item is the last one, so it cannot be removed/split until a real
   *  Add Item seeds the rows. */
  items: Array<{
    id: string | null;
    itemCode: string | null;
    itemName: string | null;
    grams: string | null;
    unitPrice: string | null;
    itemAmount: string | null;
  }>;
};

export type LayawayLedgerInstallmentInput = {
  dueDate: string | null;
  interest: string | null;
  expectedDp: string | null;
  status: string | null;
  sourcePosition: number | null;
};
export type LayawayLedgerPaymentInput = {
  paymentDate: string | null;
  amount: string | null;
  mop: string | null;
  reference: string | null;
  sourcePosition: number | null;
};

export type LayawayLedgerInput = {
  /** The account's original Code (A1…), when present. */
  code: string | null;
  customerName: string;
  status: string;
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  balanceMismatch: boolean;
  // Expanded / derived fields.
  nextDueDate: string | null;
  monthlyInterest: string | null;
  totalInstallmentInterest: string | null;
  lastPaymentDate: string | null;
  modeOfPayment: string | null;
  latestPaymentDp: string | null;
  resize: string | null;
  screw: string | null;
  notes: string | null;
  interestType: string | null;
  layawayTerm: number | null;
  interestRate: string | null;
  fixedInterest: string | null;
  installments: LayawayLedgerInstallmentInput[];
  payments: LayawayLedgerPaymentInput[];
};

export type LedgerImportResult =
  | {
      ok: true;
      inserted: number;
      skipped: number;
      installments: number;
      payments: number;
    }
  | { ok: false; error: string };

export type LedgerDeleteResult =
  { ok: true; deleted: number } | { ok: false; error: string };

export type LedgerPaymentResult =
  | { ok: true; payment: string; balance: string; status: string }
  | { ok: false; error: string };

export type LedgerUpdateResult =
  | { ok: true; grandTotal: string; balance: string; status: string }
  | { ok: false; error: string };

export type AddLedgerPaymentInput = {
  ledgerId: string;
  amount: string;
  paymentDate: string | null;
  mop: string | null;
  reference: string | null;
};

export type UpdateLedgerAccountInput = {
  id: string;
  customerName: string;
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  nextDueDate: string | null;
  notes: string | null;
};

function toStr(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return null;
}

/** Supabase embeds a to-one relation as an object (or a 1-element array); read either. */
function one<T>(v: unknown): T | null {
  if (Array.isArray(v)) return (v[0] ?? null) as T | null;
  return (v ?? null) as T | null;
}

/**
 * Resolve each ledger's inventory Unique Code(s) from its LINKED ORDER.
 *
 * A layaway created from an order (create_layaway_from_order) keeps the item on the
 * ORDER — the ledger's own inventory_item_id stays null — so the ledger→item join yields
 * nothing and the row would read "Not linked". Here we follow
 * official_orders.converted_layaway_ledger_id → claims → inventory items and return a map
 * ledger_id → "CODE1, CODE2". Isolated and guarded: any failure yields no codes and the
 * row simply keeps its legacy label, never breaking the list.
 */
async function resolveLedgerOrderCodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ledgerIds: string[],
): Promise<Map<string, string>> {
  const byLedger = new Map<string, string>();
  if (ledgerIds.length === 0) return byLedger;
  // Fetch ALL order-linked orders in ONE query (order-derived layaways are a small set) and
  // keep only the ledgers we were asked about — NEVER a giant `.in(ledgerIds)`. The LIST can
  // feed 700+ ids, which overflowed the request URL so the query silently returned nothing
  // and EVERY row read "Not linked" — while the single-id detail lookup still worked (which
  // is exactly the "column says Not linked but the Account Summary shows the code" report).
  const want = new Set(ledgerIds);
  const { data } = await supabase
    .from('official_orders')
    .select(
      'converted_layaway_ledger_id, official_order_claims ( claims ( inventory_items ( item_code ) ) )',
    )
    .not('converted_layaway_ledger_id', 'is', null);
  for (const o of (data ?? []) as Array<Record<string, unknown>>) {
    const lid = o.converted_layaway_ledger_id as string | null;
    if (!lid || !want.has(lid)) continue;
    const claimRows = (o.official_order_claims ?? []) as Array<Record<string, unknown>>;
    const codes = claimRows
      .map((oc) => {
        const claim = one<{ inventory_items: unknown }>(oc.claims);
        const inv = one<{ item_code?: string }>(claim?.inventory_items);
        return inv?.item_code ?? null;
      })
      .filter((c): c is string => Boolean(c && c.trim()));
    if (codes.length > 0) {
      const existing = byLedger.get(lid);
      byLedger.set(lid, existing ? `${existing}, ${codes.join(', ')}` : codes.join(', '));
    }
  }
  return byLedger;
}

// The SAME select + row mapping for BOTH the full list and the by-ids page reader, so a
// ledger row has one shape everywhere. Kept as a single source of truth (a column added in
// one place appears in both).
const LEDGER_SELECT =
  'id, layaway_code, account_no, customer_name, status, remarks, date_purchased, item_amount, interest, grand_total, payment, balance, balance_mismatch, next_due_date, last_payment_date, created_at, source_kind, inventory:inventory_items!layaway_ledger_inventory_item_id_fkey ( item_code ), customer:customers ( facebook_conversation_url )';

function mapLedgerRow(r: Record<string, unknown>): LayawayLedgerRow {
  return {
    id: r.id as string,
    code: (r.layaway_code as string | null) ?? null,
    uniqueCode: (r.inventory as { item_code?: string } | null)?.item_code ?? null,
    sourceKind: (r.source_kind as string | null) ?? null,
    facebookUrl:
      (r.customer as { facebook_conversation_url?: string | null } | null)
        ?.facebook_conversation_url ?? null,
    nextDueDate: (r.next_due_date as string | null) ?? null,
    lastPaymentDate: (r.last_payment_date as string | null) ?? null,
    accountNo: (r.account_no as string) ?? '—',
    customerName: (r.customer_name as string) ?? 'Unknown',
    status: (r.status as string) ?? 'active',
    remarks: (r.remarks as string | null) ?? null,
    datePurchased: (r.date_purchased as string | null) ?? null,
    itemAmount: toStr(r.item_amount),
    interest: toStr(r.interest),
    grandTotal: toStr(r.grand_total),
    payment: toStr(r.payment),
    balance: toStr(r.balance),
    balanceMismatch: r.balance_mismatch === true,
    createdAt: r.created_at as string,
  };
}

// Order-derived layaways (created from an order) carry their item on the linked ORDER, not the
// ledger — so the ledger→item join is null and they'd read "Not linked". Surface the real
// Unique Code from the linked order so it shows in the list.
async function fillLedgerOrderCodes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: LayawayLedgerRow[],
): Promise<void> {
  const orderCodes = await resolveLedgerOrderCodes(
    supabase,
    rows.filter((r) => !r.uniqueCode).map((r) => r.id),
  );
  if (orderCodes.size === 0) return;
  for (const r of rows) {
    if (!r.uniqueCode) {
      const code = orderCodes.get(r.id);
      if (code) r.uniqueCode = code;
    }
  }
}

/** All imported ledger rows the caller may read (RLS: any active staff). */
export async function listLayawayLedger(): Promise<LayawayLedgerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layaway_ledger')
    .select(LEDGER_SELECT)
    // A 'transferred' account has moved into the Orders workflow — it leaves ACTIVE
    // layaway (and all its filters/counts) but stays in the DB + audit for history.
    .neq('status', 'transferred')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  const rows = (data as Array<Record<string, unknown>>).map(mapLedgerRow);
  await fillLedgerOrderCodes(supabase, rows);
  return rows;
}

/**
 * The ledger rows for a specific set of ids, in the SAME shape as listLayawayLedger. Used by
 * the server-side Layaway page (listLayawayPage) to build ONE page's rows without loading the
 * whole ledger. Order is not guaranteed here — the caller restores the page order from the ids.
 */
export async function ledgerRowsByIds(ids: string[]): Promise<LayawayLedgerRow[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layaway_ledger')
    .select(LEDGER_SELECT)
    .in('id', ids);
  if (error || !data) return [];
  const rows = (data as Array<Record<string, unknown>>).map(mapLedgerRow);
  await fillLedgerOrderCodes(supabase, rows);
  return rows;
}

/**
 * Ledger status counts for the overview cards + the Delete-All button — counted in the DB, never
 * derived from a full client-side load. `active` / `completed` are RAW status counts (matching
 * the old `ledger.filter(l => l.status === …)`); `total` is every non-transferred account
 * (matching the old `ledger.length`, which included needs-review rows). RLS: any active staff.
 */
export async function layawayLedgerStatusCounts(): Promise<{
  active: number;
  completed: number;
  total: number;
}> {
  const supabase = await createClient();
  const [activeRes, completedRes, totalRes] = await Promise.all([
    supabase
      .from('layaway_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('layaway_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed'),
    supabase
      .from('layaway_ledger')
      .select('*', { count: 'exact', head: true })
      .neq('status', 'transferred'),
  ]);
  return {
    active: activeRes.count ?? 0,
    completed: completedRes.count ?? 0,
    total: totalRes.count ?? 0,
  };
}

/**
 * Every ledger account's duplicate key, for the Import preview's dup detection. Lazily fetched
 * only when the Import modal opens (never on page load), and range-paged in chunks so it is
 * never capped by PostgREST's 1000-row default. Built with the SAME layawayDedupKey the CSV
 * analyzer uses, so the preview's "already imported" flag is exact — and the DB unique index is
 * the real guard regardless. RLS: any active staff.
 */
export async function listLayawayDedupKeys(): Promise<string[]> {
  const supabase = await createClient();
  const keys: string[] = [];
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await supabase
      .from('layaway_ledger')
      .select('layaway_code, customer_name, date_purchased, grand_total')
      .neq('status', 'transferred')
      .order('id', { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data as Array<Record<string, unknown>>) {
      keys.push(
        layawayDedupKey({
          code: (r.layaway_code as string | null) ?? null,
          name: (r.customer_name as string) ?? 'Unknown',
          datePurchased: (r.date_purchased as string | null) ?? null,
          grandTotal: toStr(r.grand_total),
        }),
      );
    }
    if (data.length < CHUNK) break;
  }
  return keys;
}

/** A layaway ledger account marked KEEP (in remarks) — surfaced in Orders → Keep
 *  so every KEEP item shows in one place (Owner request). */
export type KeepLayawayRow = {
  id: string;
  accountNo: string;
  code: string | null;
  customerName: string;
  remarks: string | null;
  itemAmount: string | null;
  grandTotal: string | null;
  balance: string | null;
};

/** Imported layaway accounts flagged KEEP (remarks contain "KEEP"), excluding
 *  needs-review rows. Read-only; RLS-scoped to active staff. */
export async function listKeepLayawayAccounts(): Promise<KeepLayawayRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layaway_ledger')
    .select(
      'id, account_no, layaway_code, customer_name, remarks, item_amount, grand_total, balance, status',
    )
    .ilike('remarks', '%KEEP%')
    .order('customer_name', { ascending: true });

  if (error || !data) return [];

  // Only OPEN KEEP accounts belong on the Keep card. Once completed (or otherwise
  // closed) an account leaves Keep and shows under Completed Layaways instead.
  return (data as Array<Record<string, unknown>>)
    .filter(
      (r) =>
        !['needs_review', 'completed', 'cancelled', 'forfeited'].includes(
          (r.status as string) ?? '',
        ),
    )
    .map((r) => ({
      id: r.id as string,
      accountNo: (r.account_no as string) ?? '—',
      code: (r.layaway_code as string | null) ?? null,
      customerName: (r.customer_name as string) ?? 'Unknown',
      remarks: (r.remarks as string | null) ?? null,
      itemAmount: toStr(r.item_amount),
      grandTotal: toStr(r.grand_total),
      balance: toStr(r.balance),
    }));
}

/**
 * Transfer a layaway ledger account to Completed (Keep account view). Owner/Admin
 * only (the DB re-checks). Closes the account so it leaves the Keep card and shows
 * under Completed Layaways; the code is released. Leaves the balance untouched.
 */
/** Layaway → Orders destination options (the only four offered from Layaway). */
export const LAYAWAY_TRANSFER_DESTINATIONS = [
  'pickup',
  'delivery',
  'shipping',
  'keep',
] as const;
export type LayawayTransferDestination = (typeof LAYAWAY_TRANSFER_DESTINATIONS)[number];

/**
 * Transfer an ACTIVE layaway account into an Orders Flow destination — reuses the
 * linked order (never duplicates), routes it via the SAME order transfer, and marks
 * the account 'transferred' so it leaves active layaway. Guarded here (permission +
 * denied audit) AND in the SECURITY DEFINER RPC (the real, transactional gate).
 */
export async function transferLayawayToDestination(
  ledgerId: string,
  destination: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ledgerId) return { ok: false, error: 'A layaway account is required.' };
  if (
    !LAYAWAY_TRANSFER_DESTINATIONS.includes(destination as LayawayTransferDestination)
  ) {
    return { ok: false, error: 'Select a valid destination.' };
  }
  try {
    await requirePermission('fulfillment_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway.transfer_to_destination',
        entityType: 'layaway_ledger',
        entityId: ledgerId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('transfer_layaway_to_destination', {
    p_ledger_id: ledgerId,
    p_destination: destination,
  })) as { error: { message: string } | null };
  if (res.error) {
    await recordAuditEvent({
      action: 'layaway.transfer_to_destination',
      entityType: 'layaway_ledger',
      entityId: ledgerId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'layaway.transfer_to_destination',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { destination, source: 'layaway' },
  });
  return { ok: true };
}

export async function completeLayawayLedger(
  ledgerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ledgerId) return { ok: false, error: 'A layaway account is required.' };
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('complete_layaway_ledger', {
    p_ledger_id: ledgerId,
  })) as {
    error: { message: string } | null;
  };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'layaway.complete',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { status: 'completed', source_action: 'keep_transfer_completed' },
  });
  return { ok: true };
}

/**
 * Multi-item layaway editing (Owner request 2026-08-09). Owner / Selected Admin,
 * re-checked in the DB. Each mutation recomputes the account's grams → interest →
 * grand total → balance from the item list (grams × ₱150 × term).
 */
export type LayawayItemResult = { ok: true } | { ok: false; error: string };
export type LayawaySplitResult =
  { ok: true; orderNumber: string } | { ok: false; error: string };

export async function addLayawayItem(
  ledgerId: string,
  inventoryItemId: string,
  pricingType: string,
  price: string,
): Promise<LayawayItemResult> {
  if (!ledgerId || !inventoryItemId) return { ok: false, error: 'An item is required.' };
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('add_layaway_item', {
    p_ledger: ledgerId,
    p_inventory_item_id: inventoryItemId,
    p_pricing_type: pricingType,
    p_price: price,
  })) as { error: { message: string } | null };
  if (res.error)
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'layaway.add_item',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { inventoryItemId },
  });
  return { ok: true };
}

/**
 * Apply a TERM change (1/2/3 months) to an EXISTING account, then recompute interest /
 * grand total / balance / installment charges from the new term via the same authoritative
 * `recompute_layaway_from_items`. The DB refuses accounts with no itemized pieces (an
 * amount-only import would otherwise be zeroed by the recompute). Owner/Admin only.
 */
export async function setLayawayTerm(
  ledgerId: string,
  term: number,
): Promise<LayawayItemResult> {
  if (!ledgerId) return { ok: false, error: 'A layaway account is required.' };
  if (![1, 2, 3].includes(term))
    return { ok: false, error: 'Choose a term of 1, 2 or 3 months.' };
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('set_layaway_term', {
    p_ledger: ledgerId,
    p_term: term,
  })) as { error: { message: string } | null };
  if (res.error)
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'layaway.set_term',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { term },
  });
  return { ok: true };
}

export async function removeLayawayItem(
  ledgerId: string,
  itemId: string,
): Promise<LayawayItemResult> {
  if (!ledgerId || !itemId) return { ok: false, error: 'An item is required.' };
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('remove_layaway_item', {
    p_ledger: ledgerId,
    p_item_id: itemId,
  })) as { error: { message: string } | null };
  if (res.error)
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'layaway.remove_item',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { itemId },
  });
  return { ok: true };
}

export async function splitLayawayItemToOrder(
  ledgerId: string,
  itemId: string,
): Promise<LayawaySplitResult> {
  if (!ledgerId || !itemId) return { ok: false, error: 'An item is required.' };
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('split_layaway_item_to_order', {
    p_ledger: ledgerId,
    p_item_id: itemId,
  })) as { data: { order_number?: string } | null; error: { message: string } | null };
  if (res.error)
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  const orderNumber = res.data?.order_number ?? '—';
  await recordAuditEvent({
    action: 'layaway.split_item',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { itemId, newOrderNumber: orderNumber },
  });
  return { ok: true, orderNumber };
}

/**
 * Cancel a layaway ledger account (Owner/Admin). Sets status='cancelled' and
 * releases the code back to the pool — the DB refuses an already-cancelled,
 * completed, or forfeited account. Payment history is never touched.
 */
export async function cancelLayawayLedger(
  ledgerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ledgerId) return { ok: false, error: 'A layaway account is required.' };
  try {
    // Cancelling a layaway account is available to every active staff member —
    // Owner, Admin, and Staff (Owner request). The RPC re-checks active staff.
    await requireActiveStaff();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('cancel_layaway_ledger', {
    p_ledger_id: ledgerId,
  })) as {
    error: { message: string } | null;
  };
  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'layaway.cancel',
    entityType: 'layaway_ledger',
    entityId: ledgerId,
    context: { status: 'cancelled' },
  });
  return { ok: true };
}

export type LayawayDashboard = {
  active: number;
  completed: number;
  overdue: number;
  forfeited: number;
  /** Total valid layaway accounts (ledger + arrangements). */
  totalQty: number;
  createdToday: number;
  createdMonth: number;
  dueToday: number;
  due7d: number;
  /** Money figures as authoritative strings (numeric in SQL). */
  totalItem: string;
  totalInterest: string;
  grandTotal: string;
  totalPayment: string;
  remainingBalance: string;
};

/** Live layaway dashboard metrics from the database (ledger + arrangements). */
export async function getLayawayDashboard(): Promise<LayawayDashboard> {
  const supabase = await createClient();
  const res = (await supabase.rpc('layaway_dashboard_metrics')) as {
    data: Record<string, unknown> | null;
  };
  const d = res.data ?? {};
  const n = (k: string) => {
    const val = d[k];
    return typeof val === 'number' || typeof val === 'string' ? Number(val) : 0;
  };
  const s = (k: string) => {
    const val = d[k];
    return typeof val === 'number' || typeof val === 'string' ? String(val) : '0';
  };
  return {
    active: n('active'),
    completed: n('completed'),
    overdue: n('overdue'),
    forfeited: n('forfeited'),
    totalQty: n('total_qty'),
    createdToday: n('created_today'),
    createdMonth: n('created_month'),
    dueToday: n('due_today'),
    due7d: n('due_7d'),
    totalItem: s('total_item'),
    totalInterest: s('total_interest'),
    grandTotal: s('grand_total'),
    totalPayment: s('total_payment'),
    remainingBalance: s('remaining_balance'),
  };
}

/** One imported ledger account with its installment schedule + payment history
 *  (for the View modal). RLS-scoped to active staff; read-only. */
export async function getLayawayLedgerDetail(
  id: string,
): Promise<LayawayLedgerDetail | null> {
  const supabase = await createClient();
  const [acct, inst, pay, itemRows] = await Promise.all([
    supabase
      .from('layaway_ledger')
      .select(
        'id, layaway_code, account_no, customer_name, status, remarks, date_purchased, item_amount, interest, grand_total, payment, balance, balance_mismatch, next_due_date, monthly_interest, total_installment_interest, last_payment_date, mode_of_payment, latest_payment_dp, resize, screw, notes, interest_type, layaway_term, interest_rate, fixed_interest, grams, source_kind, inventory:inventory_items!layaway_ledger_inventory_item_id_fkey ( item_code )',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('layaway_ledger_installments')
      .select('sequence, due_date, interest, expected_dp, status')
      .eq('ledger_id', id)
      .order('sequence', { ascending: true }),
    supabase
      .from('layaway_ledger_payments')
      .select('sequence, payment_date, amount, mode_of_payment, reference, received_by')
      .eq('ledger_id', id)
      .order('sequence', { ascending: true }),
    supabase
      .from('layaway_ledger_items')
      .select('id, item_code, item_name, grams, unit_price, item_amount')
      .eq('ledger_id', id)
      .order('created_at', { ascending: true }),
  ]);

  const r = acct.data as Record<string, unknown> | null;
  if (!r) return null;

  // Unique Code: the ledger's own linked item, else (for an order-derived layaway) the
  // code(s) from the linked order, so the modal shows the real code instead of "Not linked".
  let resolvedUnique = (r.inventory as { item_code?: string } | null)?.item_code ?? null;
  if (!resolvedUnique) {
    const oc = await resolveLedgerOrderCodes(supabase, [r.id as string]);
    resolvedUnique = oc.get(r.id as string) ?? null;
  }

  // Per-gram interest summary — authoritative figures from SQL, computed from the
  // real posted charges. Legacy/imported accounts return basis null → no summary.
  const summaryRes = (await supabase.rpc('layaway_interest_summary', {
    p_ledger_id: id,
  })) as { data: Record<string, unknown> | null; error: unknown };
  const sum = summaryRes.data ?? {};
  const perGram =
    sum.basis === 'per_gram_150'
      ? {
          grams: toStr(sum.grams),
          monthlyInterest: toStr(sum.monthly_interest) ?? '0',
          interestCharged: toStr(sum.interest_charged) ?? '0',
          chargesCount: Number(sum.charges_count ?? 0),
          nextInterestDate: (sum.next_interest_date as string | null) ?? null,
          remainingMonths: Number(sum.remaining_months ?? 0),
          term: sum.term === null || sum.term === undefined ? null : Number(sum.term),
        }
      : null;

  // Resolve "Received By" names for the recorded payments (older imported rows
  // have no recorder). One small lookup keyed by the distinct staff ids.
  const payRows = (pay.data ?? []) as Array<Record<string, unknown>>;
  const receiverIds = [
    ...new Set(
      payRows.map((p) => p.received_by).filter((v): v is string => typeof v === 'string'),
    ),
  ];
  const receiverNames = new Map<string, string>();
  if (receiverIds.length > 0) {
    const { data: staff } = await supabase
      .from('staff_profiles')
      .select('id, full_name')
      .in('id', receiverIds);
    for (const s of (staff ?? []) as Array<Record<string, unknown>>) {
      receiverNames.set(s.id as string, (s.full_name as string) ?? '');
    }
  }

  // Items — the real layaway_ledger_items rows, or a SINGLE synthesized item from the
  // account's stored values when no rows exist yet (imported single-item accounts).
  const realItems = (itemRows.data ?? []) as Array<Record<string, unknown>>;
  const storedCode = (r.inventory as { item_code?: string } | null)?.item_code ?? null;
  const storedAmount = toStr(r.item_amount);
  const items: LayawayLedgerDetail['items'] =
    realItems.length > 0
      ? realItems.map((it) => ({
          id: it.id as string,
          itemCode: (it.item_code as string | null) ?? null,
          itemName: (it.item_name as string | null) ?? null,
          grams: toStr(it.grams),
          unitPrice: toStr(it.unit_price),
          itemAmount: toStr(it.item_amount),
        }))
      : storedCode || storedAmount
        ? [
            {
              id: null,
              itemCode: storedCode,
              itemName: null,
              grams: toStr(r.grams),
              unitPrice: storedAmount,
              itemAmount: storedAmount,
            },
          ]
        : [];

  return {
    id: r.id as string,
    code: (r.layaway_code as string | null) ?? null,
    uniqueCode: resolvedUnique,
    sourceKind: (r.source_kind as string | null) ?? null,
    accountNo: (r.account_no as string) ?? '—',
    customerName: (r.customer_name as string) ?? 'Unknown',
    status: (r.status as string) ?? 'active',
    remarks: (r.remarks as string | null) ?? null,
    datePurchased: (r.date_purchased as string | null) ?? null,
    itemAmount: toStr(r.item_amount),
    interest: toStr(r.interest),
    grandTotal: toStr(r.grand_total),
    payment: toStr(r.payment),
    balance: toStr(r.balance),
    balanceMismatch: r.balance_mismatch === true,
    nextDueDate: (r.next_due_date as string | null) ?? null,
    monthlyInterest: toStr(r.monthly_interest),
    totalInstallmentInterest: toStr(r.total_installment_interest),
    lastPaymentDate: (r.last_payment_date as string | null) ?? null,
    modeOfPayment: (r.mode_of_payment as string | null) ?? null,
    latestPaymentDp: toStr(r.latest_payment_dp),
    resize: (r.resize as string | null) ?? null,
    screw: (r.screw as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    interestType: (r.interest_type as string | null) ?? null,
    layawayTerm:
      r.layaway_term === null || r.layaway_term === undefined
        ? null
        : Number(r.layaway_term),
    interestRate: toStr(r.interest_rate),
    fixedInterest: toStr(r.fixed_interest),
    perGram,
    installments: ((inst.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
      sequence: Number(i.sequence),
      dueDate: (i.due_date as string | null) ?? null,
      interest: toStr(i.interest),
      expectedDp: toStr(i.expected_dp),
      status: (i.status as string | null) ?? null,
    })),
    payments: payRows.map((p) => ({
      sequence: Number(p.sequence),
      paymentDate: (p.payment_date as string | null) ?? null,
      amount: toStr(p.amount),
      mop: (p.mode_of_payment as string | null) ?? null,
      reference: (p.reference as string | null) ?? null,
      receivedBy:
        typeof p.received_by === 'string'
          ? (receiverNames.get(p.received_by) ?? null)
          : null,
    })),
    items,
  };
}

/**
 * Import a batch of layaway ledger rows (Owner/Admin). The database function
 * generates an account number per row, skips duplicates (same customer + date +
 * item + grand total), and returns counts. Nothing else in the system changes.
 */
export async function importLayawayLedger(
  rows: LayawayLedgerInput[],
): Promise<LedgerImportResult> {
  const clean = rows.filter((r) => r.customerName && r.customerName.trim().length > 0);
  if (clean.length === 0) return { ok: false, error: 'No valid rows to import.' };

  try {
    // Bulk import is SUPER ADMIN only (Owner request) — an Admin or Staff member
    // cannot bulk-load records even by calling this action directly.
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway_ledger.import',
        entityType: 'layaway_ledger',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const payload = clean.map((r) => ({
    code: r.code,
    customer_name: r.customerName.trim(),
    status: r.status,
    remarks: r.remarks,
    date_purchased: r.datePurchased,
    item_amount: r.itemAmount,
    interest: r.interest,
    grand_total: r.grandTotal,
    payment: r.payment,
    balance: r.balance,
    balance_mismatch: r.balanceMismatch,
    next_due_date: r.nextDueDate,
    monthly_interest: r.monthlyInterest,
    total_installment_interest: r.totalInstallmentInterest,
    last_payment_date: r.lastPaymentDate,
    mode_of_payment: r.modeOfPayment,
    latest_payment_dp: r.latestPaymentDp,
    resize: r.resize,
    screw: r.screw,
    notes: r.notes,
    interest_type: r.interestType,
    layaway_term: r.layawayTerm,
    interest_rate: r.interestRate,
    fixed_interest: r.fixedInterest,
    installments: r.installments.map((i) => ({
      due_date: i.dueDate,
      interest: i.interest,
      expected_dp: i.expectedDp,
      status: i.status,
      source_position: i.sourcePosition,
    })),
    payments: r.payments.map((p) => ({
      payment_date: p.paymentDate,
      amount: p.amount,
      mop: p.mop,
      reference: p.reference,
      source_position: p.sourcePosition,
    })),
  }));

  const supabase = await createClient();
  const response = await supabase.rpc('import_layaway_ledger', { p_rows: payload });

  if (response.error) {
    await recordAuditEvent({
      action: 'layaway_ledger.import',
      entityType: 'layaway_ledger',
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const data = (response.data ?? {}) as {
    inserted?: number;
    skipped?: number;
    installments?: number;
    payments?: number;
  };
  const inserted = Number(data.inserted ?? 0);
  const skipped = Number(data.skipped ?? 0);
  const installments = Number(data.installments ?? 0);
  const payments = Number(data.payments ?? 0);

  await recordAuditEvent({
    action: 'layaway_ledger.import',
    entityType: 'layaway_ledger',
    context: { inserted, skipped, installments, payments },
  });

  return { ok: true, inserted, skipped, installments, payments };
}

/**
 * Delete ONE imported layaway ledger account (Owner/Admin). Removes only the flat
 * imported row — never an order, arrangement, or payment. The database function is
 * the real gate; this re-checks authority for defence in depth.
 */
export async function deleteLayawayLedgerRow(id: string): Promise<LedgerDeleteResult> {
  if (!id) return { ok: false, error: 'A ledger account is required.' };

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('delete_layaway_ledger_row', { p_id: id });
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'layaway_ledger.delete',
    entityType: 'layaway_ledger',
    entityId: id,
  });
  return { ok: true, deleted: response.data === true ? 1 : 0 };
}

/**
 * Record a payment against an imported layaway account (Owner/Admin). The database
 * function inserts the payment (attributed to the recorder — Received By), recomputes
 * the account's Payment + Balance authoritatively, auto-completes it when fully paid,
 * and releases its reusable A1–Z200 code back to the pool on completion.
 */
/**
 * Record a layaway payment AND transfer the account to an Orders destination in one
 * atomic RPC (either both happen or neither). Same validation and permissions as the
 * separate payment + transfer. Destination must be one of the four routing options.
 */
export async function addLayawayPaymentAndTransfer(
  input: AddLedgerPaymentInput,
  destination: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.ledgerId) return { ok: false, error: 'A layaway account is required.' };
  const amount = (input.amount ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: 'Enter a payment amount greater than zero.' };
  }
  if (
    !LAYAWAY_TRANSFER_DESTINATIONS.includes(destination as LayawayTransferDestination)
  ) {
    return { ok: false, error: 'Select a valid destination.' };
  }
  // Both capabilities are required for the combined action.
  try {
    await requireOwnerOrAdmin();
    await requirePermission('fulfillment_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('add_layaway_payment_and_transfer', {
    p_ledger_id: input.ledgerId,
    p_amount: amount,
    p_payment_date: input.paymentDate,
    p_mop: input.mop,
    p_reference: input.reference,
    p_destination: destination,
  })) as { error: { message: string } | null };
  if (res.error) {
    await recordAuditEvent({
      action: 'layaway_ledger.payment_and_transfer',
      entityType: 'layaway_ledger',
      entityId: input.ledgerId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  await recordAuditEvent({
    action: 'layaway_ledger.payment_and_transfer',
    entityType: 'layaway_ledger',
    entityId: input.ledgerId,
    context: { amount, destination, source: 'layaway_payment' },
  });
  return { ok: true };
}

export async function addLayawayLedgerPayment(
  input: AddLedgerPaymentInput,
): Promise<LedgerPaymentResult> {
  if (!input.ledgerId) return { ok: false, error: 'A layaway account is required.' };
  const amount = (input.amount ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: 'Enter a payment amount greater than zero.' };
  }

  try {
    // Recording a layaway payment is available to every active staff member —
    // Owner, Admin, and Staff (Owner request). The RPC re-checks active staff.
    await requireActiveStaff();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('add_layaway_ledger_payment', {
    p_ledger_id: input.ledgerId,
    p_amount: amount,
    p_payment_date: input.paymentDate,
    p_mop: input.mop,
    p_reference: input.reference,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  await recordAuditEvent({
    action: 'layaway_ledger.add_payment',
    entityType: 'layaway_ledger',
    entityId: input.ledgerId,
    context: { amount, status: toStr(d.status) },
  });
  return {
    ok: true,
    payment: toStr(d.payment) ?? '0',
    balance: toStr(d.balance) ?? '0',
    status: toStr(d.status) ?? 'active',
  };
}

/**
 * Edit an imported layaway account's correctable fields (Owner/Admin). The database
 * function recomputes Grand Total (Item + Interest) and Balance, auto-completes a
 * fully-paid account, and releases its code on completion. Payment history is never
 * altered here — only Add Payment records money.
 */
export async function updateLayawayLedgerAccount(
  input: UpdateLedgerAccountInput,
): Promise<LedgerUpdateResult> {
  if (!input.id) return { ok: false, error: 'A layaway account is required.' };
  if (!input.customerName.trim())
    return { ok: false, error: 'A customer name is required.' };

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('update_layaway_ledger_account', {
    p_id: input.id,
    p_customer_name: input.customerName.trim(),
    p_remarks: input.remarks,
    p_date_purchased: input.datePurchased,
    p_item_amount: input.itemAmount,
    p_interest: input.interest,
    p_next_due_date: input.nextDueDate,
    p_notes: input.notes,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  await recordAuditEvent({
    action: 'layaway_ledger.edit',
    entityType: 'layaway_ledger',
    entityId: input.id,
  });
  return {
    ok: true,
    grandTotal: toStr(d.grandTotal) ?? '0',
    balance: toStr(d.balance) ?? '0',
    status: toStr(d.status) ?? 'active',
  };
}

/**
 * Delete ALL imported layaway ledger accounts (Owner/Admin). Clears only the flat
 * imported ledger; the order-derived layaway machinery is untouched.
 */
export async function deleteAllLayawayLedger(): Promise<LedgerDeleteResult> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('delete_all_layaway_ledger');
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const deleted = Number(response.data ?? 0);
  await recordAuditEvent({
    action: 'layaway_ledger.delete_all',
    entityType: 'layaway_ledger',
    context: { deleted },
  });
  return { ok: true, deleted };
}
