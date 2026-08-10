import type { Metadata } from 'next';

import { requirePermission } from '@/lib/authz/guard';
import { getDailyCashSummary, getWalkIns } from '@/lib/cash/service';
import { DailyCashView } from '@/components/cash/daily-cash-view';

export const metadata: Metadata = {};
export const dynamic = 'force-dynamic';

/** Today's date in the shop's timezone (Asia/Manila), as YYYY-MM-DD. */
function todayInManila(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/**
 * Daily Cash Summary (Owner-approved 2026-08-10). Financial reconciliation for one day:
 * the summary totals + Cash Breakdown + End-of-Day are aggregated server-side from the
 * canonical records; the Details tabs lazy-load. Gated on view_reports; the page
 * re-checks the key server-side regardless of nav visibility.
 */
export default async function DailyCashPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requirePermission('view_reports');
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') ? (sp.date as string) : todayInManila();

  // Summary + the DEFAULT tab (Sales Walk-ins) render server-side; other tabs lazy-load.
  const [summary, firstTab] = await Promise.all([
    getDailyCashSummary(date),
    getWalkIns(date, 1, 8),
  ]);

  return <DailyCashView date={date} summary={summary} initialWalkIns={firstTab} />;
}
