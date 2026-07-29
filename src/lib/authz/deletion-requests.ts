import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';

/**
 * Deletion Approvals (§2).
 *
 * An Admin REQUESTS a deletion; only a Super Admin decides it. A Super Admin may
 * still delete outright, and that is recorded as `directly_deleted` — so the
 * register accounts for every deletion, not just the ones that needed asking.
 *
 * Approving records the DECISION; it does not itself delete. The deletion is then
 * carried out through the entity's own guarded path, so each entity keeps its own
 * safety rules (type-DELETE confirmations, stock guards, RTS review) instead of
 * this module quietly bypassing them.
 *
 * Every rule here is enforced in SQL as well — the UI hiding a button is never
 * the thing that stops an unauthorised decision.
 */

export type DeletionStatus = 'pending' | 'approved' | 'rejected' | 'directly_deleted';

export type DeletionRequestRow = {
  id: string;
  entityType: string;
  entityId: string;
  entityLabel: string;
  reason: string;
  status: DeletionStatus;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

export type DeletionActionResult = { ok: true } | { ok: false; error: string };

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function clean(message: string): string {
  return message.replace(/^ERROR:\s*/i, '').trim();
}

/** The whole register, newest first. RLS scopes it to active staff. */
export async function listDeletionRequests(): Promise<DeletionRequestRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('deletion_requests')
    .select(
      `id, entity_type, entity_id, entity_label, reason, status,
       requested_at, decided_at, decision_note,
       requester:staff_profiles!requested_by ( full_name ),
       decider:staff_profiles!decided_by ( full_name )`,
    )
    .order('requested_at', { ascending: false })
    .limit(500);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    entityType: r.entity_type as string,
    entityId: r.entity_id as string,
    entityLabel: (r.entity_label as string | null) ?? 'Record',
    reason: (r.reason as string | null) ?? '',
    status: (r.status as DeletionStatus) ?? 'pending',
    requestedByName: one<{ full_name: string }>(r.requester)?.full_name ?? 'Unknown',
    requestedAt: r.requested_at as string,
    decidedByName: one<{ full_name: string }>(r.decider)?.full_name ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
  }));
}

/** Ask a Super Admin to approve deleting this record. A reason is mandatory. */
export async function requestDeletion(input: {
  entityType: string;
  entityId: string;
  entityLabel: string;
  reason: string;
}): Promise<DeletionActionResult> {
  if (!input.reason?.trim()) {
    return { ok: false, error: 'A reason is required to request a deletion.' };
  }
  const supabase = await createClient();
  const res = (await supabase.rpc('request_deletion', {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_entity_label: input.entityLabel,
    p_reason: input.reason.trim(),
  })) as { error: { message: string } | null };

  if (res.error) return { ok: false, error: clean(res.error.message) };

  await recordAuditEvent({
    action: 'deletion.requested',
    entityType: input.entityType,
    entityId: input.entityId,
    context: { reason: input.reason.trim() },
  });
  return { ok: true };
}

/** Approve or reject. Super Admin only — the database re-checks. */
export async function decideDeletionRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<DeletionActionResult> {
  if (!requestId) return { ok: false, error: 'A request is required.' };
  const supabase = await createClient();
  const res = (await supabase.rpc('decide_deletion_request', {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note?.trim() || null,
  })) as { error: { message: string } | null };

  if (res.error) {
    const error = clean(res.error.message);
    await recordAuditEvent({
      action: 'deletion.decided',
      entityType: 'deletion_request',
      entityId: requestId,
      outcome: 'denied',
      reason: error,
    });
    return { ok: false, error };
  }

  await recordAuditEvent({
    action: 'deletion.decided',
    entityType: 'deletion_request',
    entityId: requestId,
    context: { decision },
  });
  return { ok: true };
}

/**
 * Record a Super Admin's direct deletion so the register stays complete.
 *
 * Deliberately NON-FATAL to the caller: if the register write fails, the deletion
 * the operator asked for has still happened, and reporting a false failure would
 * be worse than a missing register row. The audit event is written either way.
 */
export async function recordDirectDeletion(input: {
  entityType: string;
  entityId: string;
  entityLabel: string;
  reason?: string | null;
}): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc('record_direct_deletion', {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_entity_label: input.entityLabel,
    p_reason: input.reason?.trim() || null,
  });
}
