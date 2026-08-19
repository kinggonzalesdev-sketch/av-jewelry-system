import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { canOpenPage } from '@/lib/authz/guard';
import { HistoricalScrapReport } from '@/components/scrap/historical-scrap-report';
import { getScrapIncome, getScrapTotal, listScrapSales } from '@/lib/scrap/service';

export const metadata: Metadata = {};
export const dynamic = 'force-dynamic';

/**
 * Historical Scrap Report (Req 15) — the scrap sold BEFORE the go-live cutoff, produced
 * SEPARATELY from the Daily Cash Summary. Those rows are deliberately excluded from the
 * Daily Cash scrap cash-out (go-live 2026-08-17) so past daily figures are never silently
 * recalculated; this page reports them read-only for the record.
 *
 * The pre-cutoff window is FIXED. Both scrap readers use `sold_on between p_from and p_to`
 * (inclusive), so the TO bound is the day BEFORE the cutoff — i.e. `sold_on < 2026-08-17`.
 */
const CUTOFF_LABEL = 'August 17, 2026';
const HISTORICAL_FROM = '2000-01-01';
const HISTORICAL_TO = '2026-08-16'; // through the day before go-live (inclusive)

export default async function HistoricalScrapPage() {
  // Same page gate as the live Scrap page — a member without `nav_scrap` cannot open it
  // by link or by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('nav_scrap'))) notFound();

  const [total, income, sales] = await Promise.all([
    getScrapTotal(HISTORICAL_FROM, HISTORICAL_TO),
    getScrapIncome(HISTORICAL_FROM, HISTORICAL_TO),
    listScrapSales(1000, { from: HISTORICAL_FROM, to: HISTORICAL_TO }),
  ]);

  return (
    <div>
      <HistoricalScrapReport
        total={total}
        income={income}
        sales={sales}
        cutoffLabel={CUTOFF_LABEL}
      />
    </div>
  );
}
