import type { Metadata } from 'next';
import Link from 'next/link';

import { NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import { OrdersView } from '@/components/orders/orders-view';
import { getCurrentStaffProfile, getGrantedPermissions } from '@/lib/authz/guard';
import { listCaptureCustomers } from '@/lib/live/batches';
import { listCaptureItems, listOrders } from '@/lib/orders/service';
import { PageHeader } from '@/components/ui/page-primitives';

export const metadata: Metadata = {
  title: 'Orders — A.V. Jewelry Operations',
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
 * New Entry (header) remains the live-capture shortcut to /live; New Order is the
 * post-live entry form. Both re-check permission server-side (Bible §30.3 r2).
 */
export default async function OrdersPage() {
  const [result, permissions, customers, items, profile] = await Promise.all([
    listOrders(),
    getGrantedPermissions(),
    listCaptureCustomers(),
    listCaptureItems(),
    getCurrentStaffProfile(),
  ]);

  const canCreateEntry =
    permissions.has('claim_capture') || permissions.has('post_live_item_entry');

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Official Orders — invoicing, payment, and fulfillment status."
        actions={
          canCreateEntry ? (
            <Link
              href="/live"
              data-testid="orders-new-entry"
              className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-sm font-semibold text-black transition-colors hover:bg-gold/90"
            >
              <span aria-hidden="true">＋</span> New Entry
            </Link>
          ) : null
        }
      />

      <div className="space-y-4">
        <NewOrderWorkflow
          customers={customers}
          items={items}
          canCreate={permissions.has('claim_capture')}
          shopName="A.V. Jewelry"
          salesperson={profile.fullName}
        />
        <OrdersView result={result} />
      </div>
    </div>
  );
}
