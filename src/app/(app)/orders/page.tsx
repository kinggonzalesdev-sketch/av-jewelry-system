import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import { OrdersView } from '@/components/orders/orders-view';
import { OwnerApprovalsPanel } from '@/components/orders/owner-approvals-panel';
import { CaptureReviewPanel } from '@/components/capture/capture-review-panel';
import { IncomingCapturesStrip } from '@/components/capture/incoming-captures-strip';
import { canOpenPage, getCurrentStaffProfile, getGrantedPermissions } from '@/lib/authz/guard';
import { getAdminNameContext } from '@/lib/authz/admin-name';
import { listOwnerApprovals } from '@/lib/fulfillment/service';
import { listCaptureCustomers } from '@/lib/live/batches';
import { listPendingCaptureReviews } from '@/lib/capture/review';
import { listCaptureItems, listOrders, listWalkInItems } from '@/lib/orders/service';
import { listKeepLayawayAccounts } from '@/lib/payments/layaway-ledger';
import { PageHeader } from '@/components/ui/page-primitives';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Official Orders (Bible §7, §22.9).
 *
 * A consolidated, read-only list of real Official Orders with the approved status
 * cards and the workflow controls (New Order · Invoice · Confirm · Layaway). New
 * Order opens the approved form and creates a Pending Claim via the real,
 * permission-guarded capture flow — never an Official Order (that is Approve &
 * Send Invoice). RLS scopes the rows; every peso figure comes from the tested
 * order_balance() reader.
 *
 * Capture has ONE entry: the New Order form (permission-gated on claim_capture,
 * re-checked server-side, Bible §30.3 r2). The old "New Entry → /live" header
 * link and the Invoice/Confirm/Layaway shortcut buttons were removed by Owner
 * request (2026-07-18) — they duplicated the sidebar navigation.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('nav_orders'))) notFound();
  const params = await searchParams;
  const openForInvoice = params.view === 'invoice';

  const [
    result,
    permissions,
    customers,
    items,
    walkInItems,
    profile,
    keepLayaways,
    approvals,
    admins,
    pendingReviews,
  ] = await Promise.all([
    listOrders(),
    getGrantedPermissions(),
    listCaptureCustomers(),
    listCaptureItems(),
    listWalkInItems(),
    getCurrentStaffProfile(),
    listKeepLayawayAccounts(),
    listOwnerApprovals(),
    getAdminNameContext(),
    listPendingCaptureReviews(),
  ]);

  return (
    <div>
      <PageHeader title="Orders" />

      <div className="space-y-4">
        {/* The six non-delegable Owner approvals. They used to live on the retired
            /orders/fulfillment page; this panel is why that page could not simply be
            deleted. It renders only when something is actually waiting. */}
        <OwnerApprovalsPanel approvals={approvals} isOwner={profile.roleKey === 'owner'} />
        {/* Review Mode queue — captures awaiting approval before they become orders.
            Only a capture-permitted member sees the approve/reject controls; the
            panel self-hides when the queue is empty. */}
        {permissions.has('claim_capture') ? (
          <CaptureReviewPanel rows={pendingReviews} />
        ) : null}
        {/* Incoming Captures — floating-screenshot uploads waiting to become orders on
            this PC. Realtime; self-hides when empty. Same permission as capture. */}
        {permissions.has('claim_capture') ? (
          <IncomingCapturesStrip
            customers={customers}
            items={items}
            walkInItems={walkInItems}
            admins={admins}
          />
        ) : null}
        <OrdersView
          result={result}
          openForInvoice={openForInvoice}
          keepLayaways={keepLayaways}
          canDeleteOrders={profile.roleKey === 'owner'}
          // Passed as a slot so Send All Invoices can sit beside it: the active-card
          // state that decides when to show that button lives inside OrdersView.
          newOrderAction={
            <NewOrderWorkflow
              customers={customers}
              items={items}
              walkInItems={walkInItems}
              canCreate={permissions.has('claim_capture')}
              admins={admins}
            />
          }
        />
      </div>
    </div>
  );
}
