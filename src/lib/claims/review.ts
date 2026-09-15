import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Claim Review (Bible §6.4, §12, §22.6).
 *
 * Claim Review is MANDATORY: a Pending Claim becomes a Confirmed Claim only
 * through a human decision here. There is deliberately no "approve all", no
 * auto-approve, and no rule that promotes a claim on a timer — confirmation is
 * always somebody's attributed act.
 *
 * This module READS. It decides nothing. Every warning it produces is advisory:
 * the authority to confirm is checked server-side at execution time, and the
 * database re-checks availability underneath that.
 */

export type ClaimReviewWarning = {
  severity: 'blocking' | 'advisory';
  message: string;
};

export type ClaimReviewRow = {
  claimId: string;
  claimReference: string;
  status: string;

  captureMethod: string | null;
  intakeKind: string;
  capturedAt: string;
  capturedByName: string | null;
  capturedAgainstFlexItem: boolean;

  liveBatchId: string | null;
  liveBatchReference: string | null;
  liveBatchTitle: string | null;

  customerId: string;
  customerDisplayName: string;
  customerFacebookName: string | null;

  inventoryItemId: string;
  itemCode: string | null;
  itemName: string | null;
  gramsPerPiece: number | null;
  totalPricePerPiece: number | null;
  isUniqueItem: boolean;
  quantityTotal: number;

  quantity: number;
  evidenceCount: number;

  minerPosition: number | null;
  minerAssignedAt: string | null;
  waitlistStatus: string | null;

  availableQuantity: number;
  /** What confirming WOULD do. Nothing is reserved until someone confirms. */
  reservationImpact: number;

  warnings: ClaimReviewWarning[];
};

/**
 * Loads the Claim Review queue: Pending Claims awaiting a human decision.
 *
 * RLS narrows this to what the caller may see; the query does not re-implement
 * that filter.
 */
export async function listClaimReviewQueue(limit = 50): Promise<ClaimReviewRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('claims')
    .select(
      `id, claim_reference, status, quantity, capture_method, intake_kind,
       created_at, captured_against_flex_item, live_batch_id, customer_id,
       inventory_item_id,
       live_batches ( batch_reference, title ),
       customers ( display_name ),
       inventory_items ( item_code, item_name, grams_per_piece,
                         total_price_per_piece, is_unique_item, quantity_total ),
       staff_profiles!claims_created_by_fkey ( full_name )`,
    )
    .eq('status', 'pending_claim')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error || !data) return [];

  return hydrateAll(supabase, data);
}

/** Loads one claim for the review detail screen. */
export async function getClaimForReview(claimId: string): Promise<ClaimReviewRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('claims')
    .select(
      `id, claim_reference, status, quantity, capture_method, intake_kind,
       created_at, captured_against_flex_item, live_batch_id, customer_id,
       inventory_item_id,
       live_batches ( batch_reference, title ),
       customers ( display_name ),
       inventory_items ( item_code, item_name, grams_per_piece,
                         total_price_per_piece, is_unique_item, quantity_total ),
       staff_profiles!claims_created_by_fkey ( full_name )`,
    )
    .eq('id', claimId)
    .maybeSingle();

  if (error || !data) return null;

  const [row] = await hydrateAll(supabase, [data]);
  return row ?? null;
}

