import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Invoice Drafts and eligibility (Bible §11.17, §15, §22.8).
 *
 * AN INVOICE DRAFT IS NOT AN OFFICIAL ORDER. Nothing here creates an order,
 * sends a message, or touches inventory: the claims already hold their
 * provisional reservations from Phase 4, and drafting them changes nothing
 * about stock.
 *
 * Eligibility is ALWAYS recomputed from stored data. Nothing trusts the UI for
 * customer identity, claim status, arrangements, price, quantity, totals, or
 * reservation state — every one of those is re-read here, and the database
 * re-checks the grouping rules underneath.
 */

export type ExcludedClaim = { claimReference: string; reason: string };

export type EligibleGroup = {
  customerId: string;
  customerDisplayName: string;
  paymentArrangement: string | null;
  fulfillmentArrangement: string | null;
  claimIds: string[];
  claimReferences: string[];
  totalAmount: number;
};

export type EligibilityReport = {
  groups: EligibleGroup[];
  excluded: ExcludedClaim[];
};

type ClaimRow = {
  id: string;
  claim_reference: string;
  status: string;
  quantity: number;
  customer_id: string;
  payment_arrangement: string | null;
  fulfillment_arrangement: string | null;
  customers: { display_name: string } | { display_name: string }[] | null;
  inventory_items:
    | { total_price_per_piece: number | null }
    | { total_price_per_piece: number | null }[]
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Most ids per `.in()` filter. The ids travel in the request URL, so a long list
 * is split into several requests. At ≤300 ids the URL stays short (~11 KB of
 * UUIDs). Each of these tables is UNIQUE per claim/id, so a 300-id chunk can
 * never reach PostgREST's 1,000-row response cap.
 */
const IN_CHUNK = 300;

function chunked<T>(values: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Runs `query` once per id chunk and returns every row, in response order.
 *  A chunk that errors adds no rows, the same as the old per-row reads that
 *  treated an error as "nothing found". */
async function rowsForIds(
  ids: string[],
  query: (chunk: string[]) => PromiseLike<{ data: unknown[] | null }>,
): Promise<Array<Record<string, unknown>>> {
  const pages = await Promise.all(chunked(ids).map((chunk) => query(chunk)));
  return pages.flatMap((page) => (page.data ?? []) as Array<Record<string, unknown>>);
}

/**
 * Computes eligibility and grouping from STORED state.
 *
 * Every exclusion carries a reason — nothing is silently dropped. A claim the
 * operator expected to see must be explainable, or they will assume the system
 * lost it.
 */
export async function computeEligibility(): Promise<EligibilityReport> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('claims')
    .select(
      `id, claim_reference, status, quantity, customer_id,
       payment_arrangement, fulfillment_arrangement,
       customers ( display_name ),
       inventory_items ( total_price_per_piece )`,
    )
    .eq('status', 'confirmed_claim')
    .limit(500);

  if (error || !data) return { groups: [], excluded: [] };

  const claims = data as unknown as ClaimRow[];
  const excluded: ExcludedClaim[] = [];
  const groups = new Map<string, EligibleGroup>();

  // Which claims already sit in an active draft, or already reached an order.
  //
  // Every read is scoped to THIS run's candidate claim ids. Unscoped, each read
  // pulled the whole table, and PostgREST caps a response at 1,000 rows. On a
  // large store an ordered claim could fall outside the capped page, and the
  // "already ordered" exclusion would silently let it through.
  const candidateIds = claims.map((c) => c.id);
  const [inDraft, inOrder, reserved] = await Promise.all([
    rowsForIds(candidateIds, (ids) =>
      supabase
        .from('invoice_draft_claims')
        .select('claim_id')
        .eq('is_active', true)
        .in('claim_id', ids),
    ),
    rowsForIds(candidateIds, (ids) =>
      supabase.from('official_order_claims').select('claim_id').in('claim_id', ids),
    ),
    rowsForIds(candidateIds, (ids) =>
      supabase
        .from('inventory_reservations')
        .select('claim_id, state')
        .in('state', ['provisional', 'committed'])
        .in('claim_id', ids),
    ),
  ]);

  const draftedIds = new Set(inDraft.map((r) => r.claim_id as string));
  const orderedIds = new Set(inOrder.map((r) => r.claim_id as string));
  const reservedIds = new Set(reserved.map((r) => r.claim_id as string));

  for (const claim of claims) {
    if (draftedIds.has(claim.id)) {
      excluded.push({
        claimReference: claim.claim_reference,
        reason: 'Already in another active Invoice Draft.',
      });
      continue;
    }

    if (orderedIds.has(claim.id)) {
      excluded.push({
        claimReference: claim.claim_reference,
        reason: 'Already committed to an Official Order.',
      });
      continue;
    }

    if (!reservedIds.has(claim.id)) {
      excluded.push({
        claimReference: claim.claim_reference,
        reason: 'Holds no active reservation. It cannot be invoiced.',
      });
      continue;
    }

    // Grouping needs both keys. A claim missing one cannot be grouped safely —
    // guessing an arrangement would silently invent a business term.
    if (!claim.payment_arrangement || !claim.fulfillment_arrangement) {
      excluded.push({
        claimReference: claim.claim_reference,
        reason:
          'Payment or fulfillment arrangement is not set. Grouping requires both; set them in Claim Review.',
      });
      continue;
    }

    const key = `${claim.customer_id}|${claim.payment_arrangement}|${claim.fulfillment_arrangement}`;
    const price = one(claim.inventory_items)?.total_price_per_piece ?? 0;

    const existing = groups.get(key);
    if (existing) {
      existing.claimIds.push(claim.id);
      existing.claimReferences.push(claim.claim_reference);
      existing.totalAmount += price * claim.quantity;
    } else {
      groups.set(key, {
        customerId: claim.customer_id,
        customerDisplayName: one(claim.customers)?.display_name ?? 'Unknown',
        paymentArrangement: claim.payment_arrangement,
        fulfillmentArrangement: claim.fulfillment_arrangement,
        claimIds: [claim.id],
        claimReferences: [claim.claim_reference],
        totalAmount: price * claim.quantity,
      });
    }
  }

  return { groups: [...groups.values()], excluded };
}

export type PrepareResult = {
  created: Array<{
    invoiceDraftId: string;
    customerDisplayName: string;
    claimCount: number;
  }>;
  skipped: Array<{ customerDisplayName: string; reason: string }>;
  excluded: ExcludedClaim[];
};

/**
 * Prepare All Eligible Invoices — the safe first step.
 *
 * Creates drafts. It does NOT create Official Orders, send messages, or change
 * inventory. Idempotent in the way that matters: a claim already sitting in an
 * active draft is excluded, so running twice cannot double-draft anything — the
 * partial unique index refuses even if this check were wrong.
 *
 * Each group is independent: one group failing never rolls back another.
 */
export async function prepareAllEligibleInvoices(): Promise<
  { ok: true; data: PrepareResult } | { ok: false; error: string }
> {
  let staff;
  try {
    staff = await requirePermission('invoice_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'invoice_draft.prepare_all',
        entityType: 'invoice_draft',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const { groups, excluded } = await computeEligibility();
  const supabase = await createClient();

  const created: PrepareResult['created'] = [];
  const skipped: PrepareResult['skipped'] = [];

  for (const group of groups) {
    const { data: draft, error: draftError } = await supabase
      .from('invoice_drafts')
      .insert({
        customer_id: group.customerId,
        status: 'draft',
        payment_arrangement: group.paymentArrangement,
        fulfillment_arrangement: group.fulfillmentArrangement,
        created_by: staff.staffProfileId,
      })
      .select('id')
      .single();

    if (draftError || !draft) {
      skipped.push({
        customerDisplayName: group.customerDisplayName,
        reason: 'The Invoice Draft could not be created.',
      });
      continue;
    }

    const draftId = draft.id as string;

    const { error: linkError } = await supabase.from('invoice_draft_claims').insert(
      group.claimIds.map((claimId) => ({
        invoice_draft_id: draftId,
        claim_id: claimId,
        added_by: staff.staffProfileId,
      })),
    );

    if (linkError) {
      // The draft exists but holds nothing. Dissolve it rather than leave an
      // empty draft that looks ready. Dissolving releases no inventory.
      await supabase
        .from('invoice_drafts')
        .update({
          status: 'dissolved',
          dissolved_at: new Date().toISOString(),
          dissolved_reason: 'Claims could not be grouped; draft left empty.',
        })
        .eq('id', draftId);

      skipped.push({
        customerDisplayName: group.customerDisplayName,
        reason: linkError.message,
      });
      continue;
    }

    created.push({
      invoiceDraftId: draftId,
      customerDisplayName: group.customerDisplayName,
      claimCount: group.claimIds.length,
    });

    await recordAuditEvent({
      action: 'invoice_draft.create',
      entityType: 'invoice_draft',
      entityId: draftId,
      context: {
        customer_id: group.customerId,
        claim_count: group.claimIds.length,
        payment_arrangement: group.paymentArrangement,
        fulfillment_arrangement: group.fulfillmentArrangement,
        official_order_created: false,
        message_sent: false,
      },
    });
  }

  await recordAuditEvent({
    action: 'invoice_draft.prepare_all',
    entityType: 'invoice_draft',
    context: {
      created: created.length,
      skipped: skipped.length,
      excluded: excluded.length,
    },
  });

  return { ok: true, data: { created, skipped, excluded } };
}

/** Removes a claim from a draft before approval. Releases no inventory. */
export async function removeClaimFromDraft(
  invoiceDraftId: string,
  claimId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('invoice_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'invoice_draft.remove_claim',
        entityType: 'invoice_draft',
        entityId: invoiceDraftId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: false, error: 'Removing a claim requires a reason.' };
  }

  const supabase = await createClient();

  // The draft must still be open. A sent draft is history.
  const { data: draft } = await supabase
    .from('invoice_drafts')
    .select('status')
    .eq('id', invoiceDraftId)
    .maybeSingle();

  if (!draft) return { ok: false, error: 'That Invoice Draft could not be found.' };

  if (!['draft', 'in_review'].includes(draft.status as string)) {
    return {
      ok: false,
      error: 'That Invoice Draft is no longer open. A sent invoice cannot be edited.',
    };
  }

  const { error } = await supabase
    .from('invoice_draft_claims')
    .update({
      is_active: false,
      removed_at: new Date().toISOString(),
      removed_reason: trimmed,
    })
    .eq('invoice_draft_id', invoiceDraftId)
    .eq('claim_id', claimId);

  if (error) return { ok: false, error: 'The claim could not be removed.' };

  await recordAuditEvent({
    action: 'invoice_draft.remove_claim',
    entityType: 'invoice_draft',
    entityId: invoiceDraftId,
    reason: trimmed,
    // Removal frees the claim for another draft. It does NOT unreserve it.
    context: { claim_id: claimId, reservation_released: false },
  });

  return { ok: true };
}

/** One line of an invoice draft — a claim and its item/price. Totals are read
 *  from stored claim/item data, never the client. */
export type DraftLineItem = {
  claimId: string;
  claimReference: string;
  itemName: string | null;
  itemCode: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type DraftSummary = {
  id: string;
  status: string;
  customerDisplayName: string;
  paymentArrangement: string | null;
  fulfillmentArrangement: string | null;
  claimCount: number;
  totalAmount: number;
  /** The draft's line items — for the printable invoice and the remove-claim edit. */
  claims: DraftLineItem[];
  orderNumber: string | null;
  invoiceNumber: string | null;
  holdExpiresAt: string | null;
};

/** Lists open drafts and their resulting orders for the Invoice workspace. */
export async function listInvoiceDrafts(): Promise<DraftSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('invoice_drafts')
    .select(
      `id, status, payment_arrangement, fulfillment_arrangement,
       customers ( display_name ),
       invoice_draft_claims ( claim_id, is_active ),
       official_orders ( order_number, invoice_number, hold_expires_at )`,
    )
    .in('status', ['draft', 'in_review', 'sent'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  const drafts = data.map((row) => {
    const r = row as Record<string, unknown>;
    const links =
      (r.invoice_draft_claims as Array<{ claim_id: string; is_active: boolean }>) ?? [];
    return { r, activeClaimIds: links.filter((l) => l.is_active).map((l) => l.claim_id) };
  });

  // Line items for EVERY draft in one read, grouped per draft below. This was one
  // claims query per draft, so the page cost grew with the number of drafts.
  const allLineItems = await lineItemsForClaims(supabase, [
    ...new Set(drafts.flatMap((d) => d.activeClaimIds)),
  ]);

  return drafts.map(({ r, activeClaimIds }) => {
    const order = one(
      r.official_orders as
        | { order_number: string; invoice_number: string; hold_expires_at: string }
        | { order_number: string; invoice_number: string; hold_expires_at: string }[]
        | null,
    );

    // Keep the response order, as the per-draft `.in('id', …)` read did. A
    // duplicated link still yields one line, because a claims row is unique by id.
    const mine = new Set(activeClaimIds);
    const lineItems = allLineItems.filter((li) => mine.has(li.claimId));

    return {
      id: r.id as string,
      status: r.status as string,
      customerDisplayName:
        one(r.customers as { display_name: string } | { display_name: string }[] | null)
          ?.display_name ?? 'Unknown',
      paymentArrangement: (r.payment_arrangement as string | null) ?? null,
      fulfillmentArrangement: (r.fulfillment_arrangement as string | null) ?? null,
      claimCount: lineItems.length,
      totalAmount: lineItems.reduce((sum, li) => sum + li.lineTotal, 0),
      claims: lineItems,
      orderNumber: order?.order_number ?? null,
      invoiceNumber: order?.invoice_number ?? null,
      holdExpiresAt: order?.hold_expires_at ?? null,
    };
  });
}

/**
 * Line items (claim reference, item, quantity, price) for every given claim, read
 * from stored claim/item data, never the client. One read covers all drafts on
 * the page; the caller groups the lines per draft. The line total is quantity ×
 * the item's stored per-piece price (the same basis the eligibility total uses).
 */
async function lineItemsForClaims(
  supabase: Awaited<ReturnType<typeof createClient>>,
  claimIds: string[],
): Promise<DraftLineItem[]> {
  if (claimIds.length === 0) return [];

  const data = await rowsForIds(claimIds, (ids) =>
    supabase
      .from('claims')
      .select(
        'id, claim_reference, quantity, inventory_items ( item_name, item_code, total_price_per_piece )',
      )
      .in('id', ids),
  );

  return (
    data as unknown as Array<{
      id: string;
      claim_reference: string;
      quantity: number;
      inventory_items:
        | {
            item_name: string | null;
            item_code: string | null;
            total_price_per_piece: number | null;
          }
        | {
            item_name: string | null;
            item_code: string | null;
            total_price_per_piece: number | null;
          }[]
        | null;
    }>
  ).map((r) => {
    const item = one(r.inventory_items);
    const unitPrice = item?.total_price_per_piece ?? 0;
    return {
      claimId: r.id,
      claimReference: r.claim_reference,
      itemName: item?.item_name ?? null,
      itemCode: item?.item_code ?? null,
      quantity: r.quantity,
      unitPrice,
      lineTotal: unitPrice * r.quantity,
    };
  });
}
