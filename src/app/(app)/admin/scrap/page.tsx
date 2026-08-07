import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { canOpenPage, getCurrentStaffProfile } from '@/lib/authz/guard';

import { ScrapView } from '@/components/scrap/scrap-view';
import { getScrapIncome, listScrapSales } from '@/lib/scrap/service';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Scrap Income (Bible §G) — a separate income report for scrap gold/silver, kept
 * apart from item sales. Reachable under Settings → Administration.
 */
export default async function ScrapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('nav_scrap'))) notFound();
  const params = await searchParams;
  const from = typeof params.from === 'string' ? params.from : firstOfMonth();
  const to = typeof params.to === 'string' ? params.to : today();

  // Scope the sales to the SELECTED range so the table and the CSV export show
  // exactly the same rows — an export must never include a record outside it.
  const [income, sales, staff] = await Promise.all([
    getScrapIncome(from, to),
    listScrapSales(500, { from, to }),
    getCurrentStaffProfile(),
  ]);

  return (
    <div>
      <ScrapView
        income={income}
        sales={sales}
        from={from}
        to={to}
        canDelete={staff.roleKey === 'owner' || staff.roleKey === 'selected_admin'}
      />
    </div>
  );
}
