import { beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate the readers: stub their module-load deps so we don't pull in next/headers.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: vi.fn() }));
vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requirePermission: vi.fn(),
}));

import { getClaimForReview, listClaimReviewQueue } from '@/lib/claims/review';
import { computeEligibility, listInvoiceDrafts } from '@/lib/invoicing/drafts';
import { createClient } from '@/lib/supabase/server';

/**
 * Two N+1 readers collapsed into a fixed number of batched reads:
 *
 *   - Claim Review hydrate: was 1 + 5 requests PER claim (aliases, miner, waitlist,
 *     evidence, available_quantity_for RPC). Now 1 + 5 in total (4 `.in()` reads +
 *     one available_quantities_for batch RPC), whatever the claim count.
 *   - Invoice Drafts list: was 1 + one claims read PER draft. Now 1 + 1.
 *   - Invoice eligibility: its three "already drafted / ordered / reserved" reads
 *     were UNSCOPED, so PostgREST's 1,000-row cap silently dropped rows on a large
 *     store. They are now scoped to the candidate claim ids (chunks of ≤300).
 *
 * The fake below is a tiny in-memory PostgREST: it applies eq/in/order/limit/
 * range/maybeSingle for real, enforces the 1,000-row response cap, and records
 * every request. The `legacy*` functions are verbatim copies of the readers at
 * df4fbd6 (before this change), run against the same data to prove the hydrated
 * objects are identical.
 */

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count: number | null };
type Db = { tables: Record<string, Row[]>; available?: Record<string, number | null> };
type Call = { kind: 'from' | 'rpc'; name: string; inSizes: number[] };

/** PostgREST's response cap (Supabase `max-rows` default). */
const MAX_ROWS = 1000;

