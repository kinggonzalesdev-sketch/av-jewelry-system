import type { Metadata } from 'next';

import { OrdersView } from '@/components/orders/orders-view';
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
 */
export default async function OrdersPage() {
  const result = await listOrders();

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Official Orders — invoicing, payment, and fulfillment status."
      />
      <OrdersView result={result} />
    </div>
  );
}
