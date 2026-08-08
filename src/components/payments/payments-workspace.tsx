'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState } from 'react';

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
import { LayawayNewEntry } from '@/components/payments/layaway-new-entry';
import { requestDeletionAction } from '@/lib/authz/deletion-actions';
import type { CaptureItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';
import { LedgerEditAccount } from '@/components/payments/layaway-ledger-actions';
import { layawayDedupKey } from '@/lib/import/layaway-csv';
import { RecordPaymentForm } from '@/components/payments/record-payment-form';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
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
function layawayStatusClass(rawStatus: string): string {
  // Case-insensitive: an imported `COMPLETED` must colour like `completed`.
  const status = rawStatus.trim().toLowerCase();
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
  /** First upcoming installment due date. Kept for the OVERDUE calculation, the
   *  View modal, reminders, and the Dashboard — it is no longer a table column. */
  nextDueDate: string | null;
  /** When the account actually closed out (derived: completedAt; ledger: last payment). */
  completionDate: string | null;
  datePurchased: string | null;
  item: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  accountNo: string;
  /** Linked inventory Unique Code(s); null → "Not linked". */
  uniqueCode: string | null;
  /** Facebook Messenger URL for a quick "Open Chat" button (or null). */
  facebookUrl: string | null;
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
    completionDate: l.completedAt ? l.completedAt.slice(0, 10) : null,
    datePurchased: l.datePurchased ? l.datePurchased.slice(0, 10) : null,
    item: l.itemAmount,
    interest: l.layawayFee,
    grandTotal: l.totalAmountPayable,
    payment: l.verifiedNetPayments,
    balance: l.outstandingBalance,
    accountNo: l.orderNumber,
    uniqueCode: l.uniqueCode,
    facebookUrl: l.facebookUrl,
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
    completionDate: l.lastPaymentDate,
    datePurchased: l.datePurchased,
    item: l.itemAmount,
    interest: l.interest,
    grandTotal: l.grandTotal,
    payment: l.payment,
    balance: l.balance,
    accountNo: l.accountNo,
    uniqueCode: l.uniqueCode,
    facebookUrl: l.facebookUrl,
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

/**
 * Today in the USER'S LOCAL date. `toISOString()` yields the UTC date, which in the
 * Philippines (UTC+8) flips a day early and would mark accounts overdue too soon.
 */
function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Status text is compared case- and space-insensitively throughout, so a record
 * imported as `COMPLETED`, `Completed`, or `completed` is ONE status. Sources
 * differ (manual entry, order transfer, CSV import, auto-completion on full
 * payment) and must never split into separate buckets.
 */
function normStatus(status: string): string {
  return status.trim().toLowerCase();
}
function isCompletedStatus(status: string): boolean {
  return normStatus(status) === 'completed';
}

/** Statuses where an account is closed — never active and never overdue. */
const TERMINAL_STATUSES = new Set(['completed', 'forfeited', 'cancelled']);
/** Order-derived statuses the database already computed as past due. */
const DERIVED_OVERDUE_STATUSES = new Set(['overdue', 'grace_period', 'forfeiture_eligible']);
/** Imported rows flagged ERROR — never counted, listed, or summed anywhere. */
const EXCLUDED_STATUSES = new Set(['needs_review']);

/**
 * Overdue = a live account whose Next Due Date has passed and that still owes money.
 * Completed / forfeited / cancelled are never overdue, so paying an account off,
 * moving its due date, completing, forfeiting, or cancelling it removes it from
 * Overdue automatically on the next render — no stored flag to go stale.
 */
function isOverdueRow(r: LayawayAccountRow, today: string): boolean {
  if (TERMINAL_STATUSES.has(normStatus(r.status))) return false;
  if (sumPesoCentavos([r.balance]) <= 0n) return false;
  if (DERIVED_OVERDUE_STATUSES.has(normStatus(r.status))) return true;
  return r.nextDueDate !== null && r.nextDueDate < today;
}

/**
 * A COMPLETED layaway must have genuinely closed out: zero remaining balance AND
 * total payment equal to the grand total. An account marked completed while
 * principal or interest is still owed is invalid and is never shown as Completed.
 *
 * Deliberately does NOT require a non-zero grand total. Most imported historical
 * accounts closed long ago and carry no money columns at all (grand total and
 * payment both blank); they are perfectly valid completed records, and an earlier
 * `grand > 0` guard wrongly hid 191 of them from Completed Layaways.
 */
function isValidCompletedRow(r: LayawayAccountRow): boolean {
  if (!isCompletedStatus(r.status)) return false;
  const grand = sumPesoCentavos([r.grandTotal]);
  const paid = sumPesoCentavos([r.payment]);
  const balance = sumPesoCentavos([r.balance]);
  // `<=` / `>=` rather than `===`: a handful of imported accounts were overpaid by
  // a peso, so the balance reads -1.00. Nothing is owed on those, which is what
  // "completed" means. A completed record that STILL OWES money is the invalid
  // case, and it is the one this keeps out.
  return balance <= 0n && paid >= grand;
}

/** The account's financer — the order's financer, else its Remarks / Financer text. */
function financerOf(r: LayawayAccountRow): string {
  return (r.financer ?? r.remarks ?? '').trim();
}
/** Case- and spacing-insensitive key so "nez", "NEZ", and "Nez  " are one financer. */
function financerKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
/** Sentinel dropdown values (a real financer name can never collide with these). */
const FINANCER_ALL = '__all__';
const FINANCER_NONE = '__none__';

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
  canEditLayaway,
  canDeleteLayaway,
  canDeleteAllLedger,
  canImportExport,
  activeItems,
  captureCustomers,
  admins,
  detectedFinancers,
  canCreateLayaway,
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
  /** Manage Access `layaway_edit` — gates the per-row Edit of a layaway account. */
  canEditLayaway: boolean;
  /** Manage Access `layaway_delete` — gates the per-row Delete of a layaway account. */
  canDeleteLayaway: boolean;
  /** Owner ONLY — clearing the entire imported ledger is not an admin action. */
  canDeleteAllLedger: boolean;
  /** SUPER ADMIN only — Excel/CSV import and export (Owner request). */
  canImportExport: boolean;
  /** Active Inventory, for the New Entry item selector (§1). */
  activeItems: CaptureItem[];
  captureCustomers: string[];
  admins: AdminNameContext;
  /** Every DETECTED financer (configured + seen on layaway remarks), for the New
   *  Entry Remarks/Financer selector. */
  detectedFinancers: string[];
  /** Owner/Admin only — the same gate the database applies on save. */
  canCreateLayaway: boolean;
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
  const [layFinancer, setLayFinancer] = useState(FINANCER_ALL);

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

  // EVERY layaway account in one shape — order-derived and imported ledger alike —
  // so sections, the financer filter, and the summary all classify them identically.
  // Rows flagged Needs Review (imported ERROR rows) are dropped up front: they are
  // never listed, filtered, or summed anywhere.
  const today = todayLocalISO();
  const allAccounts: LayawayAccountRow[] = useMemo(
    () =>
      [
        ...layaways.map(fromDerived),
        ...completed.map(fromDerived),
        ...ledger.map(fromLedger),
      ].filter((r) => !EXCLUDED_STATUSES.has(normStatus(r.status))),
    [layaways, completed, ledger],
  );

  // The financer dropdown builds itself from the Remarks / Financer values already
  // stored on the accounts (plus any configured financer), so a newly typed name
  // appears automatically — no separate financer setup step. Duplicates differing
  // only by case or spacing collapse into one entry that keeps its original display.
  const financerOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const name of [
      ...allAccounts.map(financerOf),
      ...financers.map((f) => f.name),
    ]) {
      const display = name.trim();
      if (!display) continue;
      const key = financerKey(display);
      if (!byKey.has(key)) byKey.set(key, display);
    }
    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allAccounts, financers]);

  // Section + financer + search, applied to the merged set. Active EXCLUDES overdue
  // so no account is ever listed (or counted) in both views.
  const accountRows: LayawayAccountRow[] = useMemo(() => {
    const q = laySearch.trim().toLowerCase();
    return allAccounts.filter((r) => {
      const overdue = isOverdueRow(r, today);
      const inSection =
        section === 'all'
          ? true
          : section === 'completed'
            ? isValidCompletedRow(r)
            : section === 'overdue'
              ? overdue
              : section === 'forfeited'
                ? normStatus(r.status) === 'forfeited'
                : !TERMINAL_STATUSES.has(normStatus(r.status)) && !overdue;
      if (!inSection) return false;

      if (layFinancer !== FINANCER_ALL) {
        const name = financerOf(r);
        if (layFinancer === FINANCER_NONE) {
          if (name) return false;
        } else if (financerKey(name) !== layFinancer) {
          return false;
        }
      }

      if (!q) return true;
      // Searchable by Inventory Unique Code, Layaway Code, customer, financer,
      // remarks, and the internal Order/Account No. fallback.
      return `${r.uniqueCode ?? ''} ${r.code ?? ''} ${r.accountNo} ${r.customerName} ${r.financer ?? ''} ${r.remarks ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [allAccounts, section, layFinancer, laySearch, today]);

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
        { header: 'Unique Code', value: (r) => r.uniqueCode ?? 'Not linked' },
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
            {/* ONE + New Entry, leading the row (Owner request). The old
                order-derived NewLayawayForm was removed from here: it created a
                layaway from an existing paid order, which the manual encoder now
                covers end to end, and two identically-labelled buttons side by
                side were indistinguishable. */}
            <LayawayNewEntry
              items={activeItems}
              customers={captureCustomers}
              financers={detectedFinancers}
              admins={admins}
              canCreate={canCreateLayaway}
            />

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

            {canImportExport ? <LayawayImportButton existingKeys={ledgerKeys} /> : null}
            {canImportExport ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={exportLayaways}
                data-testid="layaway-export"
              >
                ⭳ Export CSV
              </Button>
            ) : null}

            {/* Destructive, so it sits LAST and pushed right — never beside the
                everyday actions where it can be hit by reflex. */}
            {canDeleteAllLedger && ledger.length > 0 ? (
              <span className="ml-auto">
                <DeleteAllLedgerButton count={ledger.length} />
              </span>
            ) : null}
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
                <option value={FINANCER_ALL}>All Financers</option>
                {financerOptions.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
                <option value={FINANCER_NONE}>(No financer)</option>
              </select>
              <span className="text-xs text-muted-foreground">
                {accountRows.length} shown
              </span>
            </div>
          ) : null}
          {section === 'completed' ? (
            <CompletedLayawayTable
              rows={accountRows}
              onOpenOrder={setDetailOrderId}
              canDeleteLayaway={canDeleteLayaway}
              isSuperAdmin={canDeleteAllLedger}
            />
          ) : (
            <LayawayTable
              rows={accountRows}
              onOpenOrder={setDetailOrderId}
              financers={financers}
              canManage={canMonitorLayaway}
              canDeleteLedger={canImportLayaway}
              canEditLayaway={canEditLayaway}
              canDeleteLayaway={canDeleteLayaway}
              isSuperAdmin={canDeleteAllLedger}
              today={today}
            />
          )}
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
            <table className="data-table w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2 text-right">Claimed</th>
                  <th className="px-3 py-2 text-right">Verified</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((h) => (
                  <tr key={h.paymentId}>
                    <td className="px-3 py-2 font-mono">
                      <OrderNumberButton
                        orderId={h.officialOrderId}
                        label={h.orderNumber}
                        onOpen={setDetailOrderId}
                      />
                    </td>
                    <td className="px-3 py-2">{h.customerDisplayName}</td>
                    <td className="px-3 py-2">
                      {h.paymentMethod?.replace('_', ' ') ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono">{h.referenceNumber ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(h.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {h.verifiedAmount ? money(h.verifiedAmount) : '—'}
                    </td>
                    <td className="px-3 py-2">
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
  canEditLayaway,
  canDeleteLayaway,
  isSuperAdmin,
  today,
}: {
  rows: LayawayAccountRow[];
  onOpenOrder: (orderId: string) => void;
  financers: Financer[];
  canManage: boolean;
  /** Owner/Admin: whether the View modal offers Add Payment (non-terminal rows). */
  canDeleteLedger: boolean;
  /** Manage Access `layaway_edit` — shows the per-row Edit action. */
  canEditLayaway: boolean;
  /** Manage Access `layaway_delete` — shows the per-row Delete action. */
  canDeleteLayaway: boolean;
  /** Super Admin deletes directly; an Admin only requests (§2). */
  isSuperAdmin: boolean;
  /** The user's LOCAL date — overdue is judged against it, never a UTC date. */
  today: string;
}) {
  const money = usePrivacyMoney();
  const cash = (v: string | null) => (v ? money(v) : '—');
  // Overdue uses the one shared rule, so the badge and the Overdue section can
  // never disagree. Closed accounts and accounts with no due date show '—'.
  const overdueLabel = (r: LayawayAccountRow): string => {
    if (TERMINAL_STATUSES.has(normStatus(r.status))) return '—';
    if (!r.nextDueDate && !DERIVED_OVERDUE_STATUSES.has(normStatus(r.status))) return '—';
    return isOverdueRow(r, today) ? 'Yes' : 'No';
  };

  // Render pagination — window to the current page (50) so a large account list doesn't
  // put every row in the DOM. Resets to page 1 when the filtered rows change.
  const [layPage, setLayPage] = useState(1);
  const LAY_PAGE_SIZE = 25;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLayPage(1);
  }, [rows]);
  const layPageCount = Math.max(1, Math.ceil(rows.length / LAY_PAGE_SIZE));
  const layPageSafe = Math.min(layPage, layPageCount);
  const pagedRows = rows.slice((layPageSafe - 1) * LAY_PAGE_SIZE, layPageSafe * LAY_PAGE_SIZE);

  return (
    <div>
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table
        className="data-table data-roomy w-full min-w-[1000px] text-left text-xs"
        data-testid="layaway-table"
      >
        {/* Owner width spec: Unique Code + Customer Name are the two widest; Code and
            Overdue stay compact; Actions pinned right. Width HINTS (no table-fixed), so
            a column can still grow to fit its content and nothing is clipped. */}
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Unique Code</th>
            <th className="px-3 py-2 text-left">Customer Name</th>
            <th className="col-center px-3 py-2">Code</th>
            <th className="px-3 py-2 text-left">Remarks / Financer</th>
            <th className="col-num px-3 py-2">Total Amount</th>
            <th className="col-center px-3 py-2">Date Purchased</th>
            <th className="col-center px-3 py-2">Overdue</th>
            <th className="col-actions px-3 py-2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="px-2.5 py-6 text-center text-muted-foreground">
                No layaway accounts found.
              </td>
            </tr>
          ) : (
            pagedRows.map((r) => (
              <tr key={r.key} className="hover:bg-accent/40">
                <td
                  className="truncate px-3 py-2 font-mono text-[11px]"
                  title={`Unique Code${r.uniqueCode ? `: ${r.uniqueCode}` : ' — not linked'} · Order/Account No. ${r.accountNo}`}
                >
                  {r.officialOrderId ? (
                    <OrderNumberButton
                      orderId={r.officialOrderId}
                      label={r.uniqueCode ?? 'Not linked'}
                      onOpen={onOpenOrder}
                    />
                  ) : r.uniqueCode ? (
                    r.uniqueCode
                  ) : (
                    <span className="text-muted-foreground">Not linked</span>
                  )}
                </td>
                <td className="truncate px-3 py-2 font-medium" title={r.customerName}>
                  {r.customerName}
                </td>
                <td className="col-center truncate px-3 py-2 font-mono font-semibold">
                  {r.code ?? '—'}
                </td>
                <td
                  className="col-clip truncate px-3 py-2 text-muted-foreground"
                  title={[r.financer, r.remarks].filter(Boolean).join(' · ') || undefined}
                >
                  {[r.financer, r.remarks].filter(Boolean).join(' · ') || '—'}
                </td>
                {/* A Completed account is fully paid, so its Total Amount shows
                    nothing (Owner request). Full money detail stays in View. */}
                <td className="col-num px-3 py-2">
                  {isCompletedStatus(r.status) ? '—' : cash(r.item)}
                </td>
                <td className="col-center whitespace-nowrap px-3 py-2">
                  {r.datePurchased ?? '—'}
                </td>
                <td className="col-center px-3 py-2">
                  {(() => {
                    const o = overdueLabel(r);
                    return o === 'Yes' ? (
                      <span className="font-medium text-destructive">Yes</span>
                    ) : (
                      <span className="text-muted-foreground">{o}</span>
                    );
                  })()}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.officialOrderId && r.layawayRow ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenOrder(r.officialOrderId as string)}
                        data-testid={`layaway-view-${r.layawayRow.layawayId}`}
                        className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent"
                      >
                        View
                      </button>
                      {canManage ? (
                        <LayawayDetailsModal row={r.layawayRow} financers={financers} />
                      ) : null}
                    </div>
                  ) : r.ledgerId ? (
                    <div className="flex flex-nowrap items-center justify-end gap-2">
                      {/* Actions are View · Edit · Delete only, on ONE line. "Add
                          Payment" and "Cancel Order" live INSIDE the View modal. They
                          now show for EVERY active account — Owner, Admin, and Staff
                          (Owner request: all Admin/Staff need them on a layaway
                          account) — on any non-terminal account. Transfer-to-a-
                          destination stays manager-only (canDeleteLedger). Edit and
                          Delete are each gated by their own Manage Access permission
                          (the Owner holds both implicitly). */}
                      <LayawayLedgerViewModal
                        ledgerId={r.ledgerId}
                        canAddPayment={!TERMINAL_STATUSES.has(normStatus(r.status))}
                        canTransfer={canDeleteLedger}
                      />
                      {canEditLayaway ? (
                        <LedgerEditAccount id={r.ledgerId} accountNo={r.accountNo} />
                      ) : null}
                      {canDeleteLayaway ? (
                        <LedgerRowDelete isSuperAdmin={isSuperAdmin}
                          id={r.ledgerId}
                          accountNo={r.accountNo}
                          customerName={r.customerName}
                        />
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
    {rows.length > LAY_PAGE_SIZE ? (
      <Pagination
        page={layPageSafe}
        pageCount={layPageCount}
        total={rows.length}
        onPageChange={setLayPage}
        className="mt-3"
      />
    ) : null}
    </div>
  );
}

/**
 * Completed Layaways — the FINAL record of an account that genuinely closed out.
 * Only rows that passed `isValidCompletedRow` reach here (balance ₱0 AND total
 * payment equal to the grand total), so an account with unpaid principal or
 * interest can never be presented as completed. There is no Balance or Overdue
 * column because both are settled by definition; Completion Date replaces them.
 */
function CompletedLayawayTable({
  rows,
  onOpenOrder,
  canDeleteLayaway,
  isSuperAdmin,
}: {
  rows: LayawayAccountRow[];
  onOpenOrder: (orderId: string) => void;
  /** Manage Access `layaway_delete` — shows the per-row Delete action. */
  canDeleteLayaway: boolean;
  /** Super Admin deletes directly; an Admin only requests (§2). */
  isSuperAdmin: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table
        className="data-table w-full min-w-[1000px] text-left text-xs"
        data-testid="layaway-completed-table"
      >
        <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Customer Name</th>
            <th className="px-3 py-2">Remarks / Financer</th>
            <th className="px-3 py-2">Date Purchased</th>
            <th className="px-3 py-2 text-right">Item</th>
            <th className="px-3 py-2 text-right">Total Interest</th>
            <th className="px-3 py-2 text-right">Grand Total</th>
            <th className="px-3 py-2 text-right">Total Payment</th>
            <th className="px-3 py-2">Completion Date</th>
            <th className="px-3 py-2">Order / Account No.</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-2.5 py-6 text-center text-muted-foreground">
                No completed layaway accounts found.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="hover:bg-accent/40">
                <td className="px-3 py-2 font-mono font-semibold">{r.code ?? '—'}</td>
                <td className="px-3 py-2 font-medium">{r.customerName}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {[r.financer, r.remarks].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{r.datePurchased ?? '—'}</td>
                {/* Completed = fully paid: money columns are intentionally blank
                    (Owner request). */}
                <td className="px-3 py-2 text-right tabular-nums">—</td>
                <td className="px-3 py-2 text-right tabular-nums">—</td>
                <td className="px-3 py-2 text-right tabular-nums">—</td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">—</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.completionDate ?? '—'}</td>
                <td
                  className="px-3 py-2 font-mono text-[11px]"
                  title={`Unique Code${r.uniqueCode ? `: ${r.uniqueCode}` : ' — not linked'} · Order/Account No. ${r.accountNo}`}
                >
                  {r.officialOrderId ? (
                    <OrderNumberButton
                      orderId={r.officialOrderId}
                      label={r.uniqueCode ?? 'Not linked'}
                      onOpen={onOpenOrder}
                    />
                  ) : r.uniqueCode ? (
                    r.uniqueCode
                  ) : (
                    <span className="text-muted-foreground">Not linked</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.officialOrderId ? (
                    <button
                      type="button"
                      onClick={() => onOpenOrder(r.officialOrderId as string)}
                      className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent"
                    >
                      View
                    </button>
                  ) : r.ledgerId ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      <LayawayLedgerViewModal ledgerId={r.ledgerId} />
                      {canDeleteLayaway ? (
                        <LedgerRowDelete isSuperAdmin={isSuperAdmin}
                          id={r.ledgerId}
                          accountNo={r.accountNo}
                          customerName={r.customerName}
                        />
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
/**
 * Deleting a layaway account (§2).
 *
 * A SUPER ADMIN deletes directly — the type-DELETE confirmation stays, and the
 * deletion is recorded in the register afterwards. An ADMIN cannot delete: the
 * button becomes Request Deletion, which needs a reason and goes to the Super
 * Admin for a decision. Both paths are re-checked in SQL.
 */
function LedgerRowDelete({
  id,
  accountNo,
  customerName,
  isSuperAdmin,
}: {
  id: string;
  accountNo: string;
  customerName: string;
  isSuperAdmin: boolean;
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
    const res = await deleteLayawayLedgerRowAction(id, `Layaway ${accountNo}`);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setOpen(false);
    setPending(false);
    router.refresh();
  };

  // An Admin asks; only a Super Admin deletes (§2).
  if (!isSuperAdmin) {
    return (
      <LedgerRowRequestDeletion
        id={id}
        accountNo={accountNo}
        customerName={customerName}
      />
    );
  }

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
        className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
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
        🗑 Delete All
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

/**
 * The Admin's path: Request Deletion (§2).
 *
 * A reason is mandatory — a register of unexplained requests would be useless —
 * and the button reports honestly once the request is queued, so nobody presses
 * it twice expecting the record to disappear.
 */
function LedgerRowRequestDeletion({
  id,
  accountNo,
  customerName,
}: {
  id: string;
  accountNo: string;
  customerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const run = async () => {
    if (pending || !reason.trim()) return;
    setPending(true);
    setError(null);
    const res = await requestDeletionAction({
      entityType: 'layaway_ledger',
      entityId: id,
      entityLabel: `Layaway ${accountNo} — ${customerName}`,
      reason: reason.trim(),
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRequested(true);
    setOpen(false);
  };

  if (requested) {
    return (
      <span
        className="rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700"
        data-testid={`ledger-delete-requested-${id}`}
      >
        Deletion requested
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReason('');
          setError(null);
          setOpen(true);
        }}
        data-testid={`ledger-request-delete-${id}`}
        className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
      >
        Request Deletion
      </button>

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title="Request deletion"
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={pending || !reason.trim()}
              data-testid="ledger-request-delete-confirm"
            >
              {pending ? 'Sending…' : 'Send request'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm">
            Ask a Super Admin to delete account{' '}
            <span className="font-mono">{accountNo}</span> for{' '}
            <strong>{customerName}</strong>. Nothing is deleted until they approve.
          </p>
          <div>
            <Label htmlFor={`req-reason-${id}`} className="text-xs">
              Reason (required)
            </Label>
            <Input
              id={`req-reason-${id}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why should this be deleted?"
              className="mt-1 h-9"
              autoComplete="off"
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
