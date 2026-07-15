import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import {
  AuthorizationError,
  requireOwnerApprovalAuthority,
  requirePermission,
} from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { moneyString } from '@/lib/payments/workspace';
import {
  activateLayawaySchema,
  recordInstallmentSchema,
} from '@/lib/validation/payments';

/**
 * Layaway operations (Bible §17, docs/PHASE-6-APPROVED-DECISIONS.md §5, §6).
 *
 * Standing rules enforced here and in the database:
 *   - Activation needs a VERIFIED down payment >= 20% of the Layaway Amount
 *     Payable (fee included). Evidence alone never activates.
 *   - Recording an installment is NOT verifying its payment.
 *   - No automatic forfeiture, no automatic stock return. Forfeiture is an
 *     Owner approval, and staff may only REQUEST it — a request is not the act.
 */

export type LayawayResult = { ok: true } | { ok: false; error: string };

/**
 * Activates a Layaway once a verified deposit meets the 20% threshold.
 *
 * The threshold is re-read from the database, never from the screen: the
 * required down payment and the verified total both come from the approved SQL.
 */
export async function activateLayaway(input: unknown): Promise<LayawayResult> {
  const parsed = activateLayawaySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid layaway details.',
    };
  }

  const data = parsed.data;

  try {
    await requirePermission('layaway_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway.activate',
        entityType: 'layaway_arrangement',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // The deposit must be VERIFIED. A submitted screenshot activates nothing.
  const { data: deposit } = await supabase
    .from('payments')
    .select('id, status, official_order_id')
    .eq('id', data.depositPaymentId)
    .maybeSingle();

  if (!deposit) return { ok: false, error: 'That deposit payment could not be found.' };

  if (deposit.status !== 'verified') {
    const error =
      'The down payment is not verified yet. Evidence alone does not activate a Layaway.';
    await recordAuditEvent({
      action: 'layaway.activate',
      entityType: 'layaway_arrangement',
      outcome: 'failed',
      reason: error,
      context: {
        deposit_payment_id: data.depositPaymentId,
        deposit_status: deposit.status,
      },
    });
    return { ok: false, error };
  }

  // Re-read the threshold and the verified total from the approved functions.
  const balanceResponse = await supabase.rpc('order_balance', {
    p_order_id: data.officialOrderId,
  });
  const b = (balanceResponse.data ?? {}) as Record<string, unknown>;

  const required = toCentavos(moneyString(b.required_down_payment));
  const verified = toCentavos(moneyString(b.verified_net_payments));

  if (verified < required) {
    const error = `The verified down payment is below the required 20%. Verified ₱${moneyString(b.verified_net_payments)}, required ₱${moneyString(b.required_down_payment)}.`;
    await recordAuditEvent({
      action: 'layaway.activate',
      entityType: 'layaway_arrangement',
      outcome: 'failed',
      reason: error,
      context: {
        required_down_payment: b.required_down_payment,
        verified_net_payments: b.verified_net_payments,
      },
    });
    return { ok: false, error };
  }

  const { data: updated, error } = await supabase
    .from('layaway_arrangements')
    .update({
      status: 'active',
      deposit_verified_payment_id: data.depositPaymentId,
      months: data.months,
      final_due_date: data.finalDueDate,
      started_at: new Date().toISOString(),
    })
    .eq('official_order_id', data.officialOrderId)
    .select('id');

  if (error || !updated || updated.length === 0) {
    return { ok: false, error: 'The Layaway could not be activated.' };
  }

  await recordAuditEvent({
    action: 'layaway.activate',
    entityType: 'layaway_arrangement',
    entityId: updated[0]?.id as string,
    context: {
      months: data.months,
      required_down_payment: b.required_down_payment,
      verified_net_payments: b.verified_net_payments,
      deposit_verified: true,
    },
  });

  return { ok: true };
}

/**
 * Records an installment.
 *
 * RECORDING IS NOT VERIFYING. Linking a payment to an installment says "this is
 * the payment for month 2"; it does not assert the money arrived. The payment
 * still needs its own verification, and only then does it move the balance.
 */
export async function recordInstallment(input: unknown): Promise<LayawayResult> {
  const parsed = recordInstallmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid installment.',
    };
  }

  const data = parsed.data;

  try {
    await requirePermission('layaway_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway.record_installment',
        entityType: 'layaway_arrangement',
        entityId: data.layawayArrangementId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.from('layaway_installments').insert({
    layaway_arrangement_id: data.layawayArrangementId,
    installment_number: data.installmentNumber,
    due_date: data.dueDate,
    amount_due: data.amountDue,
    payment_id: data.paymentId ?? null,
  });

  if (error) {
    // UNIQUE(arrangement, number): a retry cannot duplicate an installment.
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'That installment number already exists for this Layaway.',
      };
    }
    return { ok: false, error: 'The installment could not be recorded.' };
  }

  await recordAuditEvent({
    action: 'layaway.record_installment',
    entityType: 'layaway_arrangement',
    entityId: data.layawayArrangementId,
    context: {
      installment_number: data.installmentNumber,
      payment_id: data.paymentId ?? null,
      // The trail states the distinction explicitly.
      payment_verified_by_this_action: false,
      balance_changed: false,
    },
  });

  return { ok: true };
}

