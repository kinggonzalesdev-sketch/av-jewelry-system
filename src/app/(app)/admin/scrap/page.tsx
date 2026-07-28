import type { Metadata } from 'next';

import { ScrapView } from '@/components/scrap/scrap-view';
import { PageHeader } from '@/components/ui/page-primitives';
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
  const params = await searchParams;
  const from = typeof params.from === 'string' ? params.from : firstOfMonth();
  const to = typeof params.to === 'string' ? params.to : today();

  const [income, sales] = await Promise.all([getScrapIncome(from, to), listScrapSales()]);

  return (
    <div>
      <PageHeader title="Scrap Income" />
      <ScrapView income={income} sales={sales} from={from} to={to} />
    </div>
  );
}
