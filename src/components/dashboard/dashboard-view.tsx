'use client';

import { useActionState, useState } from 'react';

import {
  EMPTY_DASHBOARD_STATE,
  acknowledgeNotificationAction,
  refreshDashboardAction,
  runSalesReportAction,
  type DashboardActionState,
} from '@/lib/dashboard/actions';
import type {
  AuditRow,
  DashboardCounts,
  NotificationRow,
  SearchResult,
} from '@/lib/dashboard/service';
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Dashboard (Bible §7, §23, §25, §26, §31).
 *
 * ⚠️  THE ORDER TILES ARE DISJOINT AND MUST STAY THAT WAY.
 *     An Active Layaway IS an Official Order. It appears in exactly one tile.
 *     The tiles sum to the total — the screen shows that sum so a wrong number
 *     is visible rather than silent. Queues are rendered in a SEPARATE section
 *     because they overlap the tiles by nature.
 *
 * Seeing a count grants nothing: quick actions are permission-gated, and the
 * server re-checks regardless.
 */

const TABS = ['Queues', 'Search', 'Reports', 'Reminders', 'Audit'] as const;
type Tab = (typeof TABS)[number];

export function DashboardView({
  counts,
  notifications,
  audit,
  results,
  query,
  canExport,
  canVerifyPayments,
  canMonitorInventory,
}: {
  counts: DashboardCounts | null;
  notifications: NotificationRow[];
  audit: AuditRow[];
  results: SearchResult[];
  query: string;
  canExport: boolean;
  canVerifyPayments: boolean;
  canMonitorInventory: boolean;
}) {
  const [tab, setTab] = useState<Tab>('Queues');

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

  const bucketSum = counts
    ? counts.ordersActiveLayaway +
      counts.ordersAwaitingPayment +
      counts.ordersForFulfillment +
      counts.ordersClosed +
      counts.ordersCancelled
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
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
            >
              {t}
            </Button>
          ))}
        </div>

        {/* Manual refresh (§7) — re-reads, changes nothing. */}
        <form action={refresh} className="ml-auto">
          <Button type="submit" size="sm" variant="outline" disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '⟳ Refresh'}
          </Button>
        </form>
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

      {tab === 'Queues' ? (
        counts === null ? (
          <EmptyState
            title="Counts unavailable"
            description="The dashboard could not be read."
          />
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Official Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  {(
                    [
                      ['Active Layaway', counts.ordersActiveLayaway],
                      ['Awaiting Payment', counts.ordersAwaitingPayment],
                      ['For Fulfillment', counts.ordersForFulfillment],
                      ['Closed', counts.ordersClosed],
                      ['Cancelled', counts.ordersCancelled],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-2.5">
                      <p className="text-[11px] leading-tight text-muted-foreground">
                        {label}
                      </p>
                      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>

                {/*
                  The sum is shown on purpose. These tiles are disjoint, so it
                  must equal the total — printing both makes a double-count
                  visible instead of silent.
                */}
                <p className="mt-2 text-xs text-muted-foreground">
                  {bucketSum} of {counts.totalOfficialOrders} Official Orders. These tiles
                  are non-additive by construction: an Active Layaway <strong>is</strong>{' '}
                  an Official Order and appears in exactly one tile, never two.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Claims</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border p-2.5">
                    <p className="text-[11px] text-muted-foreground">Pending Claims</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {counts.pendingClaims}
                    </p>
                  </div>
                  <div className="rounded-lg border p-2.5">
                    <p className="text-[11px] text-muted-foreground">
                      Confirmed, for Invoice
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {counts.confirmedClaimsForInvoice}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Claims are not Official Orders. Never add these to the order tiles.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Work queues</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  <li className="flex items-center justify-between gap-2">
                    <span>Payments awaiting verification</span>
                    <span className="flex items-center gap-2">
                      <span className="font-bold tabular-nums">
                        {counts.paymentsAwaitingVerification}
                      </span>
                      {/* Quick action, permission-gated. Server re-checks. */}
                      {canVerifyPayments ? (
                        <a
                          href="/orders/payments"
                          className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                        >
                          Open
                        </a>
                      ) : null}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>Returned-to-Stock in review</span>
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
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span>Owner approvals pending</span>
                    <span className="font-bold tabular-nums">
                      {counts.ownerApprovalsPending}
                    </span>
                  </li>
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Queue counts overlap the tiles above by nature — they are work to do,
                  not orders. Never sum them with order figures. Seeing a count grants no
                  authority over it.
                </p>
              </CardContent>
            </Card>
          </div>
        )
      ) : null}

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

      {tab === 'Reports' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales summary</CardTitle>
          </CardHeader>
          <CardContent>
            {canExport ? (
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
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">
                Reports require the Export Data / Reports permission. Reading a summary is
                taking data, so it carries the export permission rather than plain
                visibility.
              </p>
            )}

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

            <p className="mt-2 text-xs text-muted-foreground">
              Verified money only — unverified evidence is not revenue. A report is
              limited to records you can already see, and grants no authority over them.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
