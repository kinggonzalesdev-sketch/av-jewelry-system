'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';

import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import { Modal } from '@/components/ui/modal';
import { downloadCsv } from '@/lib/export/csv';
import {
  deleteAllLayawayLedgerAction,
  deleteLayawayLedgerRowAction,
  rejectPaymentAction,
  requestForfeitureAction,
  verifyPaymentAction,
} from '@/lib/payments/actions';
import type { PaymentActionState } from '@/lib/payments/action-state';
import { EMPTY_PAYMENT_STATE } from '@/lib/payments/action-state';
import { RANGE_LABEL, type DateRangeKey } from '@/lib/payments/format';
import { usePrivacyMoney } from '@/components/shell/privacy';
import type {
  EvidenceQueueRow,
  LayawayRow,
  OverviewCards,
  PayableOrderRow,
  PaymentHistoryRow,
} from '@/lib/payments/workspace';
import type { Financer } from '@/lib/payments/financer';
import type { LayawayLedgerRow } from '@/lib/payments/layaway-ledger';
import { LayawayDetailsModal } from '@/components/payments/layaway-details-modal';
import { LayawayImportButton } from '@/components/payments/layaway-import-modal';
import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';
import {
  LedgerAddPayment,
  LedgerEditAccount,
} from '@/components/payments/layaway-ledger-actions';
import { layawayDedupKey } from '@/lib/import/layaway-csv';
import { NewLayawayForm } from '@/components/payments/new-layaway-form';
import { RecordPaymentForm } from '@/components/payments/record-payment-form';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
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


/** Spreadsheet-style status colours for layaway (§13). Colour + the written
 *  label — never colour alone. */
function layawayStatusClass(status: string): string {
  switch (status) {
    case 'completed':
      return 'border-green-500/40 bg-green-500/10 text-green-600';
    case 'active':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600';
    case 'grace_period':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-600';
    case 'overdue':
    case 'cancelled':
      return 'border-red-500/40 bg-red-500/10 text-red-600';
    case 'forfeiture_eligible':
    case 'forfeited':
      return 'border-red-800/50 bg-red-800/10 text-red-800';
    default:
      return 'border-border text-muted-foreground';
  }
}

/** An order number that opens the shared in-page Order Details modal instead of
 *  navigating — so the current tab, filters, and scroll survive. */
function OrderNumberButton({
  orderId,
  label,
  onOpen,
}: {
  orderId: string;
  label: string;
  onOpen: (orderId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(orderId)}
      data-testid={`payments-open-order-${orderId}`}
      className="text-gold-strong hover:underline"
    >
      {label}
    </button>
  );
}

/**
 * The shared shape for one row of the Layaway Accounts table — the SAME 11
 * columns whether the account came from a real order (derived) or an imported
 * spreadsheet row (ledger). Derived rows carry the order id + LayawayRow so the
 * existing View / details actions still work; ledger rows are display-only.
 */
type LayawayAccountRow = {
  key: string;
  /** Reusable short code (A1–Z200) for active accounts; '—' once released. */
  code: string | null;
  customerName: string;
  status: string;
  remarks: string | null;
  /** Layaway financer (order-derived rows); null for imported ledger rows. */
  financer: string | null;
  /** First upcoming installment due date (imported ledger), or null. */
  nextDueDate: string | null;
  datePurchased: string | null;
  item: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  accountNo: string;
  balanceMismatch: boolean;
  officialOrderId: string | null;
  layawayRow: LayawayRow | null;
  /** Set only for imported ledger rows — the id used to delete them. */
  ledgerId: string | null;
};