function one<T>(value: unknown): T | null {
  // PostgREST returns an embedded relation as an object or a single-element
  // array depending on the shape of the relationship.
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

type Client = Awaited<ReturnType<typeof createClient>>;
type Row = Record<string, unknown>;

/**
 * Most ids per `.in()` filter. The ids travel in the request URL, so a long list
 * is split into several requests. At ≤300 ids the URL stays short.
 */
const IN_CHUNK = 300;

/** The page size requested while counting evidence. When the server's cap is
 *  lower, the loop below still reaches the exact count. */
const EVIDENCE_PAGE = 1000;

function chunked<T>(values: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function distinctIds(values: unknown[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string'))];
}

/** Runs `query` once per id chunk and returns every row, in response order.
 *  A chunk that errors adds no rows, the same as the old per-claim reads that
 *  treated an error as "nothing found". */
async function rowsForIds(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<{ data: unknown[] | null }>,
): Promise<Row[]> {
  const pages = await Promise.all(chunked(ids).map((chunk) => query(chunk)));
  return pages.flatMap((page) => (page.data ?? []) as Row[]);
}

/**
 * One row per claim, with `.maybeSingle()` semantics: a claim with two rows maps
 * to null, just as maybeSingle() errored and left `data` null. miner_positions
 * and waitlist_entries are UNIQUE(claim_id), so in practice this never happens.
 */
function singleByClaim(rows: Row[]): Map<string, Row | null> {
  const out = new Map<string, Row | null>();
  for (const r of rows) {
    const id = r.claim_id as string;
    out.set(id, out.has(id) ? null : r);
  }
  return out;
}

/**
 * Evidence rows per claim, counted exactly. Evidence is the one table here with
 * no bound on rows per claim, so each chunk pages (stable order by id) until it
 * has read the `count` PostgREST reports. The usual case is one request per
 * chunk, and a 1,000-row response cap can never under-count.
 */
async function evidenceCounts(
  supabase: Client,
  claimIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    chunked(claimIds).map(async (ids) => {
      for (let from = 0; ;) {
        const { data, count, error } = await supabase
          .from('claim_evidence')
          .select('claim_id', { count: 'exact' })
          .in('claim_id', ids)
          .order('id', { ascending: true })
          .range(from, from + EVIDENCE_PAGE - 1);
        if (error || !data || data.length === 0) return;
        for (const r of data as Row[]) {
          const id = r.claim_id as string;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        from += data.length;
        if (typeof count !== 'number' || from >= count) return;
      }
    }),
  );
  return counts;
}

/**
 * Hydrates every claim with a FIXED number of reads, whatever the claim count:
 * one query each for aliases, miner positions, waitlist entries and evidence
 * (chunked by id), plus one batch stock RPC. The old path ran five reads PER
 * claim, including one available_quantity_for() RPC each.
 */
async function hydrateAll(supabase: Client, rows: Row[]): Promise<ClaimReviewRow[]> {
  if (rows.length === 0) return [];

  const claimIds = distinctIds(rows.map((r) => r.id));
  const customerIds = distinctIds(rows.map((r) => r.customer_id));
  const itemIds = distinctIds(rows.map((r) => r.inventory_item_id));

  const [aliasRows, minerRows, waitRows, evidence, availableRes] = await Promise.all([
    rowsForIds(customerIds, (ids) =>
      supabase
        .from('customer_aliases')
        .select('customer_id, alias')
        .eq('alias_kind', 'facebook_name')
        .in('customer_id', ids),
    ),
    rowsForIds(claimIds, (ids) =>
      supabase
        .from('miner_positions')
        .select('claim_id, position, assigned_at')
        .in('claim_id', ids),
    ),
    rowsForIds(claimIds, (ids) =>
      supabase.from('waitlist_entries').select('claim_id, status').in('claim_id', ids),
    ),
    evidenceCounts(supabase, claimIds),
    // Same computation as available_quantity_for() (it calls the same
    // app_private.available_quantity), one round-trip for every item.
    itemIds.length > 0
      ? supabase.rpc('available_quantities_for', { p_item_ids: itemIds })
      : Promise.resolve({ data: [] as unknown }),
  ]);

  // First facebook_name alias per customer in response order. That is the row
  // the old `.limit(1)` read returned.
  const aliasByCustomer = new Map<string, string>();
  for (const a of aliasRows) {
    const id = a.customer_id as string;
    if (!aliasByCustomer.has(id)) aliasByCustomer.set(id, a.alias as string);
  }

  const minerByClaim = singleByClaim(minerRows);
  const waitByClaim = singleByClaim(waitRows);

  // An item whose quantity could not be computed comes back null, or not at
  // all. Either way it reads as 0, as a failed per-item RPC did.
  const availableByItem = new Map<string, number>();
  if (Array.isArray(availableRes.data)) {
    for (const a of availableRes.data as Array<{
      item_id: unknown;
      available_quantity: unknown;
    }>) {
      if (typeof a?.item_id === 'string' && typeof a.available_quantity === 'number') {
        availableByItem.set(a.item_id, a.available_quantity);
      }
    }
  }

  return rows.map((row) =>
    buildRow(row, {
      facebookName: aliasByCustomer.get(row.customer_id as string) ?? null,
      miner: minerByClaim.get(row.id as string) ?? null,
      wait: waitByClaim.get(row.id as string) ?? null,
      evidenceCount: evidence.get(row.id as string) ?? 0,
      availableQuantity: availableByItem.get(row.inventory_item_id as string) ?? 0,
    }),
  );
}

function buildRow(
  row: Row,
  related: {
    facebookName: string | null;
    miner: Row | null;
    wait: Row | null;
    evidenceCount: number;
    availableQuantity: number;
  },
): ClaimReviewRow {
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

  const { availableQuantity, evidenceCount, miner, wait } = related;
  const isUnique = item?.is_unique_item ?? true;
  const minerPosition = (miner?.position as number | undefined) ?? null;

  const warnings: ClaimReviewWarning[] = [];

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

  if (wait) {
    warnings.push({
      severity: 'advisory',
      message:
        'This claim is waitlisted. There is no automatic allocation or promotion — resolving it is a manual, attributed decision.',
    });
  }

  if (evidenceCount === 0) {
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
    customerFacebookName: related.facebookName,

    inventoryItemId: itemId,
    itemCode: item?.item_code ?? null,
    itemName: item?.item_name ?? null,
    gramsPerPiece: item?.grams_per_piece ?? null,
    totalPricePerPiece: item?.total_price_per_piece ?? null,
    isUniqueItem: isUnique,
    quantityTotal: item?.quantity_total ?? 0,

    quantity,
    evidenceCount,

    minerPosition,
    minerAssignedAt: (miner?.assigned_at as string | undefined) ?? null,
    waitlistStatus: (wait?.status as string | undefined) ?? null,

    availableQuantity,
    reservationImpact: quantity,

    warnings,
  };
}
