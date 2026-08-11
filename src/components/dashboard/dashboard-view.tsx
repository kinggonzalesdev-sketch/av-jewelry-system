'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';

import { refreshDashboardAction } from '@/lib/dashboard/actions';
import type { DashboardActionState } from '@/lib/dashboard/action-state';
import { EMPTY_DASHBOARD_STATE } from '@/lib/dashboard/action-state';
import type {
  DashboardCounts,
  DashboardMetrics,
  SalesByChannel,
} from '@/lib/dashboard/service';
import type { ScrapIncomeRow, ScrapTotal } from '@/lib/scrap/service';
import type { LayawayDashboard } from '@/lib/payments/layaway-ledger';
import { formatPeso } from '@/lib/payments/format';
import { ExportAllButton } from '@/components/export/export-all-button';
import { usePrivacy } from '@/components/shell/privacy';
import { useDashboardSync } from '@/components/shell/dashboard-sync';
import { ColumnChart } from '@/components/ui/column-chart';
import { DonutChart } from '@/components/ui/donut-chart';
import { MetricCard, ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Dashboard Profile — the approved prototype's Dashboard Report structure, backed
 * by REAL aggregation (Bible §7, §23, §25, §26, §31; FINAL-UI-SOURCE-OF-TRUTH §4).
 *
 * A single, untabbed page: a date-range selector with the current range shown,
 * Refresh and Export Reports, then the metric cards, charts and summaries.
 *
 * Follow-ups, Search, Reminders, Audit and the Sales-summary REPORT were all
 * removed from THIS page by Owner request, which left one tab and so no tab bar at
 * all. None of the underlying features were deleted: the audit trail, reminder
 * records, follow-up queue, global search and the report action all still exist
 * and still run where they are actually used. Export Reports stays, and now
 * performs the real export here instead of opening a tab that no longer exists.
 *
 * Honesty that must not regress:
 *   - Every figure is real aggregation. A FAILED read shows an explicit error,
 *     never a false zero (ReadError).
 *   - Charts stay VISIBLE at zero: the categories/axis render and the plot area
 *     says "No data for this period" — the container is never hidden.
 *   - The ORDER TILES ARE DISJOINT: an Active Layaway IS an Official Order and
 *     appears in exactly one bucket; the tiles sum to the total.
 *   - Gross Profit is honest-unavailable: no cost/COGS rules exist, so no numbers
 *     are invented.
 */

// Date-range presets. Each resolves to concrete {from, to} ISO days (or null for
// "all time"). The selected range lives in the URL so the server re-scopes EVERY
// money figure to it — not just the trend chart.
const RANGE_PRESETS = [
  { key: 'all', label: 'All time', days: null },
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '14d', label: 'Last 14 days', days: 14 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'month', label: 'This Month', days: 0 },
] as const;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Resolve a preset to concrete inclusive {from, to}, or null for all time. */
function presetRange(key: string): { from: string; to: string } | null {
  if (key === 'all') return null;
  const today = new Date();
  const to = isoDay(today);
  if (key === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: isoDay(first), to };
  }
  const days = RANGE_PRESETS.find((r) => r.key === key)?.days ?? 30;
  const start = new Date(today);
  start.setDate(start.getDate() - ((days ?? 30) - 1));
  return { from: isoDay(start), to };
}

/**
 * Convert a money STRING to a Number for bar-WIDTH scaling ONLY — never shown.
 * The authoritative peso string is always what's displayed (BarChart `display`),
 * so no money figure is ever a JS float. This is the same width-only role the
 * server-computed collectionTrend `weight` plays for the Sales chart.
 */
