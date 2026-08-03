import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-primitives';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import { canOpenPage, getGrantedPermissions } from '@/lib/authz/guard';
import {
  getDashboardCounts,
  getDashboardMetricsRanged,
} from '@/lib/dashboard/service';
import { getLayawayDashboard } from '@/lib/payments/layaway-ledger';
import { getScrapIncome, getScrapTotal } from '@/lib/scrap/service';

export const metadata: Metadata = {
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
// Always render fresh from Supabase (never a cached route) so every device sees
// the same official data on load. The page already reads auth cookies (dynamic);
// this makes the intent explicit and guards against future caching.
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('nav_dashboard'))) notFound();
  const params = await searchParams;

  // The date range comes from the URL so every money figure is server-scoped to it.
  // No params → all time: from a sentinel epoch to today. The raw params are passed
  // to the view so it can show "all time" vs an explicit range.
  const rangeFrom = typeof params.from === 'string' ? params.from : undefined;
  const rangeTo = typeof params.to === 'string' ? params.to : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const effFrom = rangeFrom ?? '2000-01-01';
  const effTo = rangeTo ?? today;

  const [counts, metrics, scrapTotal, scrapIncome, permissions, layaway] =
    await Promise.all([
      getDashboardCounts(),
      getDashboardMetricsRanged(effFrom, effTo),
      getScrapTotal(effFrom, effTo),
      getScrapIncome(effFrom, effTo),
      getGrantedPermissions(),
      getLayawayDashboard(),
    ]);

  const scrapByMaterial = scrapIncome.ok ? scrapIncome.rows : [];

  return (
    <div>
      <PageHeader
        title="Dashboard Profile"
      />

      <DashboardView
        counts={counts}
        metrics={metrics}
        scrapTotal={scrapTotal}
        scrapByMaterial={scrapByMaterial}
        layaway={layaway}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        canExport={permissions.has('export_data_reports')}
      />
    </div>
  );
}