/**
 * Requests Owner approval to forfeit a Layaway.
 *
 * A REQUEST IS NOT THE ACT (§22.14). This creates an approval request and
 * changes nothing else: no forfeiture, no stock return. Only the Owner can
 * decide, and executing is a separate step.
 */
export async function requestForfeiture(
  layawayArrangementId: string,
  reason: string,
): Promise<LayawayResult> {
  let staff;
  try {
    staff = await requirePermission('initiate_high_risk_action');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway.forfeiture_requested',
        entityType: 'layaway_arrangement',
        entityId: layawayArrangementId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: false, error: 'A forfeiture request requires a reason.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('owner_approval_requests')
    .insert({
      action_kind: 'layaway_forfeiture',
      status: 'pending_owner_approval',
      entity_type: 'layaway_arrangement',
      entity_id: layawayArrangementId,
      reason: trimmed,
      requested_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: 'The forfeiture request could not be created.' };
  }

  await recordAuditEvent({
    action: 'layaway.forfeiture_requested',
    entityType: 'layaway_arrangement',
    entityId: layawayArrangementId,
    reason: trimmed,
    context: {
      approval_request_id: data.id,
      // A request executes nothing. The trail must not imply otherwise.
      forfeited: false,
      stock_returned: false,
      requires_owner_approval: true,
    },
  });

  return { ok: true };
}

/**
 * Owner decision on a forfeiture request.
 *
 * Deciding is NOT executing (Phase 1 keeps execution behind its own constraint),
 * and approving still returns no stock: a forfeited item goes to
 * Returned-to-Stock Review, which is a separate, human decision.
 */
export async function decideForfeiture(
  approvalRequestId: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<LayawayResult> {
  let owner;
  try {
    // Non-delegable: no permission confers this.
    owner = await requireOwnerApprovalAuthority();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway.forfeiture_decided',
        entityType: 'owner_approval_request',
        entityId: approvalRequestId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('owner_approval_requests')
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: owner.staffProfileId,
      decision_note: note ?? null,
    })
    .eq('id', approvalRequestId)
    .eq('status', 'pending_owner_approval')
    .select('id, entity_id');

  if (error || !data || data.length === 0) {
    return {
      ok: false,
      error: 'That request could not be decided. It may already have been decided.',
    };
  }

  await recordAuditEvent({
    action: 'layaway.forfeiture_decided',
    entityType: 'owner_approval_request',
    entityId: approvalRequestId,
    reason: note ?? null,
    context: {
      decision,
      layaway_arrangement_id: data[0]?.entity_id,
      // Approving authorizes; it does not execute, and it returns no stock.
      executed: false,
      stock_returned: false,
      routes_to: 'returned_to_stock_review',
    },
  });

  return { ok: true };
}

/** Peso string -> integer centavos. Exact comparison; never via a float. */
function toCentavos(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
}
