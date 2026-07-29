import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { DeletionRequestsPanel } from '@/components/settings/deletion-requests-panel';
import { PageHeader } from '@/components/ui/page-primitives';
import { requireActiveStaff } from '@/lib/authz/guard';
import { listDeletionRequests } from '@/lib/authz/deletion-requests';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Administration → Deletion Requests (§2).
 *
 * Readable by an Admin as well as a Super Admin: an Admin who requested a
 * deletion must be able to see whether it was approved. Only a Super Admin gets
 * the Approve / Reject controls, and `decide_deletion_request` refuses anyone
 * else in SQL — so this page never has to be the thing keeping them out.
 */
export default async function DeletionRequestsPage() {
  const staff = await requireActiveStaff();
  // Staff (the third tier) have no business in the deletion register at all.
  if (staff.roleKey !== 'owner' && staff.roleKey !== 'selected_admin') notFound();

  const requests = await listDeletionRequests();

  return (
    <div className="space-y-4">
      <PageHeader title="Deletion Requests" />
      <Link
        href="/settings"
        className="inline-block text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        ← Back to Settings
      </Link>
      <DeletionRequestsPanel
        requests={requests}
        isSuperAdmin={staff.roleKey === 'owner'}
      />
    </div>
  );
}
