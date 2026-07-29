'use server';

import { revalidatePath } from 'next/cache';

import {
  decideDeletionRequest,
  requestDeletion,
  type DeletionActionResult,
} from '@/lib/authz/deletion-requests';

/**
 * Deletion Approvals transport (§2). Authority lives in the domain module and the
 * database; these only carry the call and revalidate what changed.
 */

export async function requestDeletionAction(input: {
  entityType: string;
  entityId: string;
  entityLabel: string;
  reason: string;
}): Promise<DeletionActionResult> {
  const result = await requestDeletion(input);
  if (result.ok) revalidatePath('/admin/deletions');
  return result;
}

export async function decideDeletionRequestAction(
  requestId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<DeletionActionResult> {
  const result = await decideDeletionRequest(requestId, decision, note);
  if (result.ok) revalidatePath('/admin/deletions');
  return result;
}
