import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { getOrderBalance } from '@/lib/payments/balances';
import { createClient } from '@/lib/supabase/server';
import { recordPaymentSchema, type PaymentMethod } from '@/lib/validation/payments';

/**
 * Money must never be a JS float. A peso string is compared as exact integer
 * centavos so "block over-balance" (Owner decision 2026-07-25: strict, no
 * overpayment) is precise to the last centavo.
 */
function toCentavos(value: string): bigint {
  const negative = value.trim().startsWith('-');
  const [whole = '0', fraction = ''] = value.trim().replace('-', '').split('.');
  const cents = `${fraction}00`.slice(0, 2);
  const magnitude = BigInt(whole || '0') * 100n + BigInt(cents || '0');
  return negative ? -magnitude : magnitude;
}

/** True when money string `a` is strictly greater than `b` (exact, no float). */
function moneyExceeds(a: string, b: string): boolean {
  return toCentavos(a) > toCentavos(b);
}

/**
 * Payment recording, evidence, and verification (Bible §16, §22.11).
 * Implements docs/PHASE-6-APPROVED-DECISIONS.md §1, §3, §4.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  RECORDING IS NOT VERIFYING. VERIFIED IS NOT PAID IN FULL.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Three separate records, deliberately:
 *   payments              — someone says money moved
 *   payment_evidence      — the proof they attached
 *   payment_verifications — an authorized human says the money actually arrived
 *
 * Collapsing any two of those would let a screenshot pay for a ring.
 *
 * Verification is a statement about MONEY ONLY. It never releases stock,
 * forfeits a layaway, cancels an order, or deducts inventory — the database
 * trigger `payment_verifications_money_only` refuses to let it.
 *
 * ⚠️  CARD DATA IS NEVER ACCEPTED OR STORED (approved decision §3). There is no
 *     field here for a card number, CVV, or PIN, and none may be added.
 */

export type PaymentResult =
  | { ok: true; paymentId: string; duplicateReferenceFlagged: boolean }
  | { ok: false; error: string };

/**
 * Records a submitted payment. It is born `submitted_unverified` — always.
 *
 * A duplicate reference number is ACCEPTED and FLAGGED, never silently rejected
 * (§3). Rejecting it would hide the collision; a human must look at it.
 */
