'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { ScrapIncomeResult, ScrapSaleRow, ScrapTotal } from '@/lib/scrap/service';
import { ScrapGroupView, groupScrapSales } from '@/components/scrap/scrap-group-view';
import { downloadCsv } from '@/lib/export/csv';
import { usePrivacyMoney } from '@/components/shell/privacy';
import {
  DataTable,
  Thead,
  Tr,
  Th,
  Td,
  DateCell,
  EmptyRow,
} from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { MetricCard, ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Historical Scrap Report (Req 15). A READ-ONLY report of the scrap sold BEFORE the
 * go-live cutoff — the rows deliberately excluded from the Daily Cash Summary's scrap
 * cash-out so that past daily figures are never silently recalculated. It is produced
 * SEPARATELY here: no Add / Edit / Delete, no date filter (the historical range is
 * fixed), so it can never alter live scrap data or the Daily Cash totals. Every peso is
 * summed in SQL upstream; this only displays and exports authoritative strings.
 */
export function HistoricalScrapReport({
  total,
  income,
  sales,
  cutoffLabel,
}: {
  /** Grand total (SQL-summed) for the whole pre-cutoff range. */
  total: ScrapTotal;
  /** Per-material breakdown (SQL-summed). */
  income: ScrapIncomeResult;
  /** The pre-cutoff rows, already scoped by the server. */
  sales: ScrapSaleRow[];
  /** Human date of the go-live cutoff, e.g. "August 17, 2026". */
  cutoffLabel: string;
}) {
  const money = usePrivacyMoney();
  const [exporting, setExporting] = useState(false);

  // Group the per-piece rows into ONE row per transaction (same Customer + Sold On),
  // exactly like the live Scrap page — the View popup lists the pieces read-only.
  const groups = useMemo(() => groupScrapSales(sales), [sales]);

  const [search, setSearch] = useState('');
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        (g.buyer ?? '').toLowerCase().includes(q) ||
        (g.contact ?? '').toLowerCase().includes(q),
    );
  }, [groups, search]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset to page 1 when the search narrows the list
    setPage(1);
  }, [search]);
  const pageCount = Math.max(1, Math.ceil(filteredGroups.length / pageSize));
  const pageSafe = Math.min(page, pageCount);
  const pagedGroups = filteredGroups.slice(
    (pageSafe - 1) * pageSize,
    pageSafe * pageSize,
  );

  /**
   * Export the full historical range as CSV. `sales` is already scoped to the
   * pre-cutoff range by the server, so nothing newer can leak in. Amounts / grams stay
   * RAW numeric strings so Excel can still sum them.
   */
  const exportSales = () => {
    if (exporting || sales.length === 0) return;
    setExporting(true);
    try {
      downloadCsv(
        `AV-Jewelry-Historical-Scrap-before-${cutoffLabel.replace(/[ ,]+/g, '-')}`,
        [
          { header: 'Material', value: (s) => s.material },
          { header: 'Karat', value: (s) => s.karat ?? '' },
          { header: 'Grams', value: (s) => s.grams },
          { header: 'Per Gram', value: (s) => s.perGram ?? '' },
          { header: 'Amount', value: (s) => s.amount },
          { header: 'Customer Name', value: (s) => s.buyer ?? '' },
          { header: 'Contact Number', value: (s) => s.contact ?? '' },
          { header: 'Mode of Payment', value: (s) => s.paymentMethod ?? '' },
          { header: 'Sold On', value: (s) => s.soldOn },
          { header: 'Note', value: (s) => s.note ?? '' },
        ],
        sales,
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Title + the read-only actions (Back / Export). No Add — this report never
          creates or edits scrap. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Historical Scrap Report
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Scrap sold before {cutoffLabel} (go-live). Reported separately here and
            excluded from the Daily Cash Summary, so past daily figures are never
            recalculated (Req 15). This report is read-only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/scrap"
            className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-accent"
            data-testid="scrap-historical-back"
          >
            ← Back to Scrap
          </Link>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={exporting || sales.length === 0}
            onClick={exportSales}
            data-testid="scrap-historical-export"
          >
            {exporting ? 'Preparing…' : '⭳ Export CSV'}
          </Button>
        </div>
      </div>

      {/* Totals — a grand total (all pre-cutoff scrap) + the per-material breakdown. */}
      <Card>
        <CardContent className="pt-6">
          <div
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            data-testid="scrap-historical-totals"
          >
            <MetricCard
              label={`Total Historical Scrap — ${total.saleCount} sale(s)`}
              value={money(total.totalAmount)}
              accent
            />
            {income.ok
              ? income.rows.map((r) => (
                  <MetricCard
                    key={r.material}
                    label={`${r.material === 'gold' ? 'Scrap Gold' : 'Scrap Silver'} — ${r.saleCount} sale(s), ${r.totalGrams}g`}
                    value={money(r.totalAmount)}
                  />
                ))
              : null}
          </div>
          {!income.ok ? (
            <div className="mt-2">
              <ReadError
                title="Breakdown unavailable"
                detail="The per-material totals could not be read."
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* The historical transactions — read-only (View only). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Historical scrap sales</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name or contact number"
            aria-label="Search historical scrap sales"
            data-testid="scrap-historical-search"
            className="mb-3 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
          />
          <DataTable
            minWidth="900px"
            spacious
            columns={['18%', '15%', '13%', '12%', '14%', '13%', '15%']}
          >
            <Thead>
              <Tr plain>
                <Th kind="center">Customer Name</Th>
                <Th kind="center">Contact Number</Th>
                <Th kind="center">Material</Th>
                <Th kind="center">Grams</Th>
                <Th kind="center">Amount</Th>
                <Th kind="center">Sold On</Th>
                <Th kind="center">Actions</Th>
              </Tr>
            </Thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <EmptyRow colSpan={7}>
                  {search.trim()
                    ? 'No historical scrap sales match your search.'
                    : 'No historical scrap sales.'}
                </EmptyRow>
              ) : (
                pagedGroups.map((g) => (
                  <Tr key={g.key}>
                    <Td kind="center" clip title={g.buyer ?? undefined}>
                      {g.buyer ?? '—'}
                    </Td>
                    <Td kind="center" clip title={g.contact ?? undefined}>
                      {g.contact ?? '—'}
                    </Td>
                    <Td kind="center">{g.materialsLabel}</Td>
                    <Td kind="center">{g.totalGrams}</Td>
                    <Td kind="center">{money(g.totalAmount)}</Td>
                    <DateCell value={g.soldOn} />
                    <Td kind="center">
                      {/* canManage=false → the popup is read-only (View only, no
                          Edit/Delete): a historical report never mutates scrap. */}
                      <ScrapGroupView group={g} canManage={false} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
          {filteredGroups.length > 0 ? (
            <Pagination
              page={pageSafe}
              pageCount={pageCount}
              total={filteredGroups.length}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(n) => {
                setPageSize(n);
                setPage(1);
              }}
              sticky
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
