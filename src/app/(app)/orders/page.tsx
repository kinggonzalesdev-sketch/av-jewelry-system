import type { Metadata } from 'next';
import Link from 'next/link';

import { OrdersView } from '@/components/orders/orders-view';
import { getGrantedPermissions } from '@/lib/authz/guard';
import { listOrders } from '@/lib/orders/service';
import { PageHeader } from '@/components/ui/page-primitives';

export const metadata: Metadata = {
  title: 'Orders — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

/**
 * Official Orders (Bible §7, §22.9).
 *
 * A consolidated, read-only list of real Official Orders with authoritative
 * money and fulfillment status. RLS scopes the rows; every peso figure comes
 * from the tested order_balance() reader. The row links lead to the workspaces
 * that own the actions — this page acts on nothing, so it adds no new authority.
 *
 * New Entry lives HERE as an action (not a nav item): it links to the real
 * claim-capture flow on /live. It does not re-implement capture, and /live
 * re-checks the permission server-side — hiding the link is a convenience only
 * (Bible §30.3 r2).
 */
export default async function OrdersPage() {
  const [result, permissions] = await Promise.all([
    listOrders(),
    getGrantedPermissions(),
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
      <OrdersView result={result} />
    </div>
  );
}
