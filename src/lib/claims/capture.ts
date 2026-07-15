import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  captureClaimSchema,
  postLiveItemEntrySchema,
  type CaptureMethod,
  type ClaimEvidenceInput,
} from '@/lib/validation/live';

/**
 * Claim intake (Bible §12, §13).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  CAPTURE CREATES A PENDING CLAIM. NOTHING ELSE. (§12.3, §13.2)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * It does NOT:
 *   - reserve or decrement inventory   → that is Confirm Claim & Print (Phase 4)
 *   - confirm the claim                → different permission, different phase
 *   - print a label                    → Phase 4
 *   - create an invoice or an order    → Phase 5
 *   - auto-match the buyer             → the capturer names the customer
 *   - read the screenshot              → no OCR, ever (§13.2)
 *
 * The absence of that behaviour is the feature. If you are here to add "just a
 * quick reservation on capture", the answer is no: a Pending Claim that holds
 * stock is how a Live double-sells a unique ring.
 *
 * Duplicate protection: every capture carries an idempotency key, and the unique
 * index on it means a retried submit returns the FIRST claim rather than making
 * a second. Two staff capturing the same item for two DIFFERENT customers is not
 * a duplicate — that is a 1st and 2nd miner, and it is allowed (§19.7).
 */

export type CaptureResult =
  | { ok: true; claimId: string; claimReference: string; deduplicated: boolean }
  | { ok: false; error: string };

const INTAKE_KIND_FOR: Record<CaptureMethod, string> = {
  manual_live: 'live_capture',
  screenshot_upload: 'live_capture',
  ios_share: 'live_capture',
  post_live_manual: 'post_live_manual',
};

/**
 * Captures a Pending Claim.
 *
 * Idempotent by `idempotencyKey`: calling twice with the same key yields the
 * same claim and `deduplicated: true` the second time.
 */
export async function captureClaim(input: unknown): Promise<CaptureResult> {
  const parsed = captureClaimSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'The claim details are invalid.',
    };
  }

  const data = parsed.data;

  try {
    await requirePermission('claim_capture');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'claim.capture',
        entityType: 'claim',
        outcome: 'denied',
        reason: cause.message,
        context: { capture_method: data.captureMethod },
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Fast path for an obvious retry. This is a courtesy, not the guarantee —
  // the unique index below is the guarantee. A concurrent double-submit can slip
  // past this check and is caught there instead.
  const { data: existing } = await supabase
    .from('claims')
    .select('id, claim_reference')
    .eq('idempotency_key', data.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return {
      ok: true,
      claimId: existing.id as string,
      claimReference: existing.claim_reference as string,
      deduplicated: true,
    };
  }

  // A live capture must target an OPEN batch. Capturing into an ended Live is
  // how claims get attributed to the wrong session.
  if (data.liveBatchId) {
    const { data: batch } = await supabase
      .from('live_batches')
      .select('id, status')
      .eq('id', data.liveBatchId)
      .maybeSingle();

    if (!batch) {
      return { ok: false, error: 'That Live Batch could not be found.' };
    }

    if (!['active', 'paused', 'reopened'].includes(batch.status as string)) {
      const error =
        'That Live Batch is not running. Use Manual Post-Live Entry to record a claim after a Live has ended.';
      await recordAuditEvent({
        action: 'claim.capture',
        entityType: 'claim',
        outcome: 'failed',
        reason: error,
        context: { live_batch_id: data.liveBatchId, status: batch.status },
      });
      return { ok: false, error };
    }
  }

  // Resolve the flex flag from the ACTUAL target item, at this moment. It is
  // frozen onto the claim: a later flex switch cannot rewrite this claim's
  // attribution (§12 — switching affects future capture only).
  let capturedAgainstFlex = false;
  if (data.liveBatchItemId) {
    const { data: item } = await supabase
      .from('live_batch_items')
      .select('id, is_current_flex_item, withdrawn_at')
      .eq('id', data.liveBatchItemId)
      .maybeSingle();

    if (!item) {
      return { ok: false, error: 'That item is not part of this Live Batch.' };
    }

    if (item.withdrawn_at !== null) {
      return { ok: false, error: 'That item has been withdrawn from the Live Batch.' };
    }

    capturedAgainstFlex = item.is_current_flex_item === true;
  }

  const { data: created, error } = await supabase
    .from('claims')
    .insert({
      live_batch_id: data.liveBatchId ?? null,
      live_batch_item_id: data.liveBatchItemId ?? null,
      inventory_item_id: data.inventoryItemId,
      customer_id: data.customerId,
      quantity: data.quantity,
      // Not accepted from the caller. Capture creates a Pending Claim only —
      // the database trigger rejects anything else, and this is the one place
      // that decides it.
      status: 'pending_claim',
      intake_kind: INTAKE_KIND_FOR[data.captureMethod],
      capture_method: data.captureMethod,
      captured_against_flex_item: capturedAgainstFlex,
      idempotency_key: data.idempotencyKey,
      source_kind: 'native',
    })
    .select('id, claim_reference')
    .single();

  if (error || !created) {
    // 23505 = unique violation. The only unique key on this path is the
    // idempotency key, so this IS the concurrent double-submit: another request
    // won the race. Return ITS claim — the retry must not become a second claim.
    if (error?.code === '23505') {
      const { data: winner } = await supabase
        .from('claims')
        .select('id, claim_reference')
        .eq('idempotency_key', data.idempotencyKey)
        .maybeSingle();

      if (winner) {
        return {
          ok: true,
          claimId: winner.id as string,
          claimReference: winner.claim_reference as string,
          deduplicated: true,
        };
      }
    }

    await recordAuditEvent({
      action: 'claim.capture',
      entityType: 'claim',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
      context: { capture_method: data.captureMethod },
    });
    return { ok: false, error: 'The claim could not be captured.' };
  }

  const claimId = created.id as string;

  if (data.evidence?.length) {
    await attachEvidence(claimId, data.evidence);
  }

  if (data.note) {
    await attachEvidence(claimId, [
      { evidenceKind: 'manual_note', sharedText: data.note },
    ]);
  }

  await recordAuditEvent({
    action: 'claim.capture',
    entityType: 'claim',
    entityId: claimId,
    context: {
      claim_reference: created.claim_reference,
      capture_method: data.captureMethod,
      captured_against_flex_item: capturedAgainstFlex,
      // Stated explicitly so the audit trail itself testifies to the invariant.
      created_status: 'pending_claim',
      reservation_created: false,
    },
  });

  return {
    ok: true,
    claimId,
    claimReference: created.claim_reference as string,
    deduplicated: false,
  };
}

