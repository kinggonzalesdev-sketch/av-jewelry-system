import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import {
  AuthorizationError,
  requireOwnerApprovalAuthority,
  requirePermission,
} from '@/lib/authz/guard';
import { getOrderBalance } from '@/lib/payments/balances';
import { createClient } from '@/lib/supabase/server';

/**
 * Fulfillment & Owner Approval Center (Bible §18, §5.13, §22.13–22.14).
 *
 * Standing rules, enforced here AND in the database:
 *   - Preparation and Release are DIFFERENT permissions. Preparing is not
 *     releasing (§5.13).
 *   - NORMAL release is permission-based, not Owner-only. Only the EXCEPTIONAL
 *     path needs the Owner.
 *   - A REQUEST NEVER EXECUTES (§22.14). Creating an approval request changes
 *     nothing but the request.
 *   - An approved request executes EXACTLY ONCE, and state is re-validated at
 *     execution — an approval granted yesterday does not license an action whose
 *     preconditions changed since.
 *   - No automatic dispatch, completion, release, or stock return.
 */

export type FulfillmentResult = { ok: true } | { ok: false; error: string };

/** The six non-delegable Owner approvals (§5.13). */
export const OWNER_APPROVAL_KINDS = [
  'official_order_cancellation',
  'layaway_forfeiture',
  'price_override',
  'exceptional_fulfillment_release',
  'live_batch_reopen',
  'wrong_payment_to_order_correction',
] as const;

export type OwnerApprovalKind = (typeof OWNER_APPROVAL_KINDS)[number];

/**
 * Shipping/Pickup Preparation. Preparing is not releasing — this cannot move a
 * record into any released state.
 */
