'use client';

import { useEffect, useState } from 'react';

import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';
import { ScrapRowActions } from '@/components/scrap/scrap-row-actions';
import { ScrapEntryModal } from '@/components/scrap/scrap-entry-modal';
import { downloadCsv } from '@/lib/export/csv';
import { formatPeso } from '@/lib/payments/format';
import { DataTable, Thead, Tr, Th, Td, DateCell, EmptyRow } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';
import { MetricCard, ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Scrap income (Bible §G). Record scrap gold/silver sales (the Orders "New Entry"
 * multi-item flow — one Customer Name, then each piece with Karat + Per Gram and an
 * auto-computed amount), and see the income totals per material for a date range.
 * Every peso is summed in SQL; the form validates but never does money math on the
 * stored value.
 */
export function ScrapView({
  income,
  sales,
  from,
  to,
  canDelete = false,
}: {
  income: ScrapIncomeResult;
  sales: ScrapSaleRow[];
  from: string;
  to: string;
  /** Owner / Selected Admin — shows the per-row Edit + Delete. */
  canDelete?: boolean;
}) {
  const [showRecord, setShowRecord] = useState(false);
  // Guards a repeat Export click while the file is being built.
  const [exporting, setExporting] = useState(false);

  // Render pagination (25/page) — windows the rendered rows; resets on a new date range.
  const [scrapPage, setScrapPage] = useState(1);
  const [scrapPageSize, setScrapPageSize] = useState(25);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScrapPage(1);
  }, [sales]);
  const scrapPageCount = Math.max(1, Math.ceil(sales.length / scrapPageSize));
  const scrapPageSafe = Math.min(scrapPage, scrapPageCount);
  const pagedSales = sales.slice(
    (scrapPageSafe - 1) * scrapPageSize,
    scrapPageSafe * scrapPageSize,
  );

  /**
   * Export the scrap sales for the SELECTED range. `sales` is already scoped to
   * from/to by the server, so nothing outside the range can leak in. Amounts and
   * grams stay RAW numeric strings so Excel can sum them — formatting them with a
   * peso sign would turn every figure into text.
   */
  const exportSales = () => {
    if (exporting || sales.length === 0) return;
    setExporting(true);
    try {
      downloadCsv(
        `MineFlow-Scrap-Sales-${new Date().toISOString().slice(0, 10)}`,
        [
          { header: 'Material', value: (s) => s.material },
          { header: 'Karat', value: (s) => s.karat ?? '' },
          { header: 'Grams', value: (s) => s.grams },
          { header: 'Per Gram', value: (s) => s.perGram ?? '' },
          { header: 'Amount', value: (s) => s.amount },
          { header: 'Customer Name', value: (s) => s.buyer ?? '' },
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
      {/* Page title. The ＋ Add New / Export CSV actions live on the right of the
          Scrap income card header below. */}
      <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Scrap</h1>

      {/* Income summary — title + date filter on the LEFT of the header, ＋ Add New /
          Export CSV on the RIGHT; the per-material totals are the card body. */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <div className="flex flex-wrap items-end gap-3">
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="from" className="text-xs">
                  From
                </Label>
                <Input id="from" name="from" type="date" defaultValue={from} className="h-8" />
              </div>
              <div>
                <Label htmlFor="to" className="text-xs">
                  To
                </Label>
                <Input id="to" name="to" type="date" defaultValue={to} className="h-8" />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Apply
              </Button>
            </form>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => setShowRecord(true)}
              data-testid="scrap-record-open"
            >
              ＋ Add New
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={exporting || sales.length === 0}
              onClick={exportSales}
              data-testid="scrap-export"
            >
              {exporting ? 'Preparing…' : '⭳ Export CSV'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!income.ok ? (
            <ReadError
              title="Scrap income unavailable"
              detail="The scrap totals could not be read."
            />
          ) : (
            <div
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              data-testid="scrap-income"
            >
              {income.rows.map((r) => (
                <MetricCard
                  key={r.material}
                  label={`${r.material === 'gold' ? 'Scrap Gold' : 'Scrap Silver'} — ${r.saleCount} sale(s), ${r.totalGrams}g`}
                  value={formatPeso(r.totalAmount)}
                  accent={r.material === 'gold'}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record a scrap sale — multi-item "New Entry" style dialog. */}
      <ScrapEntryModal open={showRecord} onClose={() => setShowRecord(false)} soldOnDefault={to} />

      {/* Recent scrap sales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scrap sales</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Built from the shared table components (the reference migration). */}
          <DataTable
            minWidth="880px"
            spacious
            columns={['15%', '13%', '12%', '10%', '13%', '12%', '10%', '15%']}
          >
            <Thead>
              <Tr plain>
                <Th kind="center">Customer Name</Th>
                <Th kind="center">Material</Th>
                <Th kind="center">Karat</Th>
                <Th kind="center">Grams</Th>
                <Th kind="center">Amount</Th>
                <Th kind="center">Sold On</Th>
                <Th kind="center">Note</Th>
                <Th kind="center">Actions</Th>
              </Tr>
            </Thead>
            <tbody>
              {sales.length === 0 ? (
                <EmptyRow colSpan={8}>No scrap sales recorded.</EmptyRow>
              ) : (
                pagedSales.map((s) => (
                  <Tr key={s.id}>
                    <Td kind="center" clip title={s.buyer ?? undefined}>
                      {s.buyer ?? '—'}
                    </Td>
                    <Td kind="center" className="capitalize">
                      {s.material}
                    </Td>
                    <Td kind="center">{s.karat ?? '—'}</Td>
                    <Td kind="center">{s.grams}</Td>
                    <Td kind="center">{formatPeso(s.amount)}</Td>
                    <DateCell value={s.soldOn} />
                    <Td
                      kind="center"
                      clip
                      title={s.note ?? undefined}
                      className="text-muted-foreground"
                    >
                      {s.note ?? '—'}
                    </Td>
                    <Td kind="center">
                      <ScrapRowActions sale={s} canDelete={canDelete} canEdit={canDelete} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
          {sales.length > 0 ? (
            <Pagination
              page={scrapPageSafe}
              pageCount={scrapPageCount}
              total={sales.length}
              pageSize={scrapPageSize}
              onPageChange={setScrapPage}
              onPageSizeChange={(n) => {
                setScrapPageSize(n);
                setScrapPage(1);
              }}
              sticky
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
