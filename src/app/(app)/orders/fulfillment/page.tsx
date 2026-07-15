import type { Metadata } from 'next';

import { FulfillmentWorkspace } from '@/components/fulfillment/fulfillment-workspace';
import { getGrantedPermissions, requireActiveStaff } from '@/lib/authz/guard';
import { listFulfillments, listOwnerApprovals } from '@/lib/fulfillment/service';

export const metadata: Metadata = {
  title: 'Fulfillment — A.V. Jewelry Operations',
};

/**
 * Fulfillment & Owner Approval Center (Bible §18, §5.13, §22.13–22.14).
 * Roadmap Phase 7.
 *
 * Real, database-backed. A sub-route of the Orders group, not a sixth bottom-nav
 * item: the approved navigation is exactly five items (§8.2) and is frozen.
 *
 * `isOwner` comes from the verified session, never from the client. It decides
 * only what RENDERS — the six approvals are re-checked server-side against
 * non-delegable Owner authority, and the database enforces execute-once beneath
 * that.
 */
export default async function FulfillmentPage() {
  const [staff, permissions, fulfillments, approvals] = await Promise.all([
    requireActiveStaff(),
    getGrantedPermissions(),
    listFulfillments(),
    listOwnerApprovals(),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fulfillment</h1>
        <p className="text-sm text-muted-foreground">
          Shipping and pickup preparation, release, and the six Owner approvals.
        </p>
      </header>

      <FulfillmentWorkspace
        fulfillments={fulfillments}
        approvals={approvals}
        canPrepare={permissions.has('fulfillment_preparation')}
        canRelease={permissions.has('fulfillment_release')}
        canRequest={permissions.has('initiate_high_risk_action')}
        isOwner={staff.roleKey === 'owner'}
      />
    </div>
  );
}