export async function prepareFulfillment(
  officialOrderId: string,
  input: {
    method: 'shipping' | 'pickup';
    courier?: string | null;
    trackingNumber?: string | null;
    pickupLocation?: string | null;
    pickupContact?: string | null;
    isCod?: boolean;
  },
): Promise<FulfillmentResult> {
  let staff;
  try {
    staff = await requirePermission('fulfillment_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'fulfillment.prepare',
        entityType: 'fulfillment_record',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // `.select('id')` turns this from fire-and-forget into a statement that
  // reports what it touched.
  //
  // Without it, an UPDATE matching ZERO rows returns no error — so when no
  // fulfillment record existed (they were never created until migration
  // 20260716230000), this function reported success and changed nothing. The
  // operator pressed Prepare, saw "Prepared", and the order sat untouched. A
  // silent no-op is worse than a visible failure: it ends the investigation.
  const { data, error } = await supabase
    .from('fulfillment_records')
    .update({
      // Preparation sets the queue, never a released state.
      status: input.method === 'shipping' ? 'for_shipping' : 'for_pickup',
      method: input.method,
      courier: input.courier ?? null,
      tracking_number: input.trackingNumber ?? null,
      pickup_location: input.pickupLocation ?? null,
      pickup_contact: input.pickupContact ?? null,
      is_cod: input.isCod ?? false,
      prepared_at: new Date().toISOString(),
      prepared_by: staff.staffProfileId,
    })
    .eq('official_order_id', officialOrderId)
    .select('id');

  if (error) return { ok: false, error: 'The fulfillment could not be prepared.' };

  // Zero rows matched. Every Official Order has had exactly one fulfillment
  // record since 20260716230000 created it inside the Approve & Send
  // transaction and backfilled the rest — so reaching here means the record is
  // genuinely missing, or RLS hides this order from the caller.
  //
  // The record is NOT created here as a fallback. A missing row after that
  // migration is a data-integrity fact, and quietly manufacturing one would
  // paper over it and make the real cause unfindable.
  if (!data || data.length === 0) {
    await recordAuditEvent({
      action: 'fulfillment.prepare',
      entityType: 'fulfillment_record',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: 'No fulfillment record matched the Official Order.',
    });

    return {
      ok: false,
      error: 'Fulfillment record missing for Official Order. Preparation was not saved.',
    };
  }

  await recordAuditEvent({
    action: 'fulfillment.prepare',
    entityType: 'fulfillment_record',
    entityId: officialOrderId,
    context: {
      method: input.method,
      is_cod: input.isCod ?? false,
      // Preparation is not release, and the trail says so.
      released: false,
    },
  });

  return { ok: true };
}

/**
 * NORMAL release — permission-based, not Owner-only (§18).
 *
 * The verified-payment rule, the PHP 1,000 deposit floor, and the COD approval
 * are all enforced by the database trigger underneath this. It is not re-checked
 * here in TypeScript: a second copy could drift, and the database is what
 * actually stands between an unpaid order and goods leaving the building.
 */
export async function releaseFulfillment(
  officialOrderId: string,
  note?: string,
): Promise<FulfillmentResult> {
  let staff;
  try {
    staff = await requirePermission('fulfillment_release');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'fulfillment.release',
        entityType: 'fulfillment_record',
        entityId: officialOrderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('fulfillment_records')
    .update({
      status: 'approved_for_release',
      released_at: new Date().toISOString(),
      released_by: staff.staffProfileId,
      release_note: note ?? null,
    })
    .eq('official_order_id', officialOrderId);

  if (error) {
    await recordAuditEvent({
      action: 'fulfillment.release',
      entityType: 'fulfillment_record',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: error.message,
    });
    // The database message is already written for a human — surface it rather
    // than replacing a precise refusal with a generic one.
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'fulfillment.release',
    entityType: 'fulfillment_record',
    entityId: officialOrderId,
    reason: note ?? null,
    context: { release_kind: 'normal', owner_approved: false, auto_dispatched: false },
  });

  return { ok: true };
}

/** Dispatch or pickup completion. Never automatic; always attributed. */
export async function markDispatchedOrPickedUp(
  officialOrderId: string,
  kind: 'dispatched' | 'picked_up',
): Promise<FulfillmentResult> {
  try {
    await requirePermission('fulfillment_release');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status: kind };
  if (kind === 'dispatched') patch.dispatched_at = new Date().toISOString();
  if (kind === 'picked_up') patch.picked_up_at = new Date().toISOString();

  const { error } = await supabase
    .from('fulfillment_records')
    .update(patch)
    .eq('official_order_id', officialOrderId);

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };

  await recordAuditEvent({
    action: `fulfillment.${kind}`,
    entityType: 'fulfillment_record',
    entityId: officialOrderId,
    context: { automatic: false },
  });

  return { ok: true };
}

export async function completeFulfillment(
  officialOrderId: string,
): Promise<FulfillmentResult> {
  try {
    await requirePermission('fulfillment_release');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('fulfillment_records')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('official_order_id', officialOrderId);

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };

  await recordAuditEvent({
    action: 'fulfillment.completed',
    entityType: 'fulfillment_record',
    entityId: officialOrderId,
    context: { automatic: false },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Owner Approval Center (§5.13, §22.14)
// ---------------------------------------------------------------------------

/**
 * Creates an Owner Approval Request.
 *
 * A REQUEST IS NOT THE ACTION. This changes nothing except the request itself,
 * and the permission to create one is explicitly request-only.
 */
export async function requestOwnerApproval(
  kind: OwnerApprovalKind,
  entityType: string,
  entityId: string,
  reason: string,
): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('initiate_high_risk_action');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'owner_approval.request',
        entityType,
        entityId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const trimmed = reason?.trim() ?? '';
  if (trimmed.length === 0) {
    return { ok: false, error: 'An approval request requires a reason.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('owner_approval_requests')
    .insert({
      action_kind: kind,
      status: 'pending_owner_approval',
      entity_type: entityType,
      entity_id: entityId,
      reason: trimmed,
      requested_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: 'The approval request could not be created.' };
  }

  await recordAuditEvent({
    action: 'owner_approval.request',
    entityType: 'owner_approval_request',
    entityId: data.id as string,
    reason: trimmed,
    context: {
      action_kind: kind,
      target_entity_id: entityId,
      // Requesting executes nothing. The trail must never imply otherwise.
      executed: false,
      requires_owner_decision: true,
    },
  });

  return { ok: true, requestId: data.id as string };
}

/**
 * Owner decides a request. Non-delegable — no permission confers this (§5.13).
 * Deciding is not executing.
 */
export async function decideOwnerApproval(
  requestId: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<FulfillmentResult> {
  let owner;
  try {
    owner = await requireOwnerApprovalAuthority();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'owner_approval.decide',
        entityType: 'owner_approval_request',
        entityId: requestId,
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
    .eq('id', requestId)
    .eq('status', 'pending_owner_approval')
    .select('id, action_kind');

  if (error || !data || data.length === 0) {
    return {
      ok: false,
      error: 'That request could not be decided. It may already have been decided.',
    };
  }

  await recordAuditEvent({
    action: 'owner_approval.decide',
    entityType: 'owner_approval_request',
    entityId: requestId,
    reason: note ?? null,
    context: {
      decision,
      action_kind: data[0]?.action_kind,
      // Deciding authorizes. It does not execute.
      executed: false,
    },
  });

  return { ok: true };
}

/**
 * Marks an approved request executed.
 *
 * STATE IS RE-VALIDATED HERE (§22.14): an approval granted yesterday does not
 * license an action whose preconditions have since changed. The database
 * additionally guarantees execute-once by freezing an executed request, so a
 * retry cannot run the action twice.
 */
export async function executeOwnerApproval(
  requestId: string,
): Promise<FulfillmentResult> {
  let owner;
  try {
    owner = await requireOwnerApprovalAuthority();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'owner_approval.execute',
        entityType: 'owner_approval_request',
        entityId: requestId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // Re-read the stored request. The screen's view of it is not evidence.
  const { data: request } = await supabase
    .from('owner_approval_requests')
    .select('id, status, action_kind, entity_id, executed_at')
    .eq('id', requestId)
    .maybeSingle();

  if (!request) return { ok: false, error: 'That approval request could not be found.' };

  if (request.status !== 'approved') {
    const error = `That request is ${request.status as string}. Only an approved request can be executed.`;
    await recordAuditEvent({
      action: 'owner_approval.execute',
      entityType: 'owner_approval_request',
      entityId: requestId,
      outcome: 'failed',
      reason: error,
    });
    return { ok: false, error };
  }

  if (request.executed_at !== null) {
    // Idempotent from the caller's view: already done, nothing re-run.
    return {
      ok: false,
      error: 'That approval was already executed. It executes exactly once.',
    };
  }

  const { error } = await supabase
    .from('owner_approval_requests')
    .update({
      executed_at: new Date().toISOString(),
      executed_by: owner.staffProfileId,
    })
    .eq('id', requestId)
    .is('executed_at', null);

  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'owner_approval.execute',
    entityType: 'owner_approval_request',
    entityId: requestId,
    context: {
      action_kind: request.action_kind,
      target_entity_id: request.entity_id,
      state_revalidated: true,
      executes_once: true,
    },
  });

  return { ok: true };
}

export type ApprovalRow = {
  id: string;
  actionKind: string;
  status: string;
  entityType: string;
  entityId: string;
  reason: string;
  requestedAt: string;
  decidedAt: string | null;
  executedAt: string | null;
};

/** The Owner Approval Center queue. */
export async function listOwnerApprovals(): Promise<ApprovalRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('owner_approval_requests')
    .select(
      'id, action_kind, status, entity_type, entity_id, reason, requested_at, decided_at, executed_at',
    )
    .order('requested_at', { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      actionKind: r.action_kind as string,
      status: r.status as string,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string,
      reason: r.reason as string,
      requestedAt: r.requested_at as string,
      decidedAt: (r.decided_at as string | null) ?? null,
      executedAt: (r.executed_at as string | null) ?? null,
    };
  });
}

export type FulfillmentRow = {
  officialOrderId: string;
  orderNumber: string;
  customerDisplayName: string;
  status: string;
  method: string | null;
  courier: string | null;
  trackingNumber: string | null;
  isCod: boolean;
  codApproved: boolean;
  verifiedNetPayments: string;
  totalAmountPayable: string;
  meetsDepositFloor: boolean;
  /** Set when the balance could not be read. Money fields are meaningless then. */
  balanceUnavailable: string | null;
};

export type FulfillmentListResult =
  { ok: true; rows: FulfillmentRow[] } | { ok: false; reason: string };

/**
 * The fulfillment queue, with the release preconditions made visible.
 *
 * Returns an explicit failure rather than an empty array on a read error — an
 * unreadable queue must never look like "nothing to fulfill" (the session's rule).
 */
export async function listFulfillments(): Promise<FulfillmentListResult> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('fulfillment_records')
    .select(
      `official_order_id, status, method, courier, tracking_number, is_cod, cod_approved_at,
       official_orders ( order_number, customers ( display_name ) )`,
    )
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return { ok: false, reason: error.message };
  }

  const rows = await Promise.all(
    ((data ?? []) as unknown[]).map(async (row) => {
      const r = row as Record<string, unknown>;
      const orderId = r.official_order_id as string;
      const order = one<{ order_number: string; customers: unknown }>(r.official_orders);
      const customer = one<{ display_name: string }>(order?.customers);

      // Reuses the authoritative reader. This used to call order_balance()
      // itself and fall back to '0.00' when the read failed — which made every
      // order read "₱0.00 verified, below the deposit floor" while the database
      // held the real figure. Fail-closed on release, but a lie on screen.
      const result = await getOrderBalance(orderId);

      const base = {
        officialOrderId: orderId,
        orderNumber: order?.order_number ?? '—',
        customerDisplayName: customer?.display_name ?? 'Unknown',
        status: r.status as string,
        method: (r.method as string | null) ?? null,
        courier: (r.courier as string | null) ?? null,
        trackingNumber: (r.tracking_number as string | null) ?? null,
        isCod: r.is_cod === true,
        codApproved: r.cod_approved_at !== null,
      };

      if (!result.ok) {
        return {
          ...base,
          verifiedNetPayments: '',
          totalAmountPayable: '',
          // Unknown is NOT "met". The database decides at release time either
          // way, so this only governs what the operator is told.
          meetsDepositFloor: false,
          balanceUnavailable: result.reason,
        };
      }

      const verified = result.balance.verifiedNetPayments;

      return {
        ...base,
        verifiedNetPayments: verified,
        totalAmountPayable: result.balance.totalAmountPayable,
        // Advisory only. The database decides at release time.
        meetsDepositFloor: toCentavos(verified) >= 100000n,
        balanceUnavailable: null,
      };
    }),
  );

  return { ok: true, rows };
}

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function toCentavos(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
}
