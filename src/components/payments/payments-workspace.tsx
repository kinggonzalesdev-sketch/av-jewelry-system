'use client';

import { useActionState, useState } from 'react';

import {
  rejectPaymentAction,
  requestForfeitureAction,
  verifyPaymentAction,
} from '@/lib/payments/actions';
import type { PaymentActionState } from '@/lib/payments/action-state';
import { EMPTY_PAYMENT_STATE } from '@/lib/payments/action-state';
import { RANGE_LABEL, formatPeso, type DateRangeKey } from '@/lib/payments/format';
import type {
  EvidenceQueueRow,
  LayawayRow,
  OverviewCards,
  PayableOrderRow,
  PaymentHistoryRow,
} from '@/lib/payments/workspace';
import { RecordPaymentForm } from '@/components/payments/record-payment-form';
import { EmptyState } from '@/components/states/empty-state';
import { BarChart } from '@/components/ui/bar-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Payments & Layaway (Bible §16, §17) — the approved module, real data.
 *
 * The approved seven tabs, overview cards, breakdowns, trend, and date filters
 * are preserved exactly. Only real states were added: loading, empty,
 * validation, denial, success, error.
 *
 * FINANCIAL TRUTH IS NEVER COMPUTED HERE. Every peso figure arrives already
 * decided by the approved SQL and is rendered as a string — a float would round
 * a centavo off a balance that decides whether a customer still owes money.
 */

export const TABS = [
  'Payment Verification',
  'Layaway Accounts',
  'Installments',
  'Overdue / Grace Period',
  'Forfeiture Review',
  'Payment History',
  'Completed Layaways',
] as const;

export type Tab = (typeof TABS)[number];

const RANGES: DateRangeKey[] = ['today', '7d', '14d', '30d', 'month', 'custom'];