/**
 * Attaches evidence rows. Stored verbatim; never parsed (§13.2).
 */
async function attachEvidence(
  claimId: string,
  evidence: ClaimEvidenceInput[],
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('claim_evidence').insert(
    evidence.map((e) => ({
      claim_id: claimId,
      evidence_kind: e.evidenceKind,
      storage_path: e.storagePath ?? null,
      content_type: e.contentType ?? null,
      byte_size: e.byteSize ?? null,
      shared_text: e.sharedText ?? null,
    })),
  );

  if (error) {
    // The claim stands. Losing an attachment must not delete a captured claim —
    // it is recorded as a failure for follow-up instead.
    await recordAuditEvent({
      action: 'claim.attach_evidence',
      entityType: 'claim',
      entityId: claimId,
      outcome: 'failed',
      reason: error.message,
    });
  }
}

/**
 * Post-Live Item Entry (§12) — creating an item after a Live has ended.
 *
 * A DIFFERENT permission from claim capture: entering an item is not claiming
 * it. The item is created `available` and holds no reservation.
 */
export async function createPostLiveItem(
  input: unknown,
): Promise<{ ok: true; inventoryItemId: string } | { ok: false; error: string }> {
  const parsed = postLiveItemEntrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'The item details are invalid.',
    };
  }

  let staff;
  try {
    staff = await requirePermission('post_live_item_entry');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'inventory_item.post_live_entry',
        entityType: 'inventory_item',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const d = parsed.data;

  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      item_code: d.itemCode ?? `PL-${Date.now()}`,
      item_name: d.itemName,
      is_unique_item: d.isUniqueItem,
      quantity_total: d.quantityTotal,
      grams_per_piece: d.gramsPerPiece ?? null,
      total_price_per_piece: d.totalPricePerPiece ?? null,
      live_batch_id: d.liveBatchId ?? null,
      availability_status: 'available',
      source_kind: 'native',
      created_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !data) {
    await recordAuditEvent({
      action: 'inventory_item.post_live_entry',
      entityType: 'inventory_item',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    return { ok: false, error: 'The item could not be created.' };
  }

  await recordAuditEvent({
    action: 'inventory_item.post_live_entry',
    entityType: 'inventory_item',
    entityId: data.id as string,
    context: { item_name: d.itemName, availability_status: 'available' },
  });

  return { ok: true, inventoryItemId: data.id as string };
}
