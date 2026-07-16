'use client';

import { useActionState, useMemo, useState } from 'react';

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
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { BarChart } from '@/components/ui/bar-chart';
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
  'Gross Profit',
  'Reports',
  'Search',
  'Reminders',
  'Audit',
] as const;
type Tab = (typeof TABS)[number];

const RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '14d', label: 'Last 14 days', days: 14 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'month', label: 'This Month', days: 0 },
  { key: 'custom', label: 'Custom', days: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Inclusive [start, end] ISO day bounds for a range. Client-side and honest:
 *  it only scopes which real trend days are shown, never invents data. */
function rangeBounds(
  range: RangeKey,
  from: string,
  to: string,
): { start: string; end: string } {
  const today = new Date();
  const end = isoDay(today);
  if (range === 'custom') {
    return { start: from || end, end: to || end };
  }
  if (range === 'month') {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: isoDay(first), end };
  }
  const def = RANGES.find((r) => r.key === range)?.days ?? 30;
  const start = new Date(today);
  start.setDate(start.getDate() - (def - 1));
  return { start: isoDay(start), end };
}

export function DashboardView({
  counts,
  metrics,
  notifications,
  audit,
  results,
  query,
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
  canExport: boolean;
  canVerifyPayments: boolean;
  canMonitorInventory: boolean;
}) {
  const [tab, setTab] = useState<Tab>('Dashboard');
  const [range, setRange] = useState<RangeKey>('30d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

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

  const bounds = rangeBounds(range, from, to);

  // Real 30-day collection trend, scoped to the selected range. Filtering only
  // hides/shows real days — it never fabricates a point. `weight` scales the bar;
  // `verified` is the authoritative money string shown as-is (no frontend math).
  const trendInRange = useMemo(() => {
    if (!metrics) return [];
    return metrics.collectionTrend.filter(
      (p) => p.day >= bounds.start && p.day <= bounds.end,
    );
  }, [metrics, bounds.start, bounds.end]);

  const bucketSum = counts
    ? counts.ordersActiveLayaway +
      counts.ordersAwaitingPayment +
      counts.ordersForFulfillment +
      counts.ordersClosed +
      counts.ordersCancelled
    : 0;

  return (
    <div className="space-y-4">
      {/* ---- Header: date range + current range + Refresh + Export ---------- */}
      <Card>
        <CardContent className="space-y-2.5 pt-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGES.map((r) => (
              <Button
                key={r.key}
                type="button"
                size="sm"
                variant={range === r.key ? 'default' : 'outline'}
                aria-pressed={range === r.key}
                onClick={() => setRange(r.key)}
                data-testid={`dash-range-${r.key}`}
              >
                {r.label}
              </Button>
            ))}
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

          {range === 'custom' ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:max-w-md">
              <div>
                <Label htmlFor="range-from" className="text-xs">
                  Start date
                </Label>
                <Input
                  id="range-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
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
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground" data-testid="dash-range-active">
            Showing <strong className="text-foreground">{bounds.start}</strong> to{' '}
            <strong className="text-foreground">{bounds.end}</strong>. The range scopes
            the Sales for the Period chart to real recorded days; export stays
            permission-gated.
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
                value={formatPeso(metrics.totalSales)}
                accent
              />
              <MetricCard
                label="Verified Collections"
                value={formatPeso(metrics.verifiedCollections)}
              />
              <MetricCard
                label="Outstanding Balance"
                value={formatPeso(metrics.outstandingBalance)}
              />
              <MetricCard label="Sales Today" value={formatPeso(metrics.salesToday)} />
              <MetricCard label="Sales This Week" value={formatPeso(metrics.salesWeek)} />
              <MetricCard
                label="Sales This Month"
                value={formatPeso(metrics.salesMonth)}
              />
            </div>

            {/* Charts row: Order Status + Sales for the Period. Both stay visible
                at zero with "No data for this period" (never hidden). */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Order Status</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* The disjoint Official-Order buckets, always the same five
                      categories so the chart is present even at zero. */}
                  <BarChart
                    ariaLabel="Official Orders by status"
                    noDataLabel="No data for this period"
                    data={[
                      { label: 'Active Layaway', value: counts.ordersActiveLayaway },
                      { label: 'Awaiting Payment', value: counts.ordersAwaitingPayment },
                      { label: 'For Fulfillment', value: counts.ordersForFulfillment },
                      { label: 'Closed', value: counts.ordersClosed },
                      { label: 'Cancelled', value: counts.ordersCancelled },
                    ]}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {bucketSum} of {counts.totalOfficialOrders} Official Orders. These
                    tiles are non-additive by construction: an Active Layaway{' '}
                    <strong>is</strong> an Official Order and appears in exactly one tile,
                    never two. Claims are not Official Orders. Never add these to the
                    order tiles.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sales for the Period</CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChart
                    ariaLabel="Verified collections per day in the selected range"
                    noDataLabel="No data for this period"
                    emptyLabel="No data for this period"
                    data={trendInRange.map((p) => ({
                      label: p.day.slice(5),
                      value: p.weight,
                      display: formatPeso(p.verified),
                    }))}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Verified collections per day, {trendInRange.length} day(s) in range.
                    Verified money only — unverified evidence is not counted.
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
                    value={formatPeso(metrics.totalLayawaySales)}
                  />
                  <MetricCard
                    label="Layaway Collections"
                    value={formatPeso(metrics.layawayCollections)}
                  />
                  <MetricCard
                    label="Forfeited Amount"
                    value={formatPeso(metrics.forfeitedAmount)}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {metrics.totalOfficialOrders} Official Orders. An Active Layaway is an
                  Official Order — never double-counted. Forfeiture needs Owner approval;
                  no automatic stock return.
                </p>
              </CardContent>
            </Card>
          </div>
        )
      ) : null}

      {/* ================= GROSS PROFIT TAB (honest-unavailable) ================= */}
      {tab === 'Gross Profit' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gross Profit</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center"
              data-testid="gross-profit-unavailable"
            >
              <p className="text-sm font-medium text-foreground">
                Gross Profit is not available yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Gross Profit needs real cost / COGS rules (cost per item and the margin
                formula), and those are not defined in the system yet. Rather than show
                invented numbers, this stays honestly unavailable until the cost rules are
                approved. The tab is retained so the approved structure is preserved.
              </p>
            </div>
          </CardContent>
        </Card>
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
                    {formatPeso(reportState.report.verifiedCollected)}
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
