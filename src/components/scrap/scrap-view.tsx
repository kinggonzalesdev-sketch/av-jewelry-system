'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { recordScrapAction } from '@/lib/scrap/actions';
import { EMPTY_SCRAP_STATE, type ScrapActionState } from '@/lib/scrap/action-state';
import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';
import { formatPeso } from '@/lib/payments/format';
import { MetricCard, ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFormGrid } from '@/components/ui/modal';

/**
 * Scrap income (Bible §G). Record a scrap gold/silver sale, and see the income
 * totals per material for a date range. Every peso is summed in SQL; the record
 * form validates but never does money math on the stored value.
 */
export function ScrapView({
  income,
  sales,
  from,
  to,
}: {
  income: ScrapIncomeResult;
  sales: ScrapSaleRow[];
  from: string;
  to: string;
}) {
  const [state, action, pending] = useActionState<ScrapActionState, FormData>(
    recordScrapAction,
    EMPTY_SCRAP_STATE,
  );

  const [showRecord, setShowRecord] = useState(false);
  // Close the dialog once a sale records (once per new success).
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setShowRecord(false);
    }
  }, [state.success]);

  return (
    <div className="space-y-4">
      {/* Primary action opens the standard dialog — never an inline page form. */}
      <div className="flex justify-end">
        <Button type="button" onClick={() => setShowRecord(true)}>
          ＋ Record scrap sale
        </Button>
      </div>

      {/* Income summary per material */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scrap income</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
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

      {/* Record a scrap sale — standard centered dialog. */}
      <Modal
        open={showRecord}
        onClose={() => setShowRecord(false)}
        title="Record a scrap sale"
        description="Separate gold/silver income. Amount is stored as entered; totals are summed in SQL."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setShowRecord(false)}>
              Cancel
            </Button>
            <Button type="submit" form="scrap-record-form" disabled={pending}>
              {pending ? 'Recording…' : 'Record scrap sale'}
            </Button>
          </>
        }
      >
        <form id="scrap-record-form" action={action} className="space-y-3">
          <ModalFormGrid>
            <div>
              <Label htmlFor="material" className="text-xs">
                Material
              </Label>
              <select
                id="material"
                name="material"
                required
                defaultValue="gold"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
            </div>
            <div>
              <Label htmlFor="soldOn" className="text-xs">
                Sold on
              </Label>
              <Input
                id="soldOn"
                name="soldOn"
                type="date"
                defaultValue={to}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor="grams" className="text-xs">
                Grams
              </Label>
              <Input
                id="grams"
                name="grams"
                type="number"
                step="0.001"
                min="0.001"
                required
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor="amount" className="text-xs">
                Amount
              </Label>
              <MoneyInput id="amount" name="amount" required className="mt-1 h-9" />
            </div>
            <div>
              <Label htmlFor="buyer" className="text-xs">
                Buyer (optional)
              </Label>
              <Input id="buyer" name="buyer" className="mt-1 h-9" />
            </div>
            <div>
              <Label htmlFor="note" className="text-xs">
                Note (optional)
              </Label>
              <Input id="note" name="note" className="mt-1 h-9" />
            </div>
          </ModalFormGrid>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>

      {/* Recent scrap sales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scrap sales</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Fixed columns mirroring the Record-a-Scrap-Sale form. The headers stay
              visible even with no data — an empty state is a single full-width row,
              never a large empty box. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-2 font-medium">Material</th>
                  <th className="px-2.5 py-2 text-right font-medium">Grams</th>
                  <th className="px-2.5 py-2 text-right font-medium">Amount</th>
                  <th className="px-2.5 py-2 font-medium">Buyer</th>
                  <th className="px-2.5 py-2 font-medium">Sold On</th>
                  <th className="px-2.5 py-2 font-medium">Note</th>
                  <th className="px-2.5 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sales.length === 0 ? (
                  <tr className="border-b last:border-0">
                    <td
                      colSpan={7}
                      className="px-2.5 py-6 text-center text-muted-foreground"
                    >
                      No scrap sales recorded.
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-2.5 py-2 capitalize">{s.material}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums">{s.grams}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums">
                        {formatPeso(s.amount)}
                      </td>
                      <td className="px-2.5 py-2">{s.buyer ?? '—'}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{s.soldOn}</td>
                      <td className="px-2.5 py-2 text-muted-foreground">{s.note ?? '—'}</td>
                      <td className="px-2.5 py-2 text-right text-muted-foreground">—</td>
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
