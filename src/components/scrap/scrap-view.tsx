'use client';

import { useState } from 'react';

import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';
import { ScrapRowActions } from '@/components/scrap/scrap-row-actions';
import { ScrapEntryModal } from '@/components/scrap/scrap-entry-modal';
import { downloadCsv } from '@/lib/export/csv';
import { formatPeso } from '@/lib/payments/format';
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

      {/* Income summary per material — actions sit on the right of this card header. */}
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Scrap income</CardTitle>
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
          <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
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
          {/* Fixed columns mirroring the entry form. The headers stay visible even
              with no data — an empty state is a single full-width row. */}
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[820px] table-fixed text-left text-sm">
              <colgroup>
                <col style={{ width: '13%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Material</th>
                  <th className="px-3 py-2.5 text-center font-medium">Karat</th>
                  <th className="px-3 py-2.5 text-center font-medium">Grams</th>
                  <th className="px-3 py-2.5 pr-6 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-left font-medium">Customer Name</th>
                  <th className="px-3 py-2.5 text-center font-medium">Sold On</th>
                  <th className="px-3 py-2.5 text-left font-medium">Note</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.length === 0 ? (
                  <tr className="border-b last:border-0">
                    <td colSpan={8} className="px-2.5 py-6 text-center text-muted-foreground">
                      No scrap sales recorded.
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-3 py-2.5 capitalize">{s.material}</td>
                      <td className="px-3 py-2.5 text-center">{s.karat ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{s.grams}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 pr-6 text-right tabular-nums">
                        {formatPeso(s.amount)}
                      </td>
                      <td className="truncate px-3 py-2.5" title={s.buyer ?? undefined}>
                        {s.buyer ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-center">{s.soldOn}</td>
                      <td
                        className="truncate px-3 py-2.5 text-muted-foreground"
                        title={s.note ?? undefined}
                      >
                        {s.note ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <ScrapRowActions sale={s} canDelete={canDelete} canEdit={canDelete} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
