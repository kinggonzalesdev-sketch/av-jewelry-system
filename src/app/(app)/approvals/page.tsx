import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ApprovalsView } from '@/components/approvals/approvals-view';
import { PageHeader } from '@/components/ui/page-primitives';
import { getCurrentStaffProfile } from '@/lib/authz/guard';
import { listOwnerApprovals } from '@/lib/fulfillment/service';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Approvals — the dedicated home for the non-delegable Owner approval queue
 * (moved out of Orders 2026-08-09). It REUSES the existing owner_approval_requests
 * system and its guarded server actions; nothing about the approval logic changed.
 *
 * Owner-only, matching the queue's design ("only the Owner may decide — no
 * permission grants this"). The page re-checks the role server-side; the sidebar
 * item is ownerOnly, but hiding is convenience — this check is the control.
 */
export default async function ApprovalsPage() {
  const profile = await getCurrentStaffProfile();
  if (profile.roleKey !== 'owner') notFound();

  const approvals = await listOwnerApprovals();

  return (
    <div>
      <PageHeader title="Approvals" />
      <ApprovalsView approvals={approvals} isOwner={profile.roleKey === 'owner'} />
    </div>
  );
}
