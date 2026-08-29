'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';
import { ScrapGroupView, groupScrapSales } from '@/components/scrap/scrap-group-view';
import { ScrapEntryModal } from '@/components/scrap/scrap-entry-modal';
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
  isOwner = false,
}: {
  income: ScrapIncomeResult;
  sales: ScrapSaleRow[];
  from: string;
  to: string;
  /** Owner / Selected Admin — shows the per-row Edit + Delete. */
  canDelete?: boolean;
  /** Owner deletes directly; a non-owner Admin requests Owner approval. */
  isOwner?: boolean;
}) {
  const money = usePrivacyMoney();
  const [showRecord, setShowRecord] = useState(false);
  // Guards a repeat Export click while the file is being built.
  const [exporting, setExporting] = useState(false);

  // Group the per-piece rows into ONE row per transaction — same Customer Name +
  // Sold On date — so a customer's whole sale is a single row even with many pieces
  // (Owner request 2026-08-09); the View popup lists the pieces like a multi-item
  // Order. The per-material income totals above are unchanged (still summed per row).
  const groups = useMemo(() => groupScrapSales(sales), [sales]);

  // Search the grouped transactions by Customer Name or Contact Number (client-side
  // over the loaded rows, honestly labelled).
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

  // Render pagination (25/page) — windows the rendered GROUPS; resets on a new range
  // or search.
  const [scrapPage, setScrapPage] = useState(1);
  const [scrapPageSize, setScrapPageSize] = useState(25);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScrapPage(1);
  }, [sales, search]);
  const scrapPageCount = Math.max(1, Math.ceil(filteredGroups.length / scrapPageSize));
  const scrapPageSafe = Math.min(scrapPage, scrapPageCount);
  const pagedGroups = filteredGroups.slice(
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
      {/* Page title. The ＋ Add New / Export CSV actions live on the right of the
          Scrap income card header below. */}
      <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
        Scrap
      </h1>

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
                <Input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={from}
                  className="h-8"
                />
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
                  value={money(r.totalAmount)}
                  accent={r.material === 'gold'}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record a scrap sale — multi-item "New Entry" style dialog. */}
      <ScrapEntryModal
        open={showRecord}
        onClose={() => setShowRecord(false)}
        soldOnDefault={to}
      />

      {/* Recent scrap sales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scrap sales</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Full-width search — same length + style as the Orders search bar. */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name or contact number"
            aria-label="Search scrap sales"
            data-testid="scrap-search"
            className="mb-3 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
          />
          {/* Built from the shared table components (the reference migration). */}
          <DataTable
            minWidth="960px"
            spacious
            columns={['17%', '14%', '12%', '11%', '13%', '12%', '10%', '11%']}
          >
            <Thead>
              <Tr plain>
                <Th kind="center">Customer Name</Th>
                <Th kind="center">Contact Number</Th>
                <Th kind="center">Material</Th>
                <Th kind="center">Grams</Th>
                <Th kind="center">Amount</Th>
                <Th kind="center">Sold On</Th>
                <Th kind="center">Note</Th>
                <Th kind="center">Actions</Th>
              </Tr>
            </Thead>
            <tbody>
              {filteredGroups.length === 0 ? (
                <EmptyRow colSpan={8}>
                  {search.trim()
                    ? 'No scrap sales match your search.'
                    : 'No scrap sales recorded.'}
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
                    <Td
                      kind="center"
                      clip
                      title={g.note ?? undefined}
                      className="text-muted-foreground"
                    >
                      {g.note ?? '—'}
                    </Td>
                    <Td kind="center">
                      <ScrapGroupView group={g} canManage={canDelete} isOwner={isOwner} />
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </DataTable>
          {filteredGroups.length > 0 ? (
            <Pagination
              page={scrapPageSafe}
              pageCount={scrapPageCount}
              total={filteredGroups.length}
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