function fromDerived(l: LayawayRow): LayawayAccountRow {
  return {
    key: `d-${l.layawayId}`,
    code: l.code,
    customerName: l.customerDisplayName,
    status: l.status,
    remarks: l.remarks,
    financer: l.financer,
    nextDueDate: l.finalDueDate,
    datePurchased: l.datePurchased ? l.datePurchased.slice(0, 10) : null,
    item: l.itemAmount,
    interest: l.layawayFee,
    grandTotal: l.totalAmountPayable,
    payment: l.verifiedNetPayments,
    balance: l.outstandingBalance,
    accountNo: l.orderNumber,
    balanceMismatch: false,
    officialOrderId: l.officialOrderId,
    layawayRow: l,
    ledgerId: null,
  };
}

function fromLedger(l: LayawayLedgerRow): LayawayAccountRow {
  return {
    key: `l-${l.id}`,
    code: l.code,
    customerName: l.customerName,
    status: l.status,
    remarks: l.remarks,
    financer: null,
    nextDueDate: l.nextDueDate,
    datePurchased: l.datePurchased,
    item: l.itemAmount,
    interest: l.interest,
    grandTotal: l.grandTotal,
    payment: l.payment,
    balance: l.balance,
    accountNo: l.accountNo,
    balanceMismatch: l.balanceMismatch,
    officialOrderId: null,
    layawayRow: null,
    ledgerId: l.id,
  };
}

/** The Layaway table's section navigation (Owner request 2026-07-27). */
type LayawaySection = 'active' | 'overdue' | 'forfeited' | 'completed' | 'all';

/** Sum peso strings as EXACT integer centavos — never through a JS float. */
function sumPesoCentavos(values: Array<string | null>): bigint {
  let cents = 0n;
  for (const v of values) {
    if (!v) continue;
    const negative = v.trim().startsWith('-');
    const clean = v.replace(/[^\d.]/g, '');
    const [whole = '0', fraction = ''] = clean.split('.');
    const c = BigInt(whole || '0') * 100n + BigInt(`${fraction}00`.slice(0, 2) || '0');
    cents += negative ? -c : c;
  }
  return cents;
}