export function PaymentsWorkspace({
  cards,
  paymentBreakdown,
  layawayBreakdown,
  trend,
  queue,
  queueUnavailable,
  layaways,
  completed,
  history,
  range,
  payableOrders,
  canVerify,
  canMonitorLayaway,
  canRequestForfeiture,
}: {
  cards: OverviewCards;
  paymentBreakdown: Array<{ label: string; value: number }>;
  layawayBreakdown: Array<{ label: string; value: number }>;
  trend: Array<{ label: string; verified: string; weightCentavos: number }>;
  queue: EvidenceQueueRow[];
  /** Set when the queue read FAILED. An empty list and a failed read differ. */
  queueUnavailable: string | null;
  layaways: LayawayRow[];
  completed: LayawayRow[];
  history: PaymentHistoryRow[];
  range: DateRangeKey;
  payableOrders: PayableOrderRow[];
  canVerify: boolean;
  canMonitorLayaway: boolean;
  canRequestForfeiture: boolean;
}) {
  const [tab, setTab] = useState<Tab>('Payment Verification');

  const [verifyState, verifyAction, verifying] = useActionState<
    PaymentActionState,
    FormData
  >(verifyPaymentAction, EMPTY_PAYMENT_STATE);
  const [rejectState, rejectAction, rejecting] = useActionState<
    PaymentActionState,
    FormData
  >(rejectPaymentAction, EMPTY_PAYMENT_STATE);
  const [forfeitState, forfeitAction, forfeiting] = useActionState<
    PaymentActionState,
    FormData
  >(requestForfeitureAction, EMPTY_PAYMENT_STATE);

  const notices = [verifyState, rejectState, forfeitState];

  const overdue = layaways.filter((l) => ['overdue', 'grace_period'].includes(l.status));
  const forfeitureReview = layaways.filter((l) => l.status === 'forfeiture_eligible');
  const installmentAccounts = layaways.filter((l) => l.installments.length > 0);

  return (
    <div className="space-y-4">
      {/* Overview cards — evidence, awaiting, and verified stay separate. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
        {(
          [
            ['Payment Evidence Submitted', cards.paymentEvidenceSubmitted],
            ['Awaiting Verification', cards.awaitingVerification],
            ['Required Payment Verified', cards.requiredPaymentVerified],
            ['Active Layaways', cards.activeLayaways],
            ['Installments Due', cards.installmentsDue],
            ['Overdue / Grace Period', cards.overdueOrGrace],
            ['Forfeiture Review', cards.forfeitureReview],
            ['Completed Layaways', cards.completedLayaways],
          ] as const
        ).map(([label, value]) => (
          <Card key={label}>
            <CardContent className="pt-6">
              <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Date filters — the range is resolved server-side. */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-1.5 pt-6">
          {RANGES.map((r) => (
            <form key={r} method="GET">
              <input type="hidden" name="range" value={r} />
              <Button
                type="submit"
                size="sm"
                variant={range === r ? 'default' : 'outline'}
                aria-pressed={range === r}
              >
                {RANGE_LABEL[r]}
              </Button>
            </form>
          ))}
          {range === 'custom' ? (
            <form method="GET" className="flex items-end gap-2">
              <input type="hidden" name="range" value="custom" />
              <div>
                <Label htmlFor="from" className="text-xs">
                  Start date
                </Label>
                <Input id="from" name="from" type="date" className="h-8" />
              </div>
              <div>
                <Label htmlFor="to" className="text-xs">
                  End date
                </Label>
                <Input id="to" name="to" type="date" className="h-8" />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Apply
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      {/* The three approved graphs. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <BarRows rows={paymentBreakdown} />
            <p className="mt-2 text-xs text-muted-foreground">
              Evidence Submitted and Awaiting Verification are never folded into Required
              Payment Verified. Recording evidence verifies nothing.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Layaway Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <BarRows rows={layawayBreakdown} />
            <p className="mt-2 text-xs text-muted-foreground">
              Forfeiture Review counts accounts eligible for review — not forfeited ones.
              Forfeiture requires Owner approval.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Layaway Collection Trend</CardTitle>
        </CardHeader>
        <CardContent>
          {trend.length === 0 ? (
            <EmptyState title="No verified collection in this period" />
          ) : (
            <BarChart
              ariaLabel="Verified layaway collection per period"
              // value scales the bar width only; the DISPLAYED figure is the
              // authoritative money string from the database — no frontend math.
              data={trend.map((point) => ({
                label: point.label,
                value: point.weightCentavos,
                display: formatPeso(point.verified),
              }))}
              emptyLabel="No verified collection in this period."
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Verified collection only. Payment evidence that has not been verified
            contributes nothing, because recording is not verifying.
          </p>
        </CardContent>
      </Card>

      {/* Tabs — the approved seven, in order. */}
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

      {/* Record Payment sits at the head of the Payment Verification tab because
          that is the step BEFORE verification, and the two must stay visibly
          distinct: what is recorded here counts toward no balance until someone
          verifies it below. Gated on the same permission the domain module
          re-checks server-side — the gate here is convenience, not the control. */}
      {tab === 'Payment Verification' && canVerify && (
        <div className="mb-4">
          <RecordPaymentForm orders={payableOrders} />
        </div>
      )}

      {/* A failed read is NEVER shown as an empty queue. "No payments awaiting
          verification" against money that is actually waiting is the reason this
          defect survived: nobody investigates an empty list. */}
      {tab === 'Payment Verification' && queueUnavailable ? (
        <div
          role="alert"
          data-testid="queue-unavailable"
          className="rounded-md border border-destructive/50 p-3 text-sm"
        >
          <p className="font-semibold text-destructive">
            The verification queue could not be read
          </p>
          <p className="mt-1 text-muted-foreground">
            This is <strong>not</strong> an empty queue — payments may be awaiting
            verification and are not shown. Do not treat this screen as “nothing to do”.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{queueUnavailable}</p>
        </div>
      ) : null}

      {tab === 'Payment Verification' && !queueUnavailable ? (
        queue.length === 0 ? (
          <EmptyState
            title="No payments awaiting verification"
            description="Submitted payments appear here until an authorized user verifies them."
          />
        ) : (
          <ul className="space-y-2">
            {queue.map((p) => (
              <li key={p.paymentId}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {p.customerDisplayName}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {p.orderNumber} · {p.invoiceNumber} · {formatPeso(p.amount)} ·{' '}
                          {p.paymentMethod?.replace('_', ' ') ?? '—'}
                          {p.referenceNumber ? ` · ${p.referenceNumber}` : ''}
                          {p.provider ? ` · ${p.provider}` : ''}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Submitted {new Date(p.recordedAt).toLocaleString()} ·{' '}
                          <span className="font-medium">
                            {p.status.replace(/_/g, ' ')}
                          </span>
                        </p>
                        {p.evidenceReferences.length > 0 ? (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            data-testid="evidence-reference"
                          >
                            Evidence: {p.evidenceReferences.join(', ')}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full border px-2 py-0.5 text-xs">
                        {p.evidenceCount} evidence
                      </span>
                    </div>

                    {/* Flagged, not rejected: a human must look at it. */}
                    {p.duplicateReference ? (
                      <p className="rounded border border-amber-500 px-2 py-1.5 text-xs">
                        Duplicate transaction reference — another payment already uses{' '}
                        <span className="font-mono">{p.referenceNumber}</span>. Review
                        before verifying; it was not auto-rejected.
                      </p>
                    ) : null}

                    {canVerify ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <form action={verifyAction} className="flex items-end gap-2">
                          <input type="hidden" name="paymentId" value={p.paymentId} />
                          <div>
                            <Label htmlFor={`amt-${p.paymentId}`} className="text-xs">
                              Amount that actually arrived
                            </Label>
                            <Input
                              id={`amt-${p.paymentId}`}
                              name="verifiedAmount"
                              required
                              defaultValue={p.amount}
                              inputMode="decimal"
                              className="h-8 w-36"
                            />
                          </div>
                          <Button type="submit" size="sm" disabled={verifying}>
                            {verifying ? 'Verifying…' : 'Verify Payment'}
                          </Button>
                        </form>

                        <form action={rejectAction} className="flex items-end gap-2">
                          <input type="hidden" name="paymentId" value={p.paymentId} />
                          <div>
                            <Label htmlFor={`rej-${p.paymentId}`} className="text-xs">
                              Rejection reason
                            </Label>
                            <Input
                              id={`rej-${p.paymentId}`}
                              name="note"
                              required
                              placeholder="Why reject?"
                              className="h-8 w-40"
                            />
                          </div>
                          <Button
                            type="submit"
                            size="sm"
                            variant="destructive"
                            disabled={rejecting}
                          >
                            Reject
                          </Button>
                        </form>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Verifying requires the Payment Verification permission.
                      </p>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Recording evidence is not verifying it. Only the verified amount
                      reduces the balance, and Required Payment Verified is not Paid in
                      Full.
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'Layaway Accounts' ? (
        <LayawayList rows={layaways} emptyTitle="No Layaway accounts" />
      ) : null}

      {tab === 'Installments' ? (
        installmentAccounts.length === 0 ? (
          <EmptyState
            title="No installments recorded"
            description="Recording an installment does not verify its payment."
          />
        ) : (
          <ul className="space-y-2">
            {installmentAccounts.map((l) => (
              <li key={l.layawayId}>
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-sm font-semibold">{l.customerDisplayName}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {l.orderNumber}
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {l.installments.map((i) => (
                        <li
                          key={i.number}
                          className="flex flex-wrap justify-between gap-2"
                        >
                          <span>
                            #{i.number} · due {i.dueDate} · {formatPeso(i.amountDue)}
                          </span>
                          <span
                            className={
                              i.verified ? 'text-muted-foreground' : 'text-amber-600'
                            }
                          >
                            {i.verified
                              ? 'Verified'
                              : i.paid
                                ? 'Recorded — not yet verified'
                                : 'Unpaid'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted-foreground">
                      A recorded installment is not a verified payment. Only verified
                      payments reduce the Outstanding Balance.
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'Overdue / Grace Period' ? (
        <LayawayList
          rows={overdue}
          emptyTitle="Nothing overdue"
          note="An expired grace period routes to review. There is no automatic forfeiture and no automatic stock return."
        />
      ) : null}

      {tab === 'Forfeiture Review' ? (
        forfeitureReview.length === 0 ? (
          <EmptyState
            title="Nothing eligible for forfeiture review"
            description="Eligibility is not approval. Forfeiture requires the Owner."
          />
        ) : (
          <ul className="space-y-2">
            {forfeitureReview.map((l) => (
              <li key={l.layawayId}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <p className="text-sm font-semibold">{l.customerDisplayName}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {l.orderNumber} · outstanding {formatPeso(l.outstandingBalance)}
                    </p>

                    {canRequestForfeiture ? (
                      <form
                        action={forfeitAction}
                        className="flex flex-wrap items-end gap-2"
                      >
                        <input
                          type="hidden"
                          name="layawayArrangementId"
                          value={l.layawayId}
                        />
                        <div>
                          <Label htmlFor={`ff-${l.layawayId}`} className="text-xs">
                            Reason
                          </Label>
                          <Input
                            id={`ff-${l.layawayId}`}
                            name="reason"
                            required
                            placeholder="Why request forfeiture?"
                            className="h-8 w-56"
                          />
                        </div>
                        <Button
                          type="submit"
                          size="sm"
                          variant="outline"
                          disabled={forfeiting}
                        >
                          Request Forfeiture
                        </Button>
                      </form>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      Requesting is not forfeiting. Only the Owner can approve, execution
                      is a separate step, and a forfeited item goes to Returned-to-Stock
                      Review — stock is never returned automatically.
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'Payment History' ? (
        history.length === 0 ? (
          <EmptyState title="No payments in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-2">Order</th>
                  <th className="px-2.5 py-2">Customer</th>
                  <th className="px-2.5 py-2">Method</th>
                  <th className="px-2.5 py-2">Reference</th>
                  <th className="px-2.5 py-2 text-right">Claimed</th>
                  <th className="px-2.5 py-2 text-right">Verified</th>
                  <th className="px-2.5 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h) => (
                  <tr key={h.paymentId}>
                    <td className="px-2.5 py-2 font-mono">{h.orderNumber}</td>
                    <td className="px-2.5 py-2">{h.customerDisplayName}</td>
                    <td className="px-2.5 py-2">
                      {h.paymentMethod?.replace('_', ' ') ?? '—'}
                    </td>
                    <td className="px-2.5 py-2 font-mono">{h.referenceNumber ?? '—'}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {formatPeso(h.amount)}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {h.verifiedAmount ? formatPeso(h.verifiedAmount) : '—'}
                    </td>
                    <td className="px-2.5 py-2">
                      {h.status}
                      {h.voided ? ' · voided' : ''}
                      {h.reversed ? ' · reversed' : ''}
                      {h.correctionPending ? ' · correction pending' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'Completed Layaways' ? (
        <LayawayList
          rows={completed}
          emptyTitle="No completed Layaways"
          note="Completed requires a zero Outstanding Balance reached through verified payments only, with no unresolved correction or overpayment."
        />
      ) : null}

      {!canMonitorLayaway ? (
        <p className="text-xs text-muted-foreground">
          Layaway actions require the Layaway Monitoring permission.
        </p>
      ) : null}
    </div>
  );
}

/** Simple proportional bars. Counts only — no money arithmetic here. */
function BarRows({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-xs">
          <span className="w-44 shrink-0 text-muted-foreground">{r.label}</span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </span>
          <span className="w-6 text-right tabular-nums">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

function LayawayList({
  rows,
  emptyTitle,
  note,
}: {
  rows: LayawayRow[];
  emptyTitle: string;
  note?: string;
}) {
  // Spread rather than pass undefined: `exactOptionalPropertyTypes` treats an
  // explicit undefined as different from an absent prop.
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} {...(note ? { description: note } : {})} />;
  }

  return (
    <ul className="space-y-2">
      {rows.map((l) => (
        <li key={l.layawayId}>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {l.customerDisplayName}
                  </p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {l.orderNumber} · {l.invoiceNumber}
                  </p>
                </div>
                <span className="rounded-full border px-2 py-0.5 text-xs">
                  {l.status.replace('_', ' ')}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                {(
                  [
                    ['Total payable', formatPeso(l.totalAmountPayable)],
                    ['Verified paid', formatPeso(l.verifiedNetPayments)],
                    ['Outstanding', formatPeso(l.outstandingBalance)],
                    ['Layaway fee', l.layawayFee ? formatPeso(l.layawayFee) : '—'],
                    ['Months', l.months ? String(l.months) : '—'],
                    ['Total grams', l.totalGrams ?? '—'],
                    ['Final due', l.finalDueDate ?? '—'],
                    ['Grace ends', l.graceEndsOn ?? '—'],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>

              {/* Unresolved states stay visible — they block completion. */}
              {l.overpaymentCredit !== '0.00' ? (
                <p className="mt-2 rounded border border-amber-500 px-2 py-1.5 text-xs">
                  Overpayment Credit {formatPeso(l.overpaymentCredit)} — unresolved.
                  Completion is blocked until it is handled through the correction
                  workflow.
                </p>
              ) : null}

              {l.hasUnresolvedCorrection ? (
                <p className="mt-2 rounded border border-amber-500 px-2 py-1.5 text-xs">
                  A payment correction is unresolved. Completion is blocked, and the
                  payment counts toward no balance meanwhile.
                </p>
              ) : null}

              {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
