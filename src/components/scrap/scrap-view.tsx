'use client';

import { useActionState } from 'react';

import { recordScrapAction } from '@/lib/scrap/actions';
import { EMPTY_SCRAP_STATE, type ScrapActionState } from '@/lib/scrap/action-state';
import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { MetricCard, ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

  return (
    <div className="space-y-4">
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

      {/* Record a scrap sale */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record a scrap sale</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="material" className="text-xs">
                Material
              </Label>
              <select
                id="material"
                name="material"
                required
                defaultValue="gold"
                className="mt-0.5 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
              </select>
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
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="amount" className="text-xs">
                Amount (₱)
              </Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                min="0"
                required
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="buyer" className="text-xs">
                Buyer (optional)
              </Label>
              <Input id="buyer" name="buyer" className="h-9" />
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
                className="h-9"
              />
            </div>
            <div>
              <Label htmlFor="note" className="text-xs">
                Note (optional)
              </Label>
              <Input id="note" name="note" className="h-9" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={pending}>
                {pending ? 'Recording…' : 'Record scrap sale'}
              </Button>
              {state.error ? (
                <span className="ml-3 text-sm text-destructive">{state.error}</span>
              ) : null}
              {state.success ? (
                <span className="ml-3 text-sm text-muted-foreground">
                  {state.success}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Recent scrap sales */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scrap sales</CardTitle>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <EmptyState title="No scrap sales recorded" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">Date</th>
                    <th className="px-2.5 py-2 font-medium">Material</th>
                    <th className="px-2.5 py-2 text-right font-medium">Grams</th>
                    <th className="px-2.5 py-2 text-right font-medium">Amount</th>
                    <th className="px-2.5 py-2 font-medium">Buyer</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="px-2.5 py-2">{s.soldOn}</td>
                      <td className="px-2.5 py-2 capitalize">{s.material}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums">{s.grams}</td>
                      <td className="px-2.5 py-2 text-right tabular-nums">
                        {formatPeso(s.amount)}
                      </td>
                      <td className="px-2.5 py-2">{s.buyer ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
