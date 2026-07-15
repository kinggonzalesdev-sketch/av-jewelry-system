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
  const [inDraft, inOrder, reserved] = await Promise.all([
    supabase.from('invoice_draft_claims').select('claim_id').eq('is_active', true),
    supabase.from('official_order_claims').select('claim_id'),
    supabase
      .from('inventory_reservations')
      .select('claim_id, state')
      .in('state', ['provisional', 'committed']),
  ]);

  const draftedIds = new Set((inDraft.data ?? []).map((r) => r.claim_id as string));
  const orderedIds = new Set((inOrder.data ?? []).map((r) => r.claim_id as string));
  const reservedIds = new Set((reserved.data ?? []).map((r) => r.claim_id as string));

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

export type DraftSummary = {
  id: string;
  status: string;
  customerDisplayName: string;
  paymentArrangement: string | null;
  fulfillmentArrangement: string | null;
  claimCount: number;
  totalAmount: number;
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

  return Promise.all(
    data.map(async (row) => {
      const r = row as Record<string, unknown>;
      const links =
        (r.invoice_draft_claims as Array<{ claim_id: string; is_active: boolean }>) ?? [];
      const active = links.filter((l) => l.is_active);
      const order = one(
        r.official_orders as
          | { order_number: string; invoice_number: string; hold_expires_at: string }
          | { order_number: string; invoice_number: string; hold_expires_at: string }[]
          | null,
      );

      return {
        id: r.id as string,
        status: r.status as string,
        customerDisplayName:
          one(r.customers as { display_name: string } | { display_name: string }[] | null)
            ?.display_name ?? 'Unknown',
        paymentArrangement: (r.payment_arrangement as string | null) ?? null,
        fulfillmentArrangement: (r.fulfillment_arrangement as string | null) ?? null,
        claimCount: active.length,
        totalAmount: await draftTotal(active.map((l) => l.claim_id)),
        orderNumber: order?.order_number ?? null,
        invoiceNumber: order?.invoice_number ?? null,
        holdExpiresAt: order?.hold_expires_at ?? null,
      };
    }),
  );
}

/** Totals are computed from stored claim/item data, never from the client. */
async function draftTotal(claimIds: string[]): Promise<number> {
  if (claimIds.length === 0) return 0;

  const supabase = await createClient();
  const { data } = await supabase
    .from('claims')
    .select('quantity, inventory_items ( total_price_per_piece )')
    .in('id', claimIds);

  if (!data) return 0;

  return data.reduce((sum, row) => {
    const r = row as unknown as {
      quantity: number;
      inventory_items:
        | { total_price_per_piece: number | null }
        | { total_price_per_piece: number | null }[]
        | null;
    };
    const price = one(r.inventory_items)?.total_price_per_piece ?? 0;
    return sum + price * r.quantity;
  }, 0);
}