export async function recordPayment(input: unknown): Promise<PaymentResult> {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'The payment details are invalid.',
    };
  }

  const data = parsed.data;

  let staff;
  try {
    staff = await requirePermission('payment_verification');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'payment.record',
        entityType: 'payment',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Strict (Owner decision 2026-07-25): a payment may not be recorded for more
  // than the order's outstanding balance — no overpayment. Best-effort UX gate:
  // only blocks when the balance reads cleanly; the verification trigger is the
  // authoritative money guard beneath this.
  const balance = await getOrderBalance(data.officialOrderId);
  if (balance.ok && moneyExceeds(data.amount, balance.balance.outstandingBalance)) {
    await recordAuditEvent({
      action: 'payment.record',
      entityType: 'payment',
      outcome: 'denied',
      reason: 'Amount exceeds the outstanding balance (overpayment blocked).',
      context: {
        official_order_id: data.officialOrderId,
        amount: data.amount,
        outstanding_balance: balance.balance.outstandingBalance,
      },
    });
    return {
      ok: false,
      error: `This is more than the remaining balance of ₱${balance.balance.outstandingBalance}. Enter an amount up to the balance.`,
    };
  }

  // Flag, do not reject (§3).
  let duplicateReferenceFlagged = false;
  if (data.referenceNumber) {
    const { data: existing } = await supabase
      .from('payments')
      .select('id')
      .eq('reference_number', data.referenceNumber)
      .is('voided_at', null)
      .limit(1);

    duplicateReferenceFlagged = (existing?.length ?? 0) > 0;
  }

  const { data: created, error } = await supabase
    .from('payments')
    .insert({
      official_order_id: data.officialOrderId,
      amount: data.amount,
      // Not accepted from the caller. Every payment starts unverified (§3).
      status: 'submitted_unverified',
      payment_method: data.paymentMethod,
      reference_number: data.referenceNumber ?? null,
      provider: data.provider ?? null,
      transacted_at: data.transactedAt,
      received_by: data.paymentMethod === 'cash' ? staff.staffProfileId : null,
      collection_location: data.collectionLocation ?? null,
      method_detail_note: data.note ?? null,
      recorded_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !created) {
    await recordAuditEvent({
      action: 'payment.record',
      entityType: 'payment',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    return { ok: false, error: 'The payment could not be recorded.' };
  }

  const paymentId = created.id as string;

  if (data.evidence?.length) {
    await supabase.from('payment_evidence').insert(
      data.evidence.map((e) => ({
        payment_id: paymentId,
        storage_path: e.storagePath,
        content_type: e.contentType ?? null,
        byte_size: e.byteSize ?? null,
        note: e.note ?? null,
        uploaded_by: staff.staffProfileId,
      })),
    );
  }

  await recordAuditEvent({
    action: 'payment.record',
    entityType: 'payment',
    entityId: paymentId,
    context: {
      official_order_id: data.officialOrderId,
      payment_method: data.paymentMethod,
      // The trail testifies to what recording did NOT do.
      status: 'submitted_unverified',
      verified: false,
      counts_toward_balance: false,
      duplicate_reference_flagged: duplicateReferenceFlagged,
    },
  });

  if (duplicateReferenceFlagged) {
    await recordAuditEvent({
      action: 'payment.duplicate_reference_flagged',
      entityType: 'payment',
      entityId: paymentId,
      outcome: 'failed',
      reason: 'A payment with this transaction/reference number already exists.',
      context: { reference_number: data.referenceNumber, auto_rejected: false },
    });
  }

  return { ok: true, paymentId, duplicateReferenceFlagged };
}

/**
 * Attaches evidence to an existing payment.
 *
 * Attaching evidence verifies NOTHING. The payment's status is untouched here,
 * on purpose — that is the entire distinction this phase exists to protect.
 */
export async function attachPaymentEvidence(
  paymentId: string,
  storagePath: string,
  note?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('payment_verification');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('payment_evidence').insert({
    payment_id: paymentId,
    storage_path: storagePath,
    note: note ?? null,
    uploaded_by: staff.staffProfileId,
  });

  if (error) return { ok: false, error: 'The evidence could not be attached.' };

  await recordAuditEvent({
    action: 'payment.evidence_attached',
    entityType: 'payment',
    entityId: paymentId,
    context: { verified: false, status_changed: false },
  });

  return { ok: true };
}

/**
 * Verify Payment — an authorized human attests the money arrived.
 *
 * `verifiedAmount` is what ACTUALLY arrived, which may differ from what was
 * claimed: only the verified amount reduces the Outstanding Balance (§4).
 *
 * Idempotent: UNIQUE(payment_id) on payment_verifications means a retried verify
 * cannot produce a second verified record or double-count the money.
 */
export async function verifyPayment(
  paymentId: string,
  outcome: 'verified' | 'rejected',
  options?: { verifiedAmount?: string; note?: string },
): Promise<{ ok: true; deduplicated: boolean } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('payment_verification');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'payment.verify',
        entityType: 'payment',
        entityId: paymentId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Already decided: a retry must not double-count.
  const { data: existing } = await supabase
    .from('payment_verifications')
    .select('id, outcome')
    .eq('payment_id', paymentId)
    .maybeSingle();

  if (existing) {
    return { ok: true, deduplicated: true };
  }

  // Strict (Owner decision 2026-07-25): the verified amount may not push the
  // order above fully paid. Pre-check for a clean message; the database trigger
  // `payment_verifications_within_balance` is the authoritative gate that makes
  // this impossible even under a race.
  if (outcome === 'verified') {
    const { data: pay } = await supabase
      .from('payments')
      .select('official_order_id, amount')
      .eq('id', paymentId)
      .maybeSingle();
    if (pay?.official_order_id) {
      const incoming = options?.verifiedAmount ?? String(pay.amount);
      const balance = await getOrderBalance(pay.official_order_id as string);
      if (balance.ok && moneyExceeds(incoming, balance.balance.outstandingBalance)) {
        await recordAuditEvent({
          action: 'payment.verify',
          entityType: 'payment',
          entityId: paymentId,
          outcome: 'denied',
          reason: 'Verified amount exceeds the outstanding balance (overpayment blocked).',
          context: {
            verified_amount: incoming,
            outstanding_balance: balance.balance.outstandingBalance,
          },
        });
        return {
          ok: false,
          error: `That is more than the remaining balance of ₱${balance.balance.outstandingBalance}. Verify only the amount that actually arrived, up to the balance.`,
        };
      }
    }
  }

  const { error } = await supabase.from('payment_verifications').insert({
    payment_id: paymentId,
    outcome,
    verified_amount: outcome === 'verified' ? (options?.verifiedAmount ?? null) : null,
    note: options?.note ?? null,
    verified_by: staff.staffProfileId,
  });

  if (error) {
    // 23505 = the unique index: a concurrent verify won the race.
    if (error.code === '23505') return { ok: true, deduplicated: true };
    // 23514 = the within-balance trigger: the money guard refused an overpayment.
    if (error.code === '23514') {
      await recordAuditEvent({
        action: 'payment.verify',
        entityType: 'payment',
        entityId: paymentId,
        outcome: 'denied',
        reason: error.message,
      });
      return {
        ok: false,
        error:
          'The verified amount would exceed the order balance. Verify only the amount that actually arrived, up to the remaining balance.',
      };
    }

    await recordAuditEvent({
      action: 'payment.verify',
      entityType: 'payment',
      entityId: paymentId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: 'The payment could not be verified.' };
  }

  await supabase
    .from('payments')
    .update({ status: outcome === 'verified' ? 'verified' : 'rejected' })
    .eq('id', paymentId);

  await recordAuditEvent({
    action: outcome === 'verified' ? 'payment.verified' : 'payment.rejected',
    entityType: 'payment',
    entityId: paymentId,
    reason: options?.note ?? null,
    context: {
      verified_amount: options?.verifiedAmount ?? null,
      // Verification is about money only. The trail says so explicitly.
      paid_in_full: false,
      inventory_changed: false,
      stock_released: false,
      layaway_forfeited: false,
      order_cancelled: false,
    },
  });

  return { ok: true, deduplicated: false };
}

export type PaymentRow = {
  id: string;
  amount: string;
  status: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  provider: string | null;
  transactedAt: string | null;
  evidenceCount: number;
  verifiedAmount: string | null;
  correctionPending: boolean;
  voided: boolean;
  reversed: boolean;
};

/** Lists payments for an order, keeping every disqualifying state visible. */
export async function listPayments(officialOrderId: string): Promise<PaymentRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('payments')
    .select(
      `id, amount, status, payment_method, reference_number, provider, transacted_at,
       correction_pending, voided_at, reversed_at,
       payment_evidence ( id ),
       payment_verifications ( verified_amount, outcome )`,
    )
    .eq('official_order_id', officialOrderId)
    .order('recorded_at', { ascending: false });

  if (error || !data) return [];

  return data.map((row) => {
    const r = row as Record<string, unknown>;
    const verification = Array.isArray(r.payment_verifications)
      ? (r.payment_verifications[0] as { verified_amount: string | null } | undefined)
      : undefined;

    return {
      id: r.id as string,
      amount: String(r.amount),
      status: r.status as string,
      paymentMethod: (r.payment_method as string | null) ?? null,
      referenceNumber: (r.reference_number as string | null) ?? null,
      provider: (r.provider as string | null) ?? null,
      transactedAt: (r.transacted_at as string | null) ?? null,
      evidenceCount: ((r.payment_evidence as unknown[]) ?? []).length,
      verifiedAmount: verification?.verified_amount
        ? String(verification.verified_amount)
        : null,
      correctionPending: r.correction_pending === true,
      voided: r.voided_at !== null,
      reversed: r.reversed_at !== null,
    };
  });
}

export type { PaymentMethod };
