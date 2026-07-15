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

  return Promise.all(data.map((row) => hydrate(row as Record<string, unknown>)));
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

  return hydrate(data);
}

function one<T>(value: unknown): T | null {
  // PostgREST returns an embedded relation as an object or a single-element
  // array depending on the shape of the relationship.
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

async function hydrate(row: Record<string, unknown>): Promise<ClaimReviewRow> {
  const supabase = await createClient();

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

  const availableQuantity = typeof availableRes.data === 'number' ? availableRes.data : 0;
  const isUnique = item?.is_unique_item ?? true;
  const minerPosition = (minerRes.data?.position as number | undefined) ?? null;

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

  if (waitRes.data) {
    warnings.push({
      severity: 'advisory',
      message:
        'This claim is waitlisted. There is no automatic allocation or promotion — resolving it is a manual, attributed decision.',
    });
  }

  if ((evidenceRes.data?.length ?? 0) === 0) {
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
    customerFacebookName: (aliasRes.data?.[0]?.alias as string | undefined) ?? null,

    inventoryItemId: itemId,
    itemCode: item?.item_code ?? null,
    itemName: item?.item_name ?? null,
    gramsPerPiece: item?.grams_per_piece ?? null,
    totalPricePerPiece: item?.total_price_per_piece ?? null,
    isUniqueItem: isUnique,
    quantityTotal: item?.quantity_total ?? 0,

    quantity,
    evidenceCount: evidenceRes.data?.length ?? 0,

    minerPosition,
    minerAssignedAt: (minerRes.data?.assigned_at as string | undefined) ?? null,
    waitlistStatus: (waitRes.data?.status as string | undefined) ?? null,

    availableQuantity,
    reservationImpact: quantity,

    warnings,
  };
}