function moneyWeight(amount: string): number {
  const n = Number(amount);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** One Sales-by-Channel tile: channel name, total (privacy-masked), and order count. */
function ChannelTile({
  label,
  amount,
  count,
  money,
}: {
  label: string;
  amount: string;
  count: number;
  money: (a: string) => string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card/60 p-3 text-center">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{money(amount)}</p>
      <p className="text-[11px] text-muted-foreground">
        {count} order{count === 1 ? '' : 's'}
      </p>
    </div>
  );
}

/**
 * Add peso strings as EXACT integer centavos — never through a JS float.
 *
 * Layaway money lives in TWO places: order-derived arrangements (`metrics.*`) and
 * the imported layaway ledger (`layaway.*`). They are disjoint sets, so the true
 * figure is their sum. Reading only the arrangements made the Layaway chart show
 * "No data yet" while hundreds of imported accounts sat in the ledger.
 */
function sumMoney(...values: Array<string | null | undefined>): string {
  let cents = 0n;
  for (const v of values) {
    if (!v) continue;
    const negative = v.trim().startsWith('-');
    const clean = v.replace(/[^\d.]/g, '');
    const [whole = '0', fraction = ''] = clean.split('.');
    const c = BigInt(whole || '0') * 100n + BigInt(`${fraction}00`.slice(0, 2) || '0');
    cents += negative ? -c : c;
  }
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function DashboardView({
  counts,
  metrics,
  salesByChannel,
  scrapTotal,
  scrapByMaterial,
  layaway,
  rangeFrom,
  rangeTo,
  canExport,
}: {
  counts: DashboardCounts | null;
  metrics: DashboardMetrics | null;
  salesByChannel: SalesByChannel | null;
  scrapTotal: ScrapTotal;
  scrapByMaterial: ScrapIncomeRow[];
  layaway: LayawayDashboard;
  rangeFrom?: string | undefined;
  rangeTo?: string | undefined;
  canExport: boolean;
}) {
  const router = useRouter();
  // Privacy Mode (§7): every financial figure on the dashboard masks to dots when
  // the user hides sensitive info. Display-only — the data is unchanged.
  const { hidden } = usePrivacy();
  const money = (amount: string): string => (hidden ? '₱••••••' : formatPeso(amount));
  // The active range comes from the URL (props). Custom inputs are local until applied.
  const isAllTime = !rangeFrom && !rangeTo;
  const [customFrom, setCustomFrom] = useState(rangeFrom ?? '');
  const [customTo, setCustomTo] = useState(rangeTo ?? '');

  // Navigate to a range (or all time). The server re-scopes every money figure.
  const goRange = (next: { from: string; to: string } | null) => {
    const sp = new URLSearchParams();
    if (next) {
      sp.set('from', next.from);
      sp.set('to', next.to);
    }
    const qs = sp.toString();
    router.push(qs ? `/dashboard?${qs}` : '/dashboard');
  };

  // Which preset (if any) the current URL range matches — for highlighting.
  const activePreset = (key: string): boolean => {
    const p = presetRange(key);
    if (!p) return isAllTime;
    return rangeFrom === p.from && rangeTo === p.to;
  };
  const isCustom =
    !isAllTime && !RANGE_PRESETS.some((r) => r.key !== 'all' && activePreset(r.key));

  const [refreshState, refresh, refreshing] = useActionState<
    DashboardActionState,
    FormData
  >(refreshDashboardAction, EMPTY_DASHBOARD_STATE);

  // Live reflection status (Realtime). Shows a subtle "syncing" pulse and the
  // last-updated time so the operator can trust the figures are current.
  const sync = useDashboardSync();
  const lastUpdated =
    sync.lastSyncedAt != null ? new Date(sync.lastSyncedAt).toLocaleTimeString() : null;

  const notices = [refreshState];

  return (
    <div className="space-y-4">
      {/* ---- Header: date range + current range + Refresh + Export ---------- */}
      <Card>
        <CardContent className="space-y-2.5 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGE_PRESETS.map((r) => (
              <Button
                key={r.key}
                type="button"
                size="sm"
                variant={activePreset(r.key) ? 'default' : 'outline'}
                aria-pressed={activePreset(r.key)}
                onClick={() => goRange(presetRange(r.key))}
                data-testid={`dash-range-${r.key}`}
              >
                {r.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant={isCustom ? 'default' : 'outline'}
              aria-pressed={isCustom}
              onClick={() =>
                goRange({
                  from: customFrom || rangeFrom || isoDay(new Date()),
                  to: customTo || rangeTo || isoDay(new Date()),
                })
              }
              data-testid="dash-range-custom"
            >
              Custom
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <span
                className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                data-testid="dash-live-status"
                title={
                  lastUpdated
                    ? `Live — last updated ${lastUpdated}`
                    : 'Live — updates automatically'
                }
              >
                <span
                  className={cn(
                    'inline-block h-1.5 w-1.5 rounded-full',
                    sync.isSyncing ? 'animate-pulse bg-amber-500' : 'bg-green-500',
                  )}
                  aria-hidden
                />
                {sync.isSyncing
                  ? 'Syncing…'
                  : lastUpdated
                    ? `Updated ${lastUpdated}`
                    : 'Live'}
              </span>
              <form action={refresh}>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={refreshing}
                  onClick={() => sync.refresh()}
                >
                  {refreshing ? 'Refreshing…' : '⟳ Refresh'}
                </Button>
              </form>
              {/* Export Reports used to do nothing but switch to the removed
                  Reports tab. It now performs the REAL export in place — the same
                  server-generated workbook the Reports page downloads — rather
                  than bouncing the user to another screen. Hidden without the
                  permission; the API route re-checks regardless. */}
              {canExport ? (
                <ExportAllButton
                  label="⭳ Export Reports"
                  testId="dash-export"
                  size="sm"
                />
              ) : null}
            </div>
          </div>

          <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto] lg:max-w-lg">
            <div>
              <Label htmlFor="range-from" className="text-xs">
                Start date
              </Label>
              <Input
                id="range-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8"
              />
            </div>
            <div>
              <Label htmlFor="range-to" className="text-xs">
                End date
              </Label>
              <Input
                id="range-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8"
              />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!customFrom || !customTo}
              onClick={() => goRange({ from: customFrom, to: customTo })}
              data-testid="dash-range-apply"
            >
              Apply
            </Button>
          </div>

          <p className="text-xs text-muted-foreground" data-testid="dash-range-active">
            {isAllTime ? (
              <>
                Showing <strong className="text-foreground">all time</strong>.
              </>
            ) : (
              <>
                Showing <strong className="text-foreground">{rangeFrom}</strong> to{' '}
                <strong className="text-foreground">{rangeTo}</strong>.
              </>
            )}{' '}
            The range scopes the sales, layaway, and scrap figures and charts. Operational
            counts below reflect current state; export stays permission-gated.
          </p>
        </CardContent>
      </Card>

      {notices.map((n, i) =>
        n.error ? (
          <p key={`e${i}`} role="alert" className="text-sm text-destructive">
            {n.error}
          </p>
        ) : null,
      )}
      {notices.map((n, i) =>
        n.success ? (
          <p key={`s${i}`} className="text-sm text-muted-foreground">
            {n.success}
          </p>
        ) : null,
      )}

      {metrics === null || counts === null ? (
        <ReadError
          title="Dashboard could not be loaded"
          detail="The dashboard totals or counts could not be read."
        />
      ) : (
        <div className="space-y-4">
          {/* Metric cards — real business totals. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <MetricCard label="Total Sales" value={money(metrics.totalSales)} accent />
            <MetricCard
              label="Verified Collections"
              value={money(metrics.verifiedCollections)}
            />
            <MetricCard
              label="Outstanding Balance"
              value={money(metrics.outstandingBalance)}
            />
            <MetricCard label="Sales Today" value={money(metrics.salesToday)} />
            <MetricCard label="Sales This Week" value={money(metrics.salesWeek)} />
            <MetricCard label="Sales This Month" value={money(metrics.salesMonth)} />
          </div>

          {/* Sales by Channel — total order value split by how it's fulfilled:
                Walk In / Pick Up / Rider / Shipment (Owner request). Real SQL sums
                scoped to the selected range; excludes cancelled + test orders. */}
          {salesByChannel ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Sales by Channel</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <ChannelTile
                    label="Walk In"
                    amount={salesByChannel.walkIn}
                    count={salesByChannel.walkInCount}
                    money={money}
                  />
                  <ChannelTile
                    label="Pick Up"
                    amount={salesByChannel.pickup}
                    count={salesByChannel.pickupCount}
                    money={money}
                  />
                  <ChannelTile
                    label="Rider"
                    amount={salesByChannel.rider}
                    count={salesByChannel.riderCount}
                    money={money}
                  />
                  <ChannelTile
                    label="Shipment"
                    amount={salesByChannel.shipment}
                    count={salesByChannel.shipmentCount}
                    money={money}
                  />
                </div>
                {salesByChannel.otherCount > 0 ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Plus {money(salesByChannel.other)} from {salesByChannel.otherCount}{' '}
                    order(s) not yet routed to a channel (or kept in store).
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* The 14-card Layaway grid was removed by Owner request. The layaway
                figures themselves are unchanged and still live below (the Layaway
                chart and the Layaway summary card) and in the Layaway module. */}

          {/* ===== Colourful visual overview (Owner request 2026-07-22) =====
                Income mix as a donut, then General / Layaway / Scrap as colourful
                column charts. All real SQL totals; the donut's percentages and the
                bar heights are proportions, while every peso figure shown is the
                authoritative amount. Visible at zero, never hidden. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Income mix — Sales · Layaway · Scrap
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DonutChart
                  ariaLabel="Income mix: total sales, layaway, and scrap"
                  data={[
                    {
                      label: 'Total Sales',
                      value: moneyWeight(metrics.totalSales),
                      display: money(metrics.totalSales),
                    },
                    {
                      label: 'Layaway',
                      value: moneyWeight(
                        sumMoney(metrics.totalLayawaySales, layaway.grandTotal),
                      ),
                      display: money(
                        sumMoney(metrics.totalLayawaySales, layaway.grandTotal),
                      ),
                    },
                    {
                      label: 'Scrap',
                      value: moneyWeight(scrapTotal.totalAmount),
                      display: money(scrapTotal.totalAmount),
                    },
                  ]}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Share of each income stream. Percentages are proportions of the total;
                  each peso value shown is authoritative.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">General</CardTitle>
              </CardHeader>
              <CardContent>
                <ColumnChart
                  ariaLabel="General sales figures"
                  data={[
                    {
                      label: 'Sales',
                      value: moneyWeight(metrics.totalSales),
                      display: money(metrics.totalSales),
                    },
                    {
                      label: 'Verified',
                      value: moneyWeight(metrics.verifiedCollections),
                      display: money(metrics.verifiedCollections),
                    },
                    {
                      label: 'Outstanding',
                      value: moneyWeight(metrics.outstandingBalance),
                      display: money(metrics.outstandingBalance),
                    },
                    {
                      label: 'This Month',
                      value: moneyWeight(metrics.salesMonth),
                      display: money(metrics.salesMonth),
                    },
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Layaway</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Layaway money = order-derived arrangements + the imported
                      ledger. The two sets are disjoint, so the sum is the truth. */}
                <ColumnChart
                  ariaLabel="Layaway figures"
                  data={[
                    {
                      label: 'Sales',
                      value: moneyWeight(
                        sumMoney(metrics.totalLayawaySales, layaway.grandTotal),
                      ),
                      display: money(
                        sumMoney(metrics.totalLayawaySales, layaway.grandTotal),
                      ),
                    },
                    {
                      label: 'Collections',
                      value: moneyWeight(
                        sumMoney(metrics.layawayCollections, layaway.totalPayment),
                      ),
                      display: money(
                        sumMoney(metrics.layawayCollections, layaway.totalPayment),
                      ),
                    },
                    {
                      label: 'Forfeited',
                      value: moneyWeight(metrics.forfeitedAmount),
                      display: money(metrics.forfeitedAmount),
                    },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scrap — gold vs silver</CardTitle>
              </CardHeader>
              <CardContent>
                <ColumnChart
                  ariaLabel="Scrap income by material"
                  noDataLabel="No scrap yet"
                  data={
                    scrapByMaterial.length > 0
                      ? scrapByMaterial.map((r) => ({
                          label: r.material === 'gold' ? 'Gold' : 'Silver',
                          value: moneyWeight(r.totalAmount),
                          display: money(r.totalAmount),
                        }))
                      : [
                          { label: 'Gold', value: 0, display: money('0') },
                          { label: 'Silver', value: 0, display: money('0') },
                        ]
                  }
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  Scrap income by material. Full detail is in the Scrap details table
                  below.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Layaway summary — real money aggregation. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Layaway</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {/* Active Layaway comes from the Layaway module (imported ledger +
                      order-derived arrangements, already summed by
                      layaway_dashboard_metrics). The old order-only count read 0 for
                      a shop whose layaways all live in the ledger. */}
                <MetricCard label="Active Layaway" value={layaway.active} accent />
                <MetricCard
                  label="Layaway Sales"
                  value={money(sumMoney(metrics.totalLayawaySales, layaway.grandTotal))}
                />
                <MetricCard
                  label="Layaway Collections"
                  value={money(
                    sumMoney(metrics.layawayCollections, layaway.totalPayment),
                  )}
                />
                <MetricCard
                  label="Forfeited Amount"
                  value={money(metrics.forfeitedAmount)}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {metrics.totalOfficialOrders} Official Orders. An Active Layaway is an
                Official Order — never double-counted. Forfeiture needs Owner approval; no
                automatic stock return.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
