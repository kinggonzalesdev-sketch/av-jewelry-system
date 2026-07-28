import type { Metadata } from 'next';

import { CustomersView } from '@/components/customers/customers-view';
import { PageHeader } from '@/components/ui/page-primitives';
import { hasPermission, requireActiveStaff } from '@/lib/authz/guard';
import { listCustomers } from '@/lib/customers/service';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Customers directory (Bible §14). Roadmap Phase 8.
 *
 * Real, database-backed, READ-ONLY. Any active staff may read customers; rows are
 * RLS-scoped. Selecting "View" opens a centered detail modal (client-side) — the
 * related orders/claims/photos panel was removed from this page (their backend
 * data is untouched). Standalone create/edit is intentionally not offered —
 * customers are created through claim capture / migration (see service.ts).
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';

  const [result, staff] = await Promise.all([
    listCustomers(query),
    requireActiveStaff(),
  ]);
  // Owner or Selected Admin may permanently delete an isolated customer.
  const canManage = staff.roleKey === 'owner' || staff.roleKey === 'selected_admin';
  // Owner/Admin, or a staff member with existing_record_entry, may edit details.
  const canEdit = canManage || (await hasPermission('existing_record_entry'));

  return (
    <div>
      <PageHeader title="Customers" />
      <CustomersView result={result} query={query} canManage={canManage} canEdit={canEdit} />
    </div>
  );
}
