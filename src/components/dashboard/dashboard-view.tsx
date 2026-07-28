'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  acknowledgeNotificationAction,
  refreshDashboardAction,
  runSalesReportAction,
} from '@/lib/dashboard/actions';
import type { DashboardActionState } from '@/lib/dashboard/action-state';
import { EMPTY_DASHBOARD_STATE } from '@/lib/dashboard/action-state';
import type {
  AuditRow,
  DashboardCounts,
  DashboardMetrics,
  NotificationRow,
  SearchResult,
} from '@/lib/dashboard/service';
import type { FollowUpQueue } from '@/lib/followups/service';
import type { MoneyInTransitResult } from '@/lib/finance/money-in-transit';
import type { ScrapIncomeRow, ScrapSaleRow, ScrapTotal } from '@/lib/scrap/service';
import type { LayawayDashboard } from '@/lib/payments/layaway-ledger';
import { formatPeso } from '@/lib/payments/format';
import { usePrivacy } from '@/components/shell/privacy';
import { EmptyState } from '@/components/states/empty-state';
import { FollowUpCards } from '@/components/dashboard/follow-up-cards';
import { BarChart } from '@/components/ui/bar-chart';
import { ColumnChart } from '@/components/ui/column-chart';
import { DonutChart } from '@/components/ui/donut-chart';
import { MetricCard, ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Dashboard Profile — the approved prototype's Dashboard Report structure, backed
 * by REAL aggregation (Bible §7, §23, §25, §26, §31; FINAL-UI-SOURCE-OF-TRUTH §4).
 *
 * Restored to match the /preview prototype: two primary tabs (Dashboard, Gross
 * Profit), a date-range selector with the current range shown, Refresh, and
 * Export Reports; metric cards, an Order Status chart, and a Sales for the Period
 * chart. The existing real Reports / Search / Reminders / Audit functionality is
 * RETAINED (regression rule — never removed).
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

const TABS = [
  'Dashboard',
  'Follow-ups',
  'Reports',
  'Search',
  'Reminders',
  'Audit',
] as const;
type Tab = (typeof TABS)[number];

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

export function DashboardView({
  counts,
  metrics,
  notifications,
  audit,
  results,
  query,
  followUps,
  moneyInTransit,
  scrapTotal,
  scrapSales,
  scrapByMaterial,
  layaway,
  rangeFrom,
  rangeTo,
  canExport,
  canVerifyPayments,
  canMonitorInventory,
}: {
  counts: DashboardCounts | null;
  metrics: DashboardMetrics | null;
  notifications: NotificationRow[];
  audit: AuditRow[];
  results: SearchResult[];
  query: string;
  followUps: FollowUpQueue;
  moneyInTransit: MoneyInTransitResult;
  scrapTotal: ScrapTotal;
  scrapSales: ScrapSaleRow[];
  scrapByMaterial: ScrapIncomeRow[];
  layaway: LayawayDashboard;
  rangeFrom?: string | undefined;
  rangeTo?: string | undefined;
  canExport: boolean;
  canVerifyPayments: boolean;
  canMonitorInventory: boolean;
}) {
  const router = useRouter();
  // Privacy Mode (§7): every financial figure on the dashboard masks to dots when
  // the user hides sensitive info. Display-only — the data is unchanged.
  const { hidden } = usePrivacy();
  const money = (amount: string): string => (hidden ? '₱••••••' : formatPeso(amount));
  const [tab, setTab] = useState<Tab>('Dashboard');
  // The active range comes from the URL (props). Custom inputs are local until applied.
  const isAllTime = !rangeFrom && !rangeTo;
  const [customFrom, setCustomFrom] = useState(rangeFrom ?? '');
  const [customTo, setCustomTo] = useState(rangeTo ?? '');

  // Navigate to a range (or all time). The server re-scopes every money figure.
  const goRange = (next: { from: string; to: string } | null) => {
    const sp = new URLSearchParams();
    if (query) sp.set('q', query);
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
  const [ackState, acknowledge, acking] = useActionState<DashboardActionState, FormData>(
    acknowledgeNotificationAction,
    EMPTY_DASHBOARD_STATE,
  );
  const [reportState, runReport, running] = useActionState<
    DashboardActionState,
    FormData
  >(runSalesReportAction, EMPTY_DASHBOARD_STATE);

  const notices = [refreshState, ackState, reportState];

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
              <form action={refresh}>
                <Button type="submit" size="sm" variant="outline" disabled={refreshing}>
                  {refreshing ? 'Refreshing…' : '⟳ Refresh'}
                </Button>
              </form>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setTab('Reports')}
                data-testid="dash-export"
              >
                ⭳ Export Reports
              </Button>
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

      {/* ---- Tabs ----------------------------------------------------------- */}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            size="sm"
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
            data-testid={`dash-tab-${t.replace(/\s+/g, '-').toLowerCase()}`}
          >
            {t}
          </Button>
        ))}
      </div>

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

      {/* ================= DASHBOARD TAB ================= */}
      {tab === 'Dashboard' ? (
        metrics === null || counts === null ? (
          <ReadError
            title="Dashboard could not be loaded"
            detail="The dashboard totals or counts could not be read."
          />
        ) : (
          <div className="space-y-4">
            {/* Metric cards — real business totals. */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <MetricCard
                label="Total Sales"
                value={money(metrics.totalSales)}
                accent
              />
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
              <MetricCard
                label="Sales This Month"
                value={money(metrics.salesMonth)}
              />
            </div>

            {/* Layaway — live from the database (imported ledger + order-derived
                arrangements). Each card opens the Layaway section with its filter;
                Needs-Review / invalid rows never contribute. */}
            <div>
              <p className="mb-2 text-sm font-semibold text-foreground">Layaway</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {(
                  [
                    ['Active Layaways', String(layaway.active), 'active'],
                    ['Completed Layaways', String(layaway.completed), 'completed'],
                    ['Overdue Layaways', String(layaway.overdue), 'overdue'],
                    ['Forfeited Layaways', String(layaway.forfeited), 'forfeited'],
                    ['Total Qty / Items', String(layaway.totalQty), 'all'],
                    ['Created Today', String(layaway.createdToday), 'all'],
                    ['Created This Month', String(layaway.createdMonth), 'all'],
                    ['Due Today', String(layaway.dueToday), 'active'],
                    ['Due Within 7 Days', String(layaway.due7d), 'active'],
                    ['Total Item Amount', money(layaway.totalItem), 'all'],
                    ['Total Interest', money(layaway.totalInterest), 'all'],
                    ['Grand Total', money(layaway.grandTotal), 'all'],
                    ['Total Payments', money(layaway.totalPayment), 'all'],
                    ['Remaining Balance', money(layaway.remainingBalance), 'all'],
                  ] as const
                ).map(([label, value, section]) => (
                  <Link
                    key={label}
                    href={`/orders/payments?layaway=${section}`}
                    data-testid={`dash-layaway-${section}-${label}`}
                    className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-gold/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold"
                  >
                    <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
                    <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
                  </Link>
                ))}
              </div>
            </div>

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
                        value: moneyWeight(metrics.totalLayawaySales),
                        display: money(metrics.totalLayawaySales),
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
                  <ColumnChart
                    ariaLabel="Layaway figures"
                    data={[
                      {
                        label: 'Sales',
                        value: moneyWeight(metrics.totalLayawaySales),
                        display: money(metrics.totalLayawaySales),
                      },
                      {
                        label: 'Collections',
                        value: moneyWeight(metrics.layawayCollections),
                        display: money(metrics.layawayCollections),
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

            {/* Operational summary — real counts. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Operational summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <MetricCard
                    label="For Invoice"
                    value={counts.confirmedClaimsForInvoice}
                  />
                  <MetricCard
                    label="Pending Payment Verification"
                    value={counts.paymentsAwaitingVerification}
                  />
                  <MetricCard label="Active Layaway" value={counts.ordersActiveLayaway} />
                  <MetricCard
                    label="For Fulfillment"
                    value={counts.ordersForFulfillment}
                  />
                  <MetricCard label="Pending Claims" value={counts.pendingClaims} />
                  <MetricCard label="Cancelled" value={counts.ordersCancelled} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm">
                    <span className="text-muted-foreground">Payments to verify</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold tabular-nums">
                        {counts.paymentsAwaitingVerification}
                      </span>
                      {canVerifyPayments ? (
                        <a
                          href="/orders/payments"
                          className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                        >
                          Open
                        </a>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm">
                    <span className="text-muted-foreground">Returned-to-Stock</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold tabular-nums">{counts.rtsInReview}</span>
                      {canMonitorInventory ? (
                        <a
                          href="/orders/inventory"
                          className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                        >
                          Open
                        </a>
                      ) : null}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-2.5 py-1.5 text-sm">
                    <span className="text-muted-foreground">Owner approvals</span>
                    <span className="font-bold tabular-nums">
                      {counts.ownerApprovalsPending}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Claims are not Official Orders. Never add these to the order tiles.
                  Queue counts overlap the tiles by nature — they are work to do, not
                  orders. Never sum them with order figures. Seeing a count grants no
                  authority over it.
                </p>
              </CardContent>
            </Card>

            {/* Layaway summary — real money aggregation. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Layaway</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MetricCard
                    label="Active Layaway"
                    value={counts.ordersActiveLayaway}
                    accent
                  />
                  <MetricCard
                    label="Layaway Sales"
                    value={money(metrics.totalLayawaySales)}
                  />
                  <MetricCard
                    label="Layaway Collections"
                    value={money(metrics.layawayCollections)}
                  />
                  <MetricCard
                    label="Forfeited Amount"
                    value={money(metrics.forfeitedAmount)}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {metrics.totalOfficialOrders} Official Orders. An Active Layaway is an
                  Official Order — never double-counted. Forfeiture needs Owner approval;
                  no automatic stock return.
                </p>
              </CardContent>
            </Card>

            {/* Money in Transit — money not yet in the bank (problem #14). Real
                SQL sums; a failed read shows an error, never a false ₱0. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Money in Transit</CardTitle>
              </CardHeader>
              <CardContent>
                {moneyInTransit.ok ? (
                  <>
                    <div
                      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                      data-testid="money-in-transit"
                    >
                      <MetricCard
                        label="Awaiting Verification"
                        value={money(moneyInTransit.data.awaitingVerification)}
                      />
                      <MetricCard
                        label="Customer Pending"
                        value={money(moneyInTransit.data.customerPending)}
                      />
                      <MetricCard
                        label="Still to Collect (COD)"
                        value={money(moneyInTransit.data.inTransitToCollect)}
                        accent
                      />
                    </div>
                    {/* Rider-vs-LBC split of "still to collect", plus cash collected
                        but not yet remitted (#3 deeper). */}
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <MetricCard
                        label="To Collect — Rider"
                        value={money(moneyInTransit.data.riderToCollect)}
                      />
                      <MetricCard
                        label="To Collect — LBC"
                        value={money(moneyInTransit.data.lbcToCollect)}
                      />
                      <MetricCard
                        label="Collected, Not Remitted"
                        value={money(moneyInTransit.data.collectedUnremitted)}
                        accent
                      />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Money not yet in the bank. Still to Collect = outstanding on COD
                      orders dispatched but not yet collected (split by who carries it —
                      rider vs LBC; a dispatched order with no channel set yet shows in
                      the total but neither split). Collected, Not Remitted = cash already
                      taken on delivery but not yet handed to the shop.
                    </p>
                  </>
                ) : (
                  <ReadError
                    title="Money in Transit unavailable"
                    detail="The money-in-transit totals could not be read."
                  />
                )}
              </CardContent>
            </Card>

            {/* Scrap details — the most recent scrap gold/silver sales. Real rows,
                RLS-scoped; amounts shown as authoritative peso strings. Sits at the
                very bottom of the dashboard. */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Scrap details</CardTitle>
              </CardHeader>
              <CardContent>
                {scrapSales.length === 0 ? (
                  <p className="text-xs text-muted-foreground" data-testid="scrap-empty">
                    No scrap sales yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table
                      className="w-full min-w-[520px] text-left text-sm"
                      data-testid="scrap-details"
                    >
                      <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Material</th>
                          <th className="px-3 py-2 text-right font-medium">Grams</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                          <th className="px-3 py-2 font-medium">Buyer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scrapSales.map((s) => (
                          <tr key={s.id} className="border-b last:border-0">
                            <td className="px-3 py-2 tabular-nums">{s.soldOn}</td>
                            <td className="px-3 py-2 capitalize">{s.material}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {s.grams}
                            </td>
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {money(s.amount)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {s.buyer ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Most recent scrap sales. Full history and recording are on the Scrap
                  page in the sidebar.
                </p>
              </CardContent>
            </Card>
          </div>
        )
      ) : null}


      {/* ================= FOLLOW-UPS TAB (real live counts) ================= */}
      {tab === 'Follow-ups' ? (
        <FollowUpCards categories={followUps.categories} total={followUps.total} />
      ) : null}

      {/* ================= REPORTS TAB (real, gated export) ================= */}
      {tab === 'Reports' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales summary</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={runReport} className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="rfrom" className="text-xs">
                  From
                </Label>
                <Input id="rfrom" name="from" type="date" required className="h-8" />
              </div>
              <div>
                <Label htmlFor="rto" className="text-xs">
                  To
                </Label>
                <Input id="rto" name="to" type="date" required className="h-8" />
              </div>
              <Button type="submit" size="sm" disabled={running}>
                {running ? 'Running…' : 'Run Report'}
              </Button>
              {canExport ? null : (
                <span className="self-center text-xs text-muted-foreground">
                  Export/download needs the Export Data permission.
                </span>
              )}
            </form>

            {reportState.report ? (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Verified collected</dt>
                  <dd className="text-lg font-bold tabular-nums">
                    {money(reportState.report.verifiedCollected)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Payments recorded</dt>
                  <dd className="font-medium tabular-nums">
                    {reportState.report.paymentsRecorded}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verified</dt>
                  <dd className="font-medium tabular-nums">
                    {reportState.report.paymentsVerified}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Unverified</dt>
                  <dd className="font-medium tabular-nums">
                    {reportState.report.paymentsUnverified}
                  </dd>
                </div>
              </dl>
            ) : null}

            {reportState.report ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Payments in range, by verification
                </p>
                <BarChart
                  ariaLabel="Payments by verification status"
                  noDataLabel="No data for this period"
                  data={[
                    { label: 'Verified', value: reportState.report.paymentsVerified },
                    { label: 'Unverified', value: reportState.report.paymentsUnverified },
                  ]}
                />
              </div>
            ) : null}

            <p className="mt-2 text-xs text-muted-foreground">
              Verified money only — unverified evidence is not revenue. A report is
              limited to records you can already see, and grants no authority over them.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ================= SEARCH TAB ================= */}
      {tab === 'Search' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Global search</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="GET" className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="q" className="text-xs">
                  Search
                </Label>
                <Input
                  id="q"
                  name="q"
                  defaultValue={query}
                  placeholder="Order no., claim no., customer, item code…"
                  className="h-8 w-72"
                />
              </div>
              <Button type="submit" size="sm">
                Search
              </Button>
            </form>

            {query.length > 0 && query.trim().length < 2 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Enter at least two characters.
              </p>
            ) : null}

            {results.length === 0 && query.trim().length >= 2 ? (
              <p className="mt-3 text-sm text-muted-foreground">No matches.</p>
            ) : null}

            {results.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs">
                {results.map((r) => (
                  <li
                    key={`${r.resultKind}-${r.entityId}`}
                    className="flex flex-wrap justify-between gap-2 rounded border p-2"
                  >
                    <span>
                      <span className="rounded bg-muted px-1.5 py-0.5">
                        {r.resultKind.replace(/_/g, ' ')}
                      </span>
                      <span className="ml-2 font-mono">{r.reference}</span>
                      <span className="ml-2">{r.label}</span>
                    </span>
                    <span className="text-muted-foreground">{r.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-2 text-xs text-muted-foreground">
              Search shows only records you already have permission to read, and returns
              references only. Finding a record is not authority over it — nothing here
              merges or reassigns anything.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ================= REMINDERS TAB ================= */}
      {tab === 'Reminders' ? (
        notifications.length === 0 ? (
          <EmptyState
            title="No reminders"
            description="Reminders are staff-triggered notes. Customers hold no account and are never notified here."
          />
        ) : (
          <ul className="space-y-2">
            {notifications.map((n) => (
              <li key={n.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-2 pt-6">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{n.body}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {n.kind.replace(/_/g, ' ')}
                        {n.dueAt
                          ? ` · due ${new Date(n.dueAt).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                    {n.acknowledgedAt ? (
                      <span className="text-xs text-muted-foreground">Acknowledged</span>
                    ) : (
                      <form action={acknowledge}>
                        <input type="hidden" name="notificationId" value={n.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={acking}
                        >
                          Acknowledge
                        </Button>
                      </form>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
            <p className="text-xs text-muted-foreground">
              A reminder is a note: acknowledging it changes no business record. Delivery
              is manual-send only — Sent is an attestation, and Delivered and Read are not
              observed.
            </p>
          </ul>
        )
      ) : null}

      {/* ================= AUDIT TAB ================= */}
      {tab === 'Audit' ? (
        audit.length === 0 ? (
          <EmptyState title="No audit events" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-2">When</th>
                  <th className="px-2.5 py-2">Actor</th>
                  <th className="px-2.5 py-2">Action</th>
                  <th className="px-2.5 py-2">Entity</th>
                  <th className="px-2.5 py-2">Outcome</th>
                  <th className="px-2.5 py-2">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="px-2.5 py-2">
                      {new Date(a.occurredAt).toLocaleString()}
                    </td>
                    <td className="px-2.5 py-2">{a.actorLabel ?? 'system'}</td>
                    <td className="px-2.5 py-2 font-mono">{a.action}</td>
                    <td className="px-2.5 py-2">{a.entityType}</td>
                    <td className="px-2.5 py-2">{a.outcome}</td>
                    <td className="px-2.5 py-2 text-muted-foreground">
                      {a.reason ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Append-only: audit events cannot be edited or deleted, and attribution is a
              snapshot that survives rename and deactivation. Event context is not shown
              here — it can carry operational detail, and the trail must never expose
              secrets.
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}
