import 'server-only';

import { requestOwnerApproval, type OwnerApprovalKind } from '@/lib/fulfillment/service';

/**
 * Approvals Phase 2 (2026-08-09) — a NON-owner asks the Owner to approve a delete.
 * Creates a pending owner_approval_request (it deletes NOTHING) with the target's
 * label carried in the reason so the Owner sees what/why in /approvals. Requesting
 * needs the `initiate_high_risk_action` permission (re-checked in requestOwnerApproval
 * + the DB). Owners never take this path — they delete directly. Shared by the
 * Inventory / Scrap / Attendance request actions.
 */
export type RequestDeletionResult = { ok: true } | { ok: false; error: string };

export async function requestOwnerDeletion(
  kind: OwnerApprovalKind,
  entityType: string,
  entityId: string,
  label: string,
  reason: string,
): Promise<RequestDeletionResult> {
  if (!entityId) return { ok: false, error: 'A record is required.' };
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return { ok: false, error: 'Add a reason for the Owner.' };
  const full = `Delete ${label}: ${trimmed}`;
  const res = await requestOwnerApproval(kind, entityType, entityId, full);
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
