import type { Metadata } from 'next';

import { CustomersView } from '@/components/customers/customers-view';
import { PageHeader } from '@/components/ui/page-primitives';
import { listAttachments } from '@/lib/attachments/service';
import { getCustomerDetail, listCustomers } from '@/lib/customers/service';

export const metadata: Metadata = {
  title: 'Customers — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

/**
 * Customers directory (Bible §14). Roadmap Phase 8.
 *
 * Real, database-backed, READ-ONLY. Any active staff may read customers; the
 * rows and every related order/claim are RLS-scoped. Selecting a customer opens
 * their detail (?id=). Standalone create/edit is intentionally not offered —
 * customers are created through claim capture / migration (see service.ts).
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';
  const selectedId = typeof params.id === 'string' ? params.id : null;

  const [result, detail, attachments] = await Promise.all([
    listCustomers(query),
    selectedId ? getCustomerDetail(selectedId) : Promise.resolve(null),
    selectedId ? listAttachments('customer', selectedId) : Promise.resolve([]),
  ]);

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Customer directory — details, related Official Orders, and claims."
      />
      <CustomersView
        result={result}
        query={query}
        detail={detail}
        selectedId={selectedId}
        attachments={attachments}
      />
    </div>
  );
}
