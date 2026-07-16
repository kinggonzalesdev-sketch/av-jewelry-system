import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-primitives';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import { getGrantedPermissions } from '@/lib/authz/guard';
import {
  getDashboardCounts,
  getDashboardMetrics,
  listAuditEvents,
  listNotifications,
  search,
} from '@/lib/dashboard/service';

export const metadata: Metadata = {
  title: 'Dashboard Profile — A.V. Jewelry Operations',
};

/**
 * Dashboard (Bible §7, §8.3, §23, §25, §26, §31). Roadmap Phase 9.
 *
 * Real, database-backed — no longer a placeholder. Every count comes from
 * public.dashboard_counts(), which builds DISJOINT Official Order buckets:
 * an Active Layaway IS an Official Order and is never counted twice.
 *
 * Counts, search results, and audit rows are all scoped by RLS, so this page
 * shows only what the caller may already read. Permission flags decide what
 * renders; every action re-checks server-side (ADR §7).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q : '';

  const [counts, metrics, notifications, audit, results, permissions] = await Promise.all(
    [
      getDashboardCounts(),
      getDashboardMetrics(),
      listNotifications(),
      listAuditEvents(),
      search(query),
      getGrantedPermissions(),
    ],
  );

  return (
    <div>
      <PageHeader
        title="Dashboard Profile"
        description="Work queues, search, reports, reminders, and audit."
      />

      <DashboardView
        counts={counts}
        metrics={metrics}
        notifications={notifications}
        audit={audit}
        results={results}
        query={query}
        canExport={permissions.has('export_data_reports')}
        canVerifyPayments={permissions.has('payment_verification')}
        canMonitorInventory={permissions.has('inventory_monitoring')}
      />
    </div>
  );
}