function cmp(a: unknown, b: unknown): number {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

class FakeQuery implements PromiseLike<Result> {
  private readonly preds: Array<(r: Row) => boolean> = [];
  private sort: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private window: [number, number] | null = null;
  private single = false;
  private exactCount = false;

  constructor(
    private readonly rows: Row[],
    private readonly call: Call,
  ) {}

  select(_columns?: string, opts?: { count?: 'exact' }) {
    this.exactCount = opts?.count === 'exact';
    return this;
  }
  eq(col: string, value: unknown) {
    this.preds.push((r) => r[col] === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    const set = new Set(values);
    this.call.inSizes.push(values.length);
    this.preds.push((r) => set.has(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.sort = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): Result {
    let rows = this.rows.filter((r) => this.preds.every((p) => p(r)));
    const total = rows.length;
    if (this.sort) {
      const { col, asc } = this.sort;
      rows = [...rows].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
    }
    if (this.window) rows = rows.slice(this.window[0], this.window[1] + 1);
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    rows = rows.slice(0, MAX_ROWS);
    if (this.single) {
      return rows.length > 1
        ? { data: null, error: { message: 'multiple rows returned' }, count: null }
        : { data: rows[0] ?? null, error: null, count: null };
    }
    return { data: rows, error: null, count: this.exactCount ? total : null };
  }
}

function installFake(db: Db) {
  const calls: Call[] = [];
  const available = db.available ?? {};
  const client = {
    from(table: string) {
      const call: Call = { kind: 'from', name: table, inSizes: [] };
      calls.push(call);
      return new FakeQuery(db.tables[table] ?? [], call);
    },
    rpc(name: string, args: Record<string, unknown>): Promise<Result> {
      calls.push({ kind: 'rpc', name, inSizes: [] });
      if (name === 'available_quantity_for') {
        const data = available[args.p_item_id as string] ?? null;
        return Promise.resolve({ data, error: null, count: null });
      }
      if (name === 'available_quantities_for') {
        const data = (args.p_item_ids as string[]).map((id) => ({
          item_id: id,
          available_quantity: available[id] ?? null,
        }));
        return Promise.resolve({ data, error: null, count: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: 'unknown rpc' },
        count: null,
      });
    },
  };
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, calls };
}

type FakeClient = ReturnType<typeof installFake>['client'];

const pad = (i: number) => String(i).padStart(4, '0');

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// Legacy readers — verbatim logic from df4fbd6, taking the client as a parameter.
// ─────────────────────────────────────────────────────────────────────────────

async function legacyHydrate(supabase: FakeClient, row: Row) {
  const batch = one<{ batch_reference: string; title: string }>(row.live_batches);
  const customer = one<{ display_name: string }>(row.customers);
  const item = one<{
    item_code: string | null;
    item_name: string | null;
    grams_per_piece: number | null;
    total_price_per_piece: number | null;
    is_unique_item: boolean;
    quantity_total: number;
  }>(row.inventory_items);
  const capturedBy = one<{ full_name: string }>(row.staff_profiles);

  const claimId = row.id as string;
  const itemId = row.inventory_item_id as string;
  const quantity = row.quantity as number;

  const [aliasRes, minerRes, waitRes, evidenceRes, availableRes] = await Promise.all([
    supabase
      .from('customer_aliases')
      .select('alias')
      .eq('customer_id', row.customer_id as string)
      .eq('alias_kind', 'facebook_name')
      .limit(1),
    supabase
      .from('miner_positions')
      .select('position, assigned_at')
      .eq('claim_id', claimId)
      .maybeSingle(),
    supabase
      .from('waitlist_entries')
      .select('status')
      .eq('claim_id', claimId)
      .maybeSingle(),
    supabase.from('claim_evidence').select('id').eq('claim_id', claimId),
    supabase.rpc('available_quantity_for', { p_item_id: itemId }),
  ]);
  const aliasData = aliasRes.data as Row[] | null;
  const minerData = minerRes.data as Row | null;
  const waitData = waitRes.data as Row | null;
  const evidenceData = evidenceRes.data as Row[] | null;

  const availableQuantity = typeof availableRes.data === 'number' ? availableRes.data : 0;
  const isUnique = item?.is_unique_item ?? true;
  const minerPosition = (minerData?.position as number | undefined) ?? null;

  const warnings: Array<{ severity: 'blocking' | 'advisory'; message: string }> = [];

  if (availableQuantity < quantity) {
    warnings.push({
      severity: 'blocking',
      message: `Not enough available stock: ${quantity} requested, ${availableQuantity} available. Confirming will be refused.`,
    });
  }
  if (isUnique && minerPosition === 2) {
    warnings.push({
      severity: 'advisory',
      message:
        'This is the 2nd Miner. The priority window is not yet defined, and no automatic transfer or promotion exists — any switch is a manual, authorized review.',
    });
  }
  if (waitData) {
    warnings.push({
      severity: 'advisory',
      message:
        'This claim is waitlisted. There is no automatic allocation or promotion — resolving it is a manual, attributed decision.',
    });
  }
  if ((evidenceData?.length ?? 0) === 0) {
    warnings.push({
      severity: 'advisory',
      message: 'No capture evidence is attached. Check the details against the Live.',
    });
  }

  return {
    claimId,
    claimReference: row.claim_reference as string,
    status: row.status as string,
    captureMethod: (row.capture_method as string | null) ?? null,
    intakeKind: row.intake_kind as string,
    capturedAt: row.created_at as string,
    capturedByName: capturedBy?.full_name ?? null,
    capturedAgainstFlexItem: row.captured_against_flex_item === true,
    liveBatchId: (row.live_batch_id as string | null) ?? null,
    liveBatchReference: batch?.batch_reference ?? null,
    liveBatchTitle: batch?.title ?? null,
    customerId: row.customer_id as string,
    customerDisplayName: customer?.display_name ?? 'Unknown',
    customerFacebookName: (aliasData?.[0]?.alias as string | undefined) ?? null,
    inventoryItemId: itemId,
    itemCode: item?.item_code ?? null,
    itemName: item?.item_name ?? null,
    gramsPerPiece: item?.grams_per_piece ?? null,
    totalPricePerPiece: item?.total_price_per_piece ?? null,
    isUniqueItem: isUnique,
    quantityTotal: item?.quantity_total ?? 0,
    quantity,
    evidenceCount: evidenceData?.length ?? 0,
    minerPosition,
    minerAssignedAt: (minerData?.assigned_at as string | undefined) ?? null,
    waitlistStatus: (waitData?.status as string | undefined) ?? null,
    availableQuantity,
    reservationImpact: quantity,
    warnings,
  };
}

async function legacyListClaimReviewQueue(supabase: FakeClient, limit = 50) {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('status', 'pending_claim')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return Promise.all((data as Row[]).map((row) => legacyHydrate(supabase, row)));
}

async function legacyGetClaimForReview(supabase: FakeClient, claimId: string) {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('id', claimId)
    .maybeSingle();
  if (error || !data) return null;
  return legacyHydrate(supabase, data as Row);
}

type LegacyItem = {
  item_name: string | null;
  item_code: string | null;
  total_price_per_piece: number | null;
};

async function legacyDraftLineItems(supabase: FakeClient, claimIds: string[]) {
  if (claimIds.length === 0) return [];
  const { data } = await supabase.from('claims').select('*').in('id', claimIds);
  if (!data) return [];
  return (data as Row[]).map((r) => {
    const item = one<LegacyItem>(r.inventory_items);
    const unitPrice = item?.total_price_per_piece ?? 0;
    return {
      claimId: r.id as string,
      claimReference: r.claim_reference as string,
      itemName: item?.item_name ?? null,
      itemCode: item?.item_code ?? null,
      quantity: r.quantity as number,
      unitPrice,
      lineTotal: unitPrice * (r.quantity as number),
    };
  });
}

async function legacyListInvoiceDrafts(supabase: FakeClient) {
  const { data, error } = await supabase
    .from('invoice_drafts')
    .select('*')
    .in('status', ['draft', 'in_review', 'sent'])
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return Promise.all(
    (data as Row[]).map(async (r) => {
      const links =
        (r.invoice_draft_claims as Array<{ claim_id: string; is_active: boolean }>) ?? [];
      const active = links.filter((l) => l.is_active);
      const order = one<{
        order_number: string;
        invoice_number: string;
        hold_expires_at: string;
      }>(r.official_orders);
      const lineItems = await legacyDraftLineItems(
        supabase,
        active.map((l) => l.claim_id),
      );
      return {
        id: r.id as string,
        status: r.status as string,
        customerDisplayName:
          one<{ display_name: string }>(r.customers)?.display_name ?? 'Unknown',
        paymentArrangement: (r.payment_arrangement as string | null) ?? null,
        fulfillmentArrangement: (r.fulfillment_arrangement as string | null) ?? null,
        claimCount: lineItems.length,
        totalAmount: lineItems.reduce((sum, li) => sum + li.lineTotal, 0),
        claims: lineItems,
        orderNumber: order?.order_number ?? null,
        invoiceNumber: order?.invoice_number ?? null,
        holdExpiresAt: order?.hold_expires_at ?? null,
      };
    }),
  );
}

async function legacyComputeEligibility(supabase: FakeClient) {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('status', 'confirmed_claim')
    .limit(500);
  if (error || !data) return { groups: [], excluded: [] };
  const claims = data as Row[];
  const excluded: Array<{ claimReference: string; reason: string }> = [];
  const groups = new Map<
    string,
    {
      customerId: string;
      customerDisplayName: string;
      paymentArrangement: string | null;
      fulfillmentArrangement: string | null;
      claimIds: string[];
      claimReferences: string[];
      totalAmount: number;
    }
  >();

  const [inDraft, inOrder, reserved] = await Promise.all([
    supabase.from('invoice_draft_claims').select('claim_id').eq('is_active', true),
    supabase.from('official_order_claims').select('claim_id'),
    supabase
      .from('inventory_reservations')
      .select('claim_id, state')
      .in('state', ['provisional', 'committed']),
  ]);
  const ids = (res: Result) =>
    new Set(((res.data as Row[]) ?? []).map((r) => r.claim_id));
  const draftedIds = ids(inDraft);
  const orderedIds = ids(inOrder);
  const reservedIds = ids(reserved);

  for (const claim of claims) {
    const ref = claim.claim_reference as string;
    if (draftedIds.has(claim.id)) {
      excluded.push({
        claimReference: ref,
        reason: 'Already in another active Invoice Draft.',
      });
      continue;
    }
    if (orderedIds.has(claim.id)) {
      excluded.push({
        claimReference: ref,
        reason: 'Already committed to an Official Order.',
      });
      continue;
    }
    if (!reservedIds.has(claim.id)) {
      excluded.push({
        claimReference: ref,
        reason: 'Holds no active reservation. It cannot be invoiced.',
      });
      continue;
    }
    if (!claim.payment_arrangement || !claim.fulfillment_arrangement) {
      excluded.push({
        claimReference: ref,
        reason:
          'Payment or fulfillment arrangement is not set. Grouping requires both; set them in Claim Review.',
      });
      continue;
    }
    const key = `${claim.customer_id as string}|${claim.payment_arrangement as string}|${claim.fulfillment_arrangement as string}`;
    const price =
      one<{ total_price_per_piece: number | null }>(claim.inventory_items)
        ?.total_price_per_piece ?? 0;
    const quantity = claim.quantity as number;
    const existing = groups.get(key);
    if (existing) {
      existing.claimIds.push(claim.id as string);
      existing.claimReferences.push(ref);
      existing.totalAmount += price * quantity;
    } else {
      groups.set(key, {
        customerId: claim.customer_id as string,
        customerDisplayName:
          one<{ display_name: string }>(claim.customers)?.display_name ?? 'Unknown',
        paymentArrangement: claim.payment_arrangement as string,
        fulfillmentArrangement: claim.fulfillment_arrangement as string,
        claimIds: [claim.id as string],
        claimReferences: [ref],
        totalAmount: price * quantity,
      });
    }
  }
  return { groups: [...groups.values()], excluded };
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeds
// ─────────────────────────────────────────────────────────────────────────────

/** Pending claims that exercise every hydrate branch: shared customers and items,
 *  object/array/null embeds, facebook vs nickname aliases (incl. a customer with two
 *  facebook aliases and one with none), miner 1/2/none, waitlisted, 0–2 evidence
 *  rows, and available stock that is plenty / short / null (RPC could not compute). */
function seedReview(n: number, evidenceFor: (i: number) => number = (i) => i % 3): Db {
  const claims: Row[] = [];
  const aliases: Row[] = [];
  const miners: Row[] = [];
  const waits: Row[] = [];
  const evidence: Row[] = [];
  const customerCount = Math.max(1, Math.ceil(n / 3));
  const availableByItem = [5, 0, 1, null, 3, 2, 10];

  for (let c = 0; c < customerCount; c++) {
    const cid = `cust-${pad(c)}`;
    const nickname = {
      id: `al-${c}-n`,
      customer_id: cid,
      alias: `Nick ${c}`,
      alias_kind: 'nickname',
    };
    if (c % 2 === 0) aliases.push(nickname); // a non-facebook alias sorts FIRST for some
    if (c % 4 !== 3) {
      aliases.push({
        id: `al-${c}-a`,
        customer_id: cid,
        alias: `FB ${c}`,
        alias_kind: 'facebook_name',
      });
    }
    if (c % 4 === 1) {
      aliases.push({
        id: `al-${c}-b`,
        customer_id: cid,
        alias: `FB2 ${c}`,
        alias_kind: 'facebook_name',
      });
    }
    if (c % 2 === 1) aliases.push(nickname);
  }

  for (let i = 0; i < n; i++) {
    const id = `claim-${pad(i)}`;
    const k = i % 7;
    claims.push({
      id,
      claim_reference: `CL-${i}`,
      status: 'pending_claim',
      quantity: 1 + (i % 3),
      capture_method: i % 2 ? 'screenshot' : null,
      intake_kind: 'live',
      created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
      captured_against_flex_item: i % 2 === 0,
      live_batch_id: i % 3 ? `batch-${i % 3}` : null,
      customer_id: `cust-${pad(i % customerCount)}`,
      inventory_item_id: `item-${k}`,
      live_batches:
        i % 3 ? [{ batch_reference: `LB-${i % 3}`, title: `Live ${i % 3}` }] : null,
      customers: i % 6 === 5 ? null : { display_name: `Customer ${i % customerCount}` },
      inventory_items:
        i % 5 === 4
          ? null
          : {
              item_code: `AV-${k}`,
              item_name: k % 2 ? `Ring ${k}` : null,
              grams_per_piece: k ? k + 0.5 : null,
              total_price_per_piece: k ? 1000 * k : null,
              is_unique_item: k % 2 === 0,
              quantity_total: k,
            },
      staff_profiles: i % 4 ? { full_name: 'Staff A' } : null,
    });
    if (i % 4 === 0) {
      miners.push({
        id: `mp-${i}`,
        claim_id: id,
        position: 2,
        assigned_at: `2026-09-01T0${i % 9}:00:00Z`,
      });
    } else if (i % 4 === 1) {
      miners.push({
        id: `mp-${i}`,
        claim_id: id,
        position: 1,
        assigned_at: `2026-09-02T0${i % 9}:00:00Z`,
      });
    }
    if (i % 5 === 0) waits.push({ id: `wl-${i}`, claim_id: id, status: 'waitlisted' });
    for (let e = 0; e < evidenceFor(i); e++)
      evidence.push({ id: `ev-${id}-${pad(e)}`, claim_id: id });
  }

  // Rows that must NOT leak into any claim.
  claims.push({ ...claims[0], id: 'claim-confirmed', status: 'confirmed_claim' });
  miners.push({
    id: 'mp-x',
    claim_id: 'claim-other',
    position: 2,
    assigned_at: '2026-01-01',
  });
  waits.push({ id: 'wl-x', claim_id: 'claim-other', status: 'excess' });
  evidence.push({ id: 'ev-x', claim_id: 'claim-other' });

  const available: Record<string, number | null> = {};
  availableByItem.forEach((q, k) => (available[`item-${k}`] = q));

  return {
    tables: {
      claims,
      customer_aliases: aliases,
      miner_positions: miners,
      waitlist_entries: waits,
      claim_evidence: evidence,
    },
    available,
  };
}

/** Drafts with active + inactive links, a draft with no active claim, a duplicated
 *  active link, null/zero-price items, and object/array/null order embeds. */
function seedDrafts(n: number, perDraft = 3): Db {
  const drafts: Row[] = [];
  const claims: Row[] = [];
  for (let d = 0; d < n; d++) {
    const ids = Array.from({ length: perDraft }, (_, k) => `dc-${pad(d)}-${pad(k)}`);
    let links = ids.map((claim_id, k) => ({
      claim_id,
      is_active: k !== perDraft - 1 || perDraft > 3,
    }));
    if (perDraft === 3 && d % 5 === 2)
      links = links.map((l) => ({ ...l, is_active: false }));
    if (perDraft === 3 && d % 7 === 3)
      links.push({ claim_id: ids[0] as string, is_active: true });
    ids.forEach((id, k) =>
      claims.push({
        id,
        claim_reference: `DR-${d}-${k}`,
        quantity: 1 + k,
        inventory_items:
          k === 2
            ? null
            : [
                {
                  item_name: `Chain ${d}`,
                  item_code: `C${d}-${k}`,
                  total_price_per_piece: k === 1 ? null : 1500 + d,
                },
              ],
      }),
    );
    const orderRow = {
      order_number: `O-${d}`,
      invoice_number: `I-${d}`,
      hold_expires_at: '2026-09-20',
    };
    drafts.push({
      id: `draft-${pad(d)}`,
      status: ['draft', 'in_review', 'sent'][d % 3],
      created_at: new Date(Date.UTC(2026, 8, 1, 0, 0, d)).toISOString(),
      payment_arrangement: d % 2 ? 'full' : null,
      fulfillment_arrangement: d % 3 ? 'pickup' : null,
      customers: d % 4 === 0 ? null : { display_name: `Buyer ${d}` },
      invoice_draft_claims: links,
      official_orders: d % 3 === 2 ? [orderRow] : d % 3 === 1 ? orderRow : null,
    });
  }
  drafts.push({ ...drafts[0], id: 'draft-dissolved', status: 'dissolved' });
  return { tables: { invoice_drafts: drafts, claims } };
}

/** Candidates for every eligibility outcome. `noise` rows for OTHER claims are
 *  inserted first so they fill any unscoped, capped page. */
function seedEligibility(n: number, noise = 0): Db {
  const claims: Row[] = [];
  const draftLinks: Row[] = [];
  const orderLinks: Row[] = [];
  const reservations: Row[] = [];
  for (let k = 0; k < noise; k++) {
    draftLinks.push({ claim_id: `old-${k}`, is_active: true });
    orderLinks.push({ claim_id: `old-${k}` });
    reservations.push({ claim_id: `old-${k}`, state: 'committed' });
  }
  for (let i = 0; i < n; i++) {
    const id = `cand-${pad(i)}`;
    const kind = i % 6;
    claims.push({
      id,
      claim_reference: `CR-${i}`,
      status: 'confirmed_claim',
      quantity: 1 + (i % 2),
      customer_id: `cust-${i % 4}`,
      payment_arrangement: kind === 4 ? null : i % 2 ? 'full' : 'layaway',
      fulfillment_arrangement: kind === 5 ? null : 'pickup',
      customers: i % 4 === 3 ? null : [{ display_name: `Cust ${i % 4}` }],
      inventory_items: i % 7 === 6 ? null : { total_price_per_piece: 250 * (i % 5) },
    });
    if (kind === 1) draftLinks.push({ claim_id: id, is_active: true });
    if (kind === 2) orderLinks.push({ claim_id: id });
    reservations.push({
      claim_id: id,
      state: kind === 3 ? 'released' : i % 2 ? 'provisional' : 'committed',
    });
  }
  if (n > 0) draftLinks.push({ claim_id: `cand-${pad(0)}`, is_active: false }); // inactive: no exclusion
  claims.push({ id: 'cand-pending', claim_reference: 'CR-P', status: 'pending_claim' });
  return {
    tables: {
      claims,
      invoice_draft_claims: draftLinks,
      official_order_claims: orderLinks,
      inventory_reservations: reservations,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Claim Review
// ─────────────────────────────────────────────────────────────────────────────

describe('listClaimReviewQueue — batched hydrate', () => {
  it('runs 6 requests for 1 claim AND for 20 claims (legacy: 1 + 5 per claim)', async () => {
    const counts: Record<number, { now: number; before: number }> = {};
    for (const n of [1, 20]) {
      const db = seedReview(n);
      const { calls } = installFake(db);
      expect(await listClaimReviewQueue()).toHaveLength(n);
      const now = calls.length;

      const legacy = installFake(db);
      await legacyListClaimReviewQueue(legacy.client);
      counts[n] = { now, before: legacy.calls.length };
    }
    expect(counts).toEqual({ 1: { now: 6, before: 6 }, 20: { now: 6, before: 101 } });
  });

  it('uses ONE available_quantities_for batch RPC, never per-claim available_quantity_for', async () => {
    const { calls } = installFake(seedReview(20));
    await listClaimReviewQueue();
    expect(calls.map((c) => `${c.kind}:${c.name}`).sort()).toEqual(
      [
        'from:claims',
        'from:claim_evidence',
        'from:customer_aliases',
        'from:miner_positions',
        'from:waitlist_entries',
        'rpc:available_quantities_for',
      ].sort(),
    );
  });

  it.each([1, 20, 37])(
    'hydrated rows are identical to the legacy per-claim reader (N=%i)',
    async (n) => {
      const db = seedReview(n);
      installFake(db);
      const now = await listClaimReviewQueue();
      const before = await legacyListClaimReviewQueue(installFake(db).client);
      expect(now).toStrictEqual(before);
    },
  );

  it('the seed really exercises every branch (so the equality check means something)', async () => {
    installFake(seedReview(20));
    const rows = await listClaimReviewQueue();
    const messages = new Set(
      rows.flatMap((r) => r.warnings.map((w) => w.message.slice(0, 20))),
    );
    expect(messages.size).toBe(4);
    expect(new Set(rows.map((r) => r.customerFacebookName === null))).toEqual(
      new Set([true, false]),
    );
    expect(new Set(rows.map((r) => r.evidenceCount))).toEqual(new Set([0, 1, 2]));
    expect(new Set(rows.map((r) => r.minerPosition))).toEqual(new Set([1, 2, null]));
    expect(rows.some((r) => r.waitlistStatus === 'waitlisted')).toBe(true);
    // item-3's stock RPC yields null → reads as 0 (and blocks), as before.
    const item3 = rows.filter((r) => r.inventoryItemId === 'item-3');
    expect(item3.length).toBeGreaterThan(0);
    expect(item3.every((r) => r.availableQuantity === 0)).toBe(true);
    expect(rows.some((r) => r.availableQuantity > 0)).toBe(true);
  });

  it('chunks every .in() list at ≤300 ids and still matches legacy for 650 claims', async () => {
    const db = seedReview(650);
    const { calls } = installFake(db);
    const now = await listClaimReviewQueue(650);
    expect(now).toHaveLength(650);
    expect(Math.max(...calls.flatMap((c) => c.inSizes))).toBeLessThanOrEqual(300);
    // 1 claims + 1 aliases (217 customers) + 3×(miner, waitlist, evidence) + 1 RPC
    expect(calls).toHaveLength(12);
    expect(now).toStrictEqual(
      await legacyListClaimReviewQueue(installFake(db).client, 650),
    );
  });

  it('counts evidence exactly even past the 1,000-row response cap (pages the chunk)', async () => {
    const { calls } = installFake(seedReview(2, (i) => (i === 0 ? 1500 : 3)));
    const rows = await listClaimReviewQueue();
    expect(rows.map((r) => r.evidenceCount)).toEqual([1500, 3]);
    expect(calls.filter((c) => c.name === 'claim_evidence')).toHaveLength(2);
  });

  it('mirrors maybeSingle(): a claim with two miner rows reads as no miner, like before', async () => {
    const db = seedReview(4);
    db.tables.miner_positions?.push({
      id: 'mp-dup',
      claim_id: 'claim-0000',
      position: 1,
      assigned_at: 'x',
    });
    installFake(db);
    const now = await listClaimReviewQueue();
    expect(now[0]?.minerPosition).toBeNull();
    expect(now).toStrictEqual(await legacyListClaimReviewQueue(installFake(db).client));
  });

  it('empty queue → only the claims read', async () => {
    const { calls } = installFake({ tables: { claims: [] } });
    expect(await listClaimReviewQueue()).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});

describe('getClaimForReview — same batched path for one claim', () => {
  it('returns the same object as before, in the same 6 requests', async () => {
    const db = seedReview(20);
    for (const id of ['claim-0000', 'claim-0007', 'claim-0013']) {
      const { calls } = installFake(db);
      const now = await getClaimForReview(id);
      expect(calls).toHaveLength(6);
      const legacy = installFake(db);
      expect(now).toStrictEqual(await legacyGetClaimForReview(legacy.client, id));
      expect(legacy.calls).toHaveLength(6);
    }
  });

  it('unknown claim → null', async () => {
    installFake(seedReview(3));
    expect(await getClaimForReview('nope')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Drafts
// ─────────────────────────────────────────────────────────────────────────────

describe('listInvoiceDrafts — one line-item read for every draft', () => {
  it('runs 2 requests for 1 draft AND for 20 drafts (legacy: 1 + one per draft)', async () => {
    const counts: Record<number, { now: number; before: number }> = {};
    for (const n of [1, 20]) {
      const db = seedDrafts(n);
      const { calls } = installFake(db);
      expect(await listInvoiceDrafts()).toHaveLength(n);
      const legacy = installFake(db);
      await legacyListInvoiceDrafts(legacy.client);
      counts[n] = { now: calls.length, before: legacy.calls.length };
    }
    // 20 drafts: 3 have no active claim (legacy skipped their read) → 1 + 17.
    // (Draft 17 is all-inactive AND gets the duplicate active link, so it reads.)
    expect(counts).toEqual({ 1: { now: 2, before: 2 }, 20: { now: 2, before: 18 } });
  });

  it.each([1, 20])(
    'summaries are identical to the legacy per-draft reader (N=%i)',
    async (n) => {
      const db = seedDrafts(n);
      installFake(db);
      const now = await listInvoiceDrafts();
      expect(now).toStrictEqual(await legacyListInvoiceDrafts(installFake(db).client));
    },
  );

  it('the seed covers empty drafts, duplicate links and null prices', async () => {
    installFake(seedDrafts(20));
    const drafts = await listInvoiceDrafts();
    expect(drafts.some((d) => d.claimCount === 0 && d.totalAmount === 0)).toBe(true);
    expect(drafts.find((d) => d.id === 'draft-0003')?.claimCount).toBe(2); // dup link → 1 line
    expect(drafts.flatMap((d) => d.claims).some((li) => li.unitPrice === 0)).toBe(true);
  });

  it('400 active claims across 40 drafts → 2 chunked claim reads (≤300 ids), same result', async () => {
    const db = seedDrafts(40, 10);
    const { calls } = installFake(db);
    const now = await listInvoiceDrafts();
    expect(calls).toHaveLength(3);
    expect(calls.filter((c) => c.name === 'claims').map((c) => c.inSizes[0])).toEqual([
      300, 100,
    ]);
    expect(now).toStrictEqual(await legacyListInvoiceDrafts(installFake(db).client));
  });

  it('no active claim anywhere → only the drafts read', async () => {
    const db = seedDrafts(1);
    (db.tables.invoice_drafts?.[0]?.invoice_draft_claims as Row[]).forEach(
      (l) => (l.is_active = false),
    );
    const { calls } = installFake(db);
    const [draft] = await listInvoiceDrafts();
    expect(calls).toHaveLength(1);
    expect(draft).toMatchObject({ claimCount: 0, totalAmount: 0, claims: [] });
  });
});

describe('computeEligibility — exclusion reads scoped to the candidate claims', () => {
  it('matches the legacy reader on a normal store, with every exclusion reason', async () => {
    const db = seedEligibility(24);
    const { calls } = installFake(db);
    const now = await computeEligibility();
    expect(calls).toHaveLength(4);
    expect(now).toStrictEqual(await legacyComputeEligibility(installFake(db).client));
    expect(new Set(now.excluded.map((e) => e.reason)).size).toBe(4);
    expect(now.groups.length).toBeGreaterThan(1);
  });

  it('a claim that WAS ordered stays excluded past the 1,000-row cap (legacy let it through)', async () => {
    const cand = (id: string) => ({
      id,
      claim_reference: `REF-${id}`,
      status: 'confirmed_claim',
      quantity: 1,
      customer_id: 'cust-1',
      payment_arrangement: 'full',
      fulfillment_arrangement: 'pickup',
      customers: { display_name: 'Big Store Buyer' },
      inventory_items: { total_price_per_piece: 100 },
    });
    const noise = (n: number, extra: Row = {}) =>
      Array.from({ length: n }, (_, k) => ({ claim_id: `old-${k}`, ...extra }));
    const db: Db = {
      tables: {
        claims: [cand('X'), cand('Y'), cand('Z')],
        official_order_claims: [...noise(1200), { claim_id: 'X' }],
        invoice_draft_claims: [
          ...noise(1200, { is_active: true }),
          { claim_id: 'Z', is_active: true },
        ],
        inventory_reservations: [
          { claim_id: 'X', state: 'committed' },
          { claim_id: 'Z', state: 'provisional' },
          ...noise(1200, { state: 'committed' }),
          { claim_id: 'Y', state: 'provisional' },
        ],
      },
    };

    const before = await legacyComputeEligibility(installFake(db).client);
    expect(before.groups.flatMap((g) => g.claimIds)).toEqual(['X', 'Z']); // WRONG: both
    expect(before.excluded).toEqual([
      {
        claimReference: 'REF-Y',
        reason: 'Holds no active reservation. It cannot be invoiced.',
      },
    ]); // WRONG: Y is reserved

    installFake(db);
    const now = await computeEligibility();
    expect(now.excluded).toEqual([
      { claimReference: 'REF-X', reason: 'Already committed to an Official Order.' },
      { claimReference: 'REF-Z', reason: 'Already in another active Invoice Draft.' },
    ]);
    expect(now.groups.flatMap((g) => g.claimIds)).toEqual(['Y']);
  });

  it('500 candidates → each scoped read split into 2 chunks of ≤300 ids, same result', async () => {
    const db = seedEligibility(500);
    const { calls } = installFake(db);
    const now = await computeEligibility();
    expect(calls).toHaveLength(7);
    const claimIdChunks = calls
      .filter((c) => c.name !== 'claims')
      .flatMap((c) => c.inSizes);
    expect(claimIdChunks.filter((s) => s !== 2).sort()).toEqual([
      200, 200, 200, 300, 300, 300,
    ]);
    expect(now).toStrictEqual(await legacyComputeEligibility(installFake(db).client));
  });

  it('no candidates → only the claims read', async () => {
    const { calls } = installFake(seedEligibility(0));
    expect(await computeEligibility()).toEqual({ groups: [], excluded: [] });
    expect(calls).toHaveLength(1);
  });
});