function centavosToPesoString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export function PaymentsWorkspace({
  queue,
  queueUnavailable,
  layaways,
  completed,
  history,
  range,
  payableOrders,
  financers,
  ledger,
  canVerify,
  canMonitorLayaway,
  canRequestForfeiture,
  canImportLayaway,
  initialSection,
}: {
  cards: OverviewCards;
  queue: EvidenceQueueRow[];
  /** Set when the queue read FAILED. An empty list and a failed read differ. */
  queueUnavailable: string | null;
  layaways: LayawayRow[];
  completed: LayawayRow[];
  history: PaymentHistoryRow[];
  range: DateRangeKey;
  payableOrders: PayableOrderRow[];
  financers: Financer[];
  /** Imported flat layaway accounts (display-only; separate from the money machinery). */
  ledger: LayawayLedgerRow[];
  canVerify: boolean;
  canMonitorLayaway: boolean;
  canRequestForfeiture: boolean;
  canImportLayaway: boolean;
  /** Preselected layaway section (from a dashboard card deep-link). */
  initialSection?: LayawaySection | undefined;
}) {
  const router = useRouter();
  // Privacy Mode (§6): amounts, balances, and installment figures mask to dots.
  const money = usePrivacyMoney();
  // The Layaway Accounts section is the only rendered view (the tab bar was
  // removed 2026-07-24); the other section blocks below are retained but inert.
  const [tab] = useState<Tab>('Layaway Accounts');
  // Section navigation (Owner request 2026-07-27): the table + financial summary
  // below reflect the selected section. Client-side; never navigates or reloads.
  const [section, setSection] = useState<LayawaySection>(initialSection ?? 'active');
  // Order whose in-page details modal is open (null = closed). No navigation, so
  // the active tab, date range, and scroll position are preserved.
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);
  // Record Payment dialog (standard centered modal).
  const [showRecord, setShowRecord] = useState(false);
  // Layaway Accounts search + financer filter (§15) — client-side, spreadsheet-style.
  const [laySearch, setLaySearch] = useState('');
  const [layFinancer, setLayFinancer] = useState('all');

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

  // Base rows for the Layaway table, driven by the selected SECTION. Order-derived
  // layaways carry the full lifecycle; the imported ledger only has active/completed
  // (so Overdue/Forfeited show none of them).
  const baseLayaways: LayawayRow[] =
    section === 'all'
      ? [...layaways, ...completed]
      : section === 'completed'
        ? completed
        : section === 'overdue'
          ? layaways.filter((l) =>
              ['overdue', 'grace_period', 'forfeiture_eligible'].includes(l.status),
            )
          : section === 'forfeited'
            ? layaways.filter((l) => l.status === 'forfeited')
            : layaways.filter((l) => l.status === 'active');

  const filteredLayaways = baseLayaways.filter((l) => {
    if (layFinancer !== 'all' && (l.financer ?? '') !== layFinancer) return false;
    const q = laySearch.trim().toLowerCase();
    if (!q) return true;
    return `${l.code ?? ''} ${l.orderNumber} ${l.customerDisplayName} ${l.financer ?? ''} ${l.remarks ?? ''}`
      .toLowerCase()
      .includes(q);
  });

  // Imported ledger accounts, filtered by the SAME section + search. They have no
  // financer, so a specific-financer filter hides them, and they only appear under
  // Active or Completed (they have no overdue/forfeited state).
  const ledgerFiltered = ledger.filter((l) => {
    if (layFinancer !== 'all') return false;
    // Never count ERROR / needs-review or any non-active/completed status.
    const valid = l.status === 'active' || l.status === 'completed';
    if (section === 'all') {
      if (!valid) return false;
    } else if (section === 'completed') {
      if (l.status !== 'completed') return false;
    } else if (section === 'active') {
      if (l.status !== 'active') return false;
    } else {
      return false; // overdue / forfeited: no imported-ledger rows
    }
    const q = laySearch.trim().toLowerCase();
    if (!q) return true;
    return `${l.code ?? ''} ${l.accountNo} ${l.customerName} ${l.remarks ?? ''}`
      .toLowerCase()
      .includes(q);
  });

  // The merged Layaway Accounts rows — derived + imported ledger, one shape.
  const accountRows: LayawayAccountRow[] = [
    ...filteredLayaways.map(fromDerived),
    ...ledgerFiltered.map(fromLedger),
  ];

  // Financial summary for the CURRENTLY SHOWN section (+ search/financer filter +
  // date range). Money is summed as exact centavos; Qty is the account count.
  const summary = {
    qty: accountRows.length,
    interest: centavosToPesoString(sumPesoCentavos(accountRows.map((r) => r.interest))),
    grandTotal: centavosToPesoString(sumPesoCentavos(accountRows.map((r) => r.grandTotal))),
    payment: centavosToPesoString(sumPesoCentavos(accountRows.map((r) => r.payment))),
    balance: centavosToPesoString(sumPesoCentavos(accountRows.map((r) => r.balance))),
  };

  // Dedup keys for the import preview — same shape the importer builds per row
  // (original Code first, else customer + date + grand total).
  const ledgerKeys = ledger.map((l) =>
    layawayDedupKey({
      code: l.code,
      name: l.customerName,
      datePurchased: l.datePurchased,
      grandTotal: l.grandTotal,
    }),
  );

  // Export the currently filtered accounts in the fixed 11-column order, honoring
  // the selected card, date range (server-applied), and status/search filters.
  const exportLayaways = () => {
    downloadCsv(
      `layaways-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Code', value: (r) => r.code ?? '' },
        { header: 'Customer Name', value: (r) => r.customerName },
        { header: 'Status', value: (r) => r.status.replace(/_/g, ' ') },
        {
          header: 'Remarks / Financer',
          value: (r) => [r.financer, r.remarks].filter(Boolean).join(' · '),
        },
        { header: 'Date Purchased', value: (r) => r.datePurchased ?? '' },
        { header: 'Item', value: (r) => r.item ?? '' },
        { header: 'Interest', value: (r) => r.interest ?? '' },
        { header: 'Grand Total', value: (r) => r.grandTotal ?? '' },
        { header: 'Payment', value: (r) => r.payment ?? '' },
        { header: 'Balance', value: (r) => r.balance ?? '' },
        { header: 'Order / Account No.', value: (r) => r.accountNo },
      ],
      accountRows,
    );
  };

  const overdue = layaways.filter((l) => ['overdue', 'grace_period'].includes(l.status));
  const forfeitureReview = layaways.filter((l) => l.status === 'forfeiture_eligible');
  const installmentAccounts = layaways.filter((l) => l.installments.length > 0);

  return (
    <div className="space-y-4">
      {/* Financial summary for the selected section + date range (Owner request
          2026-07-27). Totals are computed from the rows currently shown. */}
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
        data-testid="layaway-financial-summary"
      >
        {(
          [
            ['Total Qty (Items)', String(summary.qty), false],
            ['Total Interest', summary.interest, true],
            ['Grand Total', summary.grandTotal, true],
            ['Payment', summary.payment, true],
            ['Balance', summary.balance, true],
          ] as const
        ).map(([label, value, isMoney]) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 pt-5">
            <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">
              {isMoney ? money(value) : value}
            </p>
          </div>
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
        <div className="mb-4 flex justify-end">
          <Button type="button" onClick={() => setShowRecord(true)}>
            ＋ Record Payment
          </Button>
        </div>
      )}

      {/* Record Payment opens in the standard centered dialog — never inline. */}
      <Modal
        open={showRecord}
        onClose={() => setShowRecord(false)}
        title="Record Payment"
        description="Records submitted evidence. It does not verify and reduces no balance until verified."
        size="lg"
      >
        <RecordPaymentForm
          orders={payableOrders}
          embedded
          onRecorded={() => {
            setShowRecord(false);
            router.refresh();
          }}
        />
      </Modal>

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
                          <OrderNumberButton
                            orderId={p.officialOrderId}
                            label={p.orderNumber}
                            onOpen={setDetailOrderId}
                          />{' '}
                          · {p.invoiceNumber} · {money(p.amount)} ·{' '}
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
                            <MoneyInput
                              id={`amt-${p.paymentId}`}
                              name="verifiedAmount"
                              required
                              defaultValue={p.amount}
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
        <>
          {/* One row after + New Entry: section-navigation buttons, then Upload
              and Export. The section buttons switch which records the table + the
              financial summary above show — client-side, no page reload. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {canMonitorLayaway ? (
              <NewLayawayForm
                payableOrders={payableOrders}
                verifiedPayments={history
                  .filter((h) => h.status === 'verified' && !h.voided && !h.reversed)
                  .map((h) => ({
                    paymentId: h.paymentId,
                    orderNumber: h.orderNumber,
                    verifiedAmount: h.verifiedAmount,
                  }))}
              />
            ) : null}

            {(
              [
                ['active', 'Active Layaways'],
                ['completed', 'Completed Layaways'],
                ['all', 'All Layaways'],
                ['overdue', 'Overdue'],
                ['forfeited', 'Forfeited'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={section === key ? 'default' : 'outline'}
                aria-pressed={section === key}
                data-testid={`layaway-section-${key}`}
                onClick={() => setSection(key)}
              >
                {label}
              </Button>
            ))}

            {canImportLayaway ? (
              <LayawayImportButton existingKeys={ledgerKeys} />
            ) : null}
            {canImportLayaway && ledger.length > 0 ? (
              <DeleteAllLedgerButton count={ledger.length} />
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={exportLayaways}
              data-testid="layaway-export"
            >
              ⭳ Export CSV
            </Button>
          </div>

          {layaways.length > 0 || ledger.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={laySearch}
                onChange={(e) => setLaySearch(e.target.value)}
                placeholder="Search customer, account no., remarks…"
                aria-label="Search layaways"
                data-testid="layaway-search"
                className="h-9 flex-1 min-w-[12rem] rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
              />
              <select
                value={layFinancer}
                onChange={(e) => setLayFinancer(e.target.value)}
                aria-label="Filter by financer"
                data-testid="layaway-filter-financer"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
              >
                <option value="all">All financers</option>
                {financers.map((f) => (
                  <option key={f.id} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {accountRows.length} shown
              </span>
            </div>
          ) : null}
          <LayawayTable
            rows={accountRows}
            onOpenOrder={setDetailOrderId}
            financers={financers}
            canManage={canMonitorLayaway}
            canDeleteLedger={canImportLayaway}
          />
        </>
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
                      <OrderNumberButton
                        orderId={l.officialOrderId}
                        label={l.orderNumber}
                        onOpen={setDetailOrderId}
                      />
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {l.installments.map((i) => (
                        <li
                          key={i.number}
                          className="flex flex-wrap justify-between gap-2"
                        >
                          <span>
                            #{i.number} · due {i.dueDate} · {money(i.amountDue)}
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
          onOpenOrder={setDetailOrderId}
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
                      <OrderNumberButton
                        orderId={l.officialOrderId}
                        label={l.orderNumber}
                        onOpen={setDetailOrderId}
                      />{' '}
                      · outstanding {money(l.outstandingBalance)}
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
                    <td className="px-2.5 py-2 font-mono">
                      <OrderNumberButton
                        orderId={h.officialOrderId}
                        label={h.orderNumber}
                        onOpen={setDetailOrderId}
                      />
                    </td>
                    <td className="px-2.5 py-2">{h.customerDisplayName}</td>
                    <td className="px-2.5 py-2">
                      {h.paymentMethod?.replace('_', ' ') ?? '—'}
                    </td>
                    <td className="px-2.5 py-2 font-mono">{h.referenceNumber ?? '—'}</td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {money(h.amount)}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {h.verifiedAmount ? money(h.verifiedAmount) : '—'}
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
          onOpenOrder={setDetailOrderId}
        />
      ) : null}

      {!canMonitorLayaway ? (
        <p className="text-xs text-muted-foreground">
          Layaway actions require the Layaway Monitoring permission.
        </p>
      ) : null}

      {/* Shared in-page order details — click any order number above to open it.
          The workspace stays mounted behind it; an in-modal action refreshes only
          that order's data and these counts. */}
      <OrderDetailsModal
        orderId={detailOrderId}
        onClose={() => setDetailOrderId(null)}
        onMutated={() => router.refresh()}
      />
    </div>
  );
}

/**
 * Layaway Accounts table. Fixed columns: Customer Name · Status · Remarks · Date
 * Purchased · Item · Interest · Grand Total · Payment · Balance · Order/Account
 * No. · Actions. Rows come from BOTH real (derived) layaways and imported ledger
 * accounts, in one shape. Every peso is authoritative (never computed here) and
 * masks under Privacy Mode. Headers always show; an empty result is a single
 * full-width row, never a large empty box.
 */
function LayawayTable({
  rows,
  onOpenOrder,
  financers,
  canManage,
  canDeleteLedger,
}: {
  rows: LayawayAccountRow[];
  onOpenOrder: (orderId: string) => void;
  financers: Financer[];
  canManage: boolean;
  /** Owner/Admin: imported ledger rows get a Delete action. */
  canDeleteLedger: boolean;
}) {
  const money = usePrivacyMoney();
  const cash = (v: string | null) => (v ? money(v) : '—');
  const today = new Date().toISOString().slice(0, 10);
  // Overdue = an ACTIVE account past its Next Due Date that still owes a balance.
  // Completed / forfeited / cancelled are never overdue; no due date → '—'.
  const overdueLabel = (r: LayawayAccountRow): string => {
    if (r.status !== 'active') return '—';
    if (!r.nextDueDate) return '—';
    const owes = sumPesoCentavos([r.balance]) > 0n;
    return r.nextDueDate < today && owes ? 'Yes' : 'No';
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[1120px] text-left text-xs" data-testid="layaway-table">
        <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="px-2.5 py-2">Code</th>
            <th className="px-2.5 py-2">Customer Name</th>
            <th className="px-2.5 py-2">Status</th>
            <th className="px-2.5 py-2">Remarks / Financer</th>
            <th className="px-2.5 py-2">Date Purchased</th>
            <th className="px-2.5 py-2">Overdue</th>
            <th className="px-2.5 py-2 text-right">Item</th>
            <th className="px-2.5 py-2 text-right">Interest</th>
            <th className="px-2.5 py-2 text-right">Grand Total</th>
            <th className="px-2.5 py-2 text-right">Payment</th>
            <th className="px-2.5 py-2 text-right">Balance</th>
            <th className="px-2.5 py-2">Next Due Date</th>
            <th className="px-2.5 py-2">Order / Account No.</th>
            <th className="px-2.5 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={14} className="px-2.5 py-6 text-center text-muted-foreground">
                No layaway accounts found.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="hover:bg-accent/40">
                <td className="px-2.5 py-2 font-mono font-semibold">{r.code ?? '—'}</td>
                <td className="px-2.5 py-2 font-medium">{r.customerName}</td>
                <td className="px-2.5 py-2">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 capitalize ${layawayStatusClass(
                      r.status,
                    )}`}
                  >
                    {r.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-2.5 py-2 text-muted-foreground">
                  {[r.financer, r.remarks].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap">{r.datePurchased ?? '—'}</td>
                <td className="px-2.5 py-2">
                  {(() => {
                    const o = overdueLabel(r);
                    return o === 'Yes' ? (
                      <span className="font-medium text-destructive">Yes</span>
                    ) : (
                      <span className="text-muted-foreground">{o}</span>
                    );
                  })()}
                </td>
                <td className="px-2.5 py-2 text-right tabular-nums">{cash(r.item)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{cash(r.interest)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{cash(r.grandTotal)}</td>
                <td className="px-2.5 py-2 text-right tabular-nums">{cash(r.payment)}</td>
                <td className="px-2.5 py-2 text-right font-semibold tabular-nums">
                  {cash(r.balance)}
                  {r.balanceMismatch ? (
                    <span
                      className="ml-1 text-amber-600"
                      title="Balance ≠ Grand Total − Payment (flagged for review)"
                    >
                      ⚠
                    </span>
                  ) : null}
                </td>
                <td className="px-2.5 py-2 whitespace-nowrap">{r.nextDueDate ?? '—'}</td>
                <td className="px-2.5 py-2 font-mono text-[11px]">
                  {r.officialOrderId ? (
                    <OrderNumberButton
                      orderId={r.officialOrderId}
                      label={r.accountNo}
                      onOpen={onOpenOrder}
                    />
                  ) : (
                    r.accountNo
                  )}
                </td>
                <td className="px-2.5 py-2 text-right">
                  {r.officialOrderId && r.layawayRow ? (
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenOrder(r.officialOrderId as string)}
                        data-testid={`layaway-view-${r.layawayRow.layawayId}`}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                      >
                        View
                      </button>
                      {canManage ? (
                        <LayawayDetailsModal row={r.layawayRow} financers={financers} />
                      ) : null}
                    </div>
                  ) : r.ledgerId ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      <LayawayLedgerViewModal ledgerId={r.ledgerId} />
                      {canDeleteLedger ? (
                        <>
                          {r.status === 'active' ? (
                            <LedgerAddPayment
                              id={r.ledgerId}
                              accountNo={r.accountNo}
                              customerName={r.customerName}
                              balance={r.balance}
                            />
                          ) : null}
                          <LedgerEditAccount id={r.ledgerId} accountNo={r.accountNo} />
                          <LedgerRowDelete
                            id={r.ledgerId}
                            accountNo={r.accountNo}
                            customerName={r.customerName}
                          />
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Owner/Admin permanent delete of ONE imported layaway ledger account. Irreversible
 * "type DELETE" confirmation; removes only the flat imported row (no order, payment,
 * or arrangement). The server action + DB function are the real gates.
 */
function LedgerRowDelete({
  id,
  accountNo,
  customerName,
}: {
  id: string;
  accountNo: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (pending || confirm !== 'DELETE') return;
    setPending(true);
    setError(null);
    const res = await deleteLayawayLedgerRowAction(id);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setOpen(false);
    setPending(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirm('');
          setError(null);
          setOpen(true);
        }}
        data-testid={`ledger-delete-${id}`}
        className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Permanently delete layaway account"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run()}
              disabled={pending || confirm !== 'DELETE'}
            >
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            Delete the imported account{' '}
            <span className="font-mono">{accountNo}</span> for{' '}
            <strong>{customerName}</strong>? This removes only this imported ledger row.
          </p>
          <div>
            <Label htmlFor={`ledger-delete-confirm-${id}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`ledger-delete-confirm-${id}`}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

/**
 * Owner/Admin bulk clear of ALL imported layaway ledger accounts. Same irreversible
 * "type DELETE" confirmation; clears only the imported ledger — order-derived
 * layaways are untouched.
 */
function DeleteAllLedgerButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (pending || confirm !== 'DELETE') return;
    setPending(true);
    setError(null);
    const res = await deleteAllLayawayLedgerAction();
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setOpen(false);
    setPending(false);
    router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          setConfirm('');
          setError(null);
          setOpen(true);
        }}
        data-testid="ledger-delete-all"
        className="text-destructive"
      >
        🗑 Delete all imported
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete ALL imported layaway accounts"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run()}
              disabled={pending || confirm !== 'DELETE'}
            >
              {pending ? 'Deleting…' : `Delete all ${count}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            Permanently delete <strong>all {count}</strong> imported layaway accounts?
            This clears only the imported ledger — layaways created from real orders are
            not affected.
          </p>
          <div>
            <Label htmlFor="ledger-delete-all-confirm" className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id="ledger-delete-all-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

function LayawayList({
  rows,
  emptyTitle,
  note,
  onOpenOrder,
  financers = [],
  canManage = false,
}: {
  rows: LayawayRow[];
  emptyTitle: string;
  note?: string;
  onOpenOrder: (orderId: string) => void;
  financers?: Financer[];
  canManage?: boolean;
}) {
  // Privacy Mode (§6): mask money in this list too. Hook runs before any return.
  const money = usePrivacyMoney();
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
                    <OrderNumberButton
                      orderId={l.officialOrderId}
                      label={l.orderNumber}
                      onOpen={onOpenOrder}
                    />{' '}
                    · {l.invoiceNumber}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs capitalize ${layawayStatusClass(
                    l.status,
                  )}`}
                >
                  {l.status.replace(/_/g, ' ')}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                {(
                  [
                    ['Total payable', money(l.totalAmountPayable)],
                    ['Verified paid', money(l.verifiedNetPayments)],
                    ['Outstanding', money(l.outstandingBalance)],
                    ['Layaway fee', l.layawayFee ? money(l.layawayFee) : '—'],
                    ['Financer', l.financer ?? '—'],
                    ['Current holder', l.currentHolder ?? '—'],
                    ['Current location', l.currentLocation ?? '—'],
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
                  Overpayment Credit {money(l.overpaymentCredit)} — unresolved.
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

              {l.remarks ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium">Remarks:</span> {l.remarks}
                </p>
              ) : null}

              {canManage ? (
                <div className="mt-2">
                  <LayawayDetailsModal row={l} financers={financers} />
                </div>
              ) : null}

              {note ? <p className="mt-2 text-xs text-muted-foreground">{note}</p> : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
