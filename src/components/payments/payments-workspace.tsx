'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import { Modal } from '@/components/ui/modal';
import {
  deleteAllLayawayLedgerAction,
  deleteLayawayLedgerRowAction,
  loadLayawayPageAction,
  rejectPaymentAction,
  requestForfeitureAction,
  requestLayawayLedgerDeletionAction,
  verifyPaymentAction,
} from '@/lib/payments/actions';
import type { PaymentActionState } from '@/lib/payments/action-state';
import { EMPTY_PAYMENT_STATE } from '@/lib/payments/action-state';
import { RANGE_LABEL, type DateRangeKey } from '@/lib/payments/format';
import { formatDate } from '@/lib/format/date';
import {
  countdownBadgeLabel,
  layawayOverdueDate,
  layawayRowCountdown,
  overdueColumnLabel,
} from '@/lib/payments/layaway-overdue';
import { cn } from '@/lib/utils';
import { usePrivacyMoney } from '@/components/shell/privacy';
import type {
  EvidenceQueueRow,
  LayawayRow,
  OverviewCards,
  PayableOrderRow,
  PaymentHistoryRow,
} from '@/lib/payments/workspace';
import type { Financer } from '@/lib/payments/financer';
import {
  financerKey,
  uniqueCodeLabel,
  type LayawayAccountRow,
} from '@/lib/payments/layaway-account-row';
import type {
  LayawayPageResult,
  LayawaySection,
  LayawaySummary,
} from '@/lib/payments/layaway-page';
import { LayawayDetailsModal } from '@/components/payments/layaway-details-modal';
import { LayawayImportButton } from '@/components/payments/layaway-import-modal';
import { LayawayNewEntry } from '@/components/payments/layaway-new-entry';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';
import { LedgerEditAccount } from '@/components/payments/layaway-ledger-actions';
import { RecordPaymentForm } from '@/components/payments/record-payment-form';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import { PageHeader, StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';
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

/** Layaway status → unified tone (§13) — same colour language as Orders. Colour +
 *  the written label, never colour alone. */
function layawayStatusTone(rawStatus: string): BadgeTone {
  // Case-insensitive: an imported `COMPLETED` must colour like `completed`.
  const status = rawStatus.trim().toLowerCase();
  switch (status) {
    case 'completed':
      return 'success'; // green — settled
    case 'active':
      return 'info'; // blue — in progress
    case 'grace_period':
      return 'warning'; // amber — attention
    case 'overdue':
    case 'cancelled':
    case 'forfeiture_eligible':
    case 'forfeited':
      return 'danger'; // red — overdue / stopped
    default:
      return 'neutral';
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
// LayawayAccountRow, fromLedger / fromDerived, uniqueCodeLabel and financerKey now live in
// '@/lib/payments/layaway-account-row' (shared with the server-side page reader so a row has
// ONE shape in the browser and the DB). LayawaySection is imported from
// '@/lib/payments/layaway-page'.

/**
 * Today as 'YYYY-MM-DD' in the business timezone (Asia/Manila, UTC+8, no DST). The Layaway row
 * countdown here AND the DB-backed "Near Overdue (30 Days)" count both use this SAME business
 * date, so a row's "Due today" / days-left and the card can never disagree by a day because of the
 * server's UTC clock or a viewer's timezone (the DB uses `now() at time zone 'Asia/Manila'`).
 */
function todayManilaISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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

/** Sentinel dropdown values (a real financer name can never collide with these). */
const FINANCER_ALL = '__all__';
const FINANCER_NONE = '__none__';

export function PaymentsWorkspace({
  queue,
  queueUnavailable,
  layaways,
  initialPage,
  ledgerCount,
  history,
  range,
  payableOrders,
  financers,
  canVerify,
  canMonitorLayaway,
  canRequestForfeiture,
  canImportLayaway,
  canEditLayaway,
  canDeleteLayaway,
  canDeleteAllLedger,
  canImportExport,
  admins,
  canCreateLayaway,
  initialSection,
  nearOverdueCount,
  title,
}: {
  cards: OverviewCards;
  /** Global count of ACTIVE accounts whose canonical overdue date (date purchased + 3 calendar
   *  months) is 1–30 days away — drives the amber "Near Overdue (30 Days)" card. DB-aggregated
   *  over the whole active dataset (never a page), monitoring only. */
  nearOverdueCount: number;
  /** Page title rendered inside the sticky top section (so it pins with the
   *  financial summary + date filters). When set, the page omits its own header. */
  title?: string;
  queue: EvidenceQueueRow[];
  /** Set when the queue read FAILED. An empty list and a failed read differ. */
  queueUnavailable: string | null;
  layaways: LayawayRow[];
  /** Server-rendered FIRST page of Layaway Accounts (section = initialSection). The client
   *  refetches subsequent pages / filters via loadLayawayPageAction — the browser never holds
   *  the whole ledger. */
  initialPage: LayawayPageResult;
  /** Total imported ledger accounts (for the Delete-All button + empty gating), counted in the
   *  DB — not derived from a full client-side load. */
  ledgerCount: number;
  history: PaymentHistoryRow[];
  range: DateRangeKey;
  payableOrders: PayableOrderRow[];
  financers: Financer[];
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
  admins: AdminNameContext;
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
  const today = todayManilaISO();
  // ── Server-side pagination (Owner request 2026-08-18, P1-B) ──────────────────────
  // The Layaway table no longer loads the whole ledger. The layaway_page RPC does the section
  // + search + financer filter, the EXACT total, the section counts and the financial summary
  // in the DB and returns ONE page. We seed from the server-rendered page 1 and refetch via
  // loadLayawayPageAction on every section / search / financer / page change.
  const [layPage, setLayPage] = useState(1);
  const [layPageSize, setLayPageSize] = useState(25);
  const [srv, setSrv] = useState<LayawayPageResult>(initialPage);
  const [layLoading, setLayLoading] = useState(false);
  const [debSearch, setDebSearch] = useState('');

  // Debounce the search box (spreadsheet-style); a new term resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebSearch(laySearch.trim());
      setLayPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [laySearch]);

  // A data-derived identity for the server page. DashboardSyncProvider calls router.refresh()
  // on any Realtime change, which re-runs the server component and hands us a fresh initialPage;
  // when its identity changes we refetch the CURRENT page (never resetting section/search/page).
  const syncKey = initialPage.ok
    ? `${initialPage.total}:${initialPage.rows[0]?.key ?? ''}:${initialPage.rows.length}`
    : 'error';

  // The first render IS the server-rendered page 1 — skip the redundant mount fetch.
  const firstFetch = useRef(true);
  useEffect(() => {
    if (firstFetch.current) {
      firstFetch.current = false;
      return;
    }
    let cancelled = false;
    setLayLoading(true);
    void loadLayawayPageAction({
      search: debSearch,
      section,
      financer: layFinancer,
      page: layPage,
      size: layPageSize,
    }).then((res) => {
      if (cancelled) return;
      setSrv(res);
      setLayLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debSearch, section, layFinancer, layPage, layPageSize, syncKey]);

  const accountRows: LayawayAccountRow[] = srv.ok ? srv.rows : [];
  const layTotal = srv.ok ? srv.total : 0;
  const readError = srv.ok ? null : srv.reason;

  // Financial summary for the CURRENT section + search + financer — computed in the DB over the
  // FULL filtered set, never just the visible page.
  const summary: LayawaySummary = srv.ok
    ? srv.summary
    : { qty: 0, interest: '0.00', grandTotal: '0.00', payment: '0.00', balance: '0.00' };

  // The financer dropdown builds itself from the dataset-wide Remarks / Financer values the RPC
  // returns (plus any configured financer), collapsing case/spacing duplicates into one entry.
  const financerOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const o of srv.ok ? srv.financerOptions : []) {
      if (!byKey.has(o.key)) byKey.set(o.key, o.label);
    }
    for (const f of financers) {
      const display = f.name.trim();
      if (!display) continue;
      const key = financerKey(display);
      if (!byKey.has(key)) byKey.set(key, display);
    }
    return [...byKey.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [srv, financers]);

  // Section / financer change reset to page 1 (search resets in its debounce above).
  const changeSection = (next: LayawaySection) => {
    setSection(next);
    setLayPage(1);
  };
  const changeFinancer = (next: string) => {
    setLayFinancer(next);
    setLayPage(1);
  };

  // Export honours the CURRENT section + search + financer, streamed server-side so the browser
  // never has to hold every matching row (scales to 50k+).
  const exportHref = `/api/layaway/export?${new URLSearchParams({
    section,
    ...(debSearch ? { search: debSearch } : {}),
    ...(layFinancer !== FINANCER_ALL ? { financer: layFinancer } : {}),
  }).toString()}`;

  const overdue = layaways.filter((l) => ['overdue', 'grace_period'].includes(l.status));
  const forfeitureReview = layaways.filter((l) => l.status === 'forfeiture_eligible');
  const installmentAccounts = layaways.filter((l) => l.installments.length > 0);

  return (
    <div className="space-y-4">
      {/* Sticky top section (Owner request): the title, the financial summary cards,
          and the date-range filters stay pinned while the layaway table scrolls
          beneath them. Opaque background bled to the content edges; z-20 above the
          table's sticky header. */}
      {/* Sticky only from `sm` up (Owner request) — matches Orders: on mobile the
          whole top section (title + summary cards + filters) scrolls normally so it
          never eats the small screen; on desktop it pins as before. */}
      <div className="space-y-4 sm:sticky sm:top-0 sm:z-20 sm:-mx-5 sm:border-b sm:border-border sm:bg-background sm:px-5 sm:py-3">
        {title ? <PageHeader title={title} /> : null}
        {/* Financial summary for the selected section + date range (Owner request
          2026-07-27). Totals are computed from the rows currently shown. */}
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
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
          {/* Near Overdue (30 Days) — GLOBAL count of ACTIVE accounts whose canonical overdue
            date (date purchased + 3 calendar months) is 1–30 days away. DB-aggregated over the
            whole active dataset (never the current page/filter); amber to match the row warnings.
            Not a money figure, so it never masks under Privacy Mode. */}
          <div
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 pt-5"
            data-testid="layaway-near-overdue-card"
          >
            <p className="text-[11px] leading-tight text-amber-700 dark:text-amber-400">
              Near Overdue (30 Days)
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
              {nearOverdueCount}
            </p>
          </div>
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
                            label={p.customerDisplayName}
                            onOpen={setDetailOrderId}
                          />{' '}
                          · {p.invoiceNumber} · {money(p.amount)} ·{' '}
                          {p.paymentMethod?.replace('_', ' ') ?? '—'}
                          {p.referenceNumber ? ` · ${p.referenceNumber}` : ''}
                          {p.provider ? ` · ${p.provider}` : ''}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Submitted{' '}
                          {new Date(p.recordedAt).toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}{' '}
                          ·{' '}
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
            <LayawayNewEntry admins={admins} canCreate={canCreateLayaway} />

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
                onClick={() => changeSection(key)}
              >
                {label}
              </Button>
            ))}

            {canImportExport ? <LayawayImportButton /> : null}
            {canImportExport ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => window.location.assign(exportHref)}
                data-testid="layaway-export"
              >
                ⭳ Export CSV
              </Button>
            ) : null}

            {/* Destructive, so it sits LAST and pushed right — never beside the
                everyday actions where it can be hit by reflex. */}
            {canDeleteAllLedger && ledgerCount > 0 ? (
              <span className="ml-auto">
                <DeleteAllLedgerButton count={ledgerCount} />
              </span>
            ) : null}
          </div>

          {ledgerCount > 0 || layaways.length > 0 ? (
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
                onChange={(e) => changeFinancer(e.target.value)}
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
              <span className="text-xs text-muted-foreground" data-testid="layaway-count">
                {layLoading ? 'Loading…' : `${layTotal.toLocaleString()} total`}
              </span>
            </div>
          ) : null}

          {readError ? (
            <div
              role="alert"
              data-testid="layaway-read-error"
              className="rounded-md border border-destructive/50 p-3 text-sm text-destructive"
            >
              The layaway accounts could not be read: {readError}
            </div>
          ) : section === 'completed' ? (
            <CompletedLayawayTable
              rows={accountRows}
              onOpenOrder={setDetailOrderId}
              canDeleteLayaway={canDeleteLayaway}
              isSuperAdmin={canDeleteAllLedger}
              total={layTotal}
              page={layPage}
              pageSize={layPageSize}
              loading={layLoading}
              onPageChange={setLayPage}
              onPageSizeChange={(n) => {
                setLayPageSize(n);
                setLayPage(1);
              }}
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
              total={layTotal}
              page={layPage}
              pageSize={layPageSize}
              loading={layLoading}
              onPageChange={setLayPage}
              onPageSizeChange={(n) => {
                setLayPageSize(n);
                setLayPage(1);
              }}
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
                        label={l.customerDisplayName}
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
                        label={l.customerDisplayName}
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
                        label={h.customerDisplayName}
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
          rows={[]}
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
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  onPageSizeChange,
}: {
  /** The CURRENT server page (already the right slice) — never re-sliced here. */
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
  /** DB total for the current section + filters — drives the page count and "of N". */
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const money = usePrivacyMoney();
  const cash = (v: string | null) => (v ? money(v) : '—');

  // Server-paginated: `rows` IS the current page (the DB already windowed it), so the browser
  // never holds more than one page even at 50k accounts. The page count comes from the DB total.
  const layPageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="table-scroll rounded-xl border border-border bg-card">
        <table
          className="data-table data-roomy lay-table w-full min-w-[1120px] text-left text-xs"
          data-testid="layaway-table"
        >
          {/* Owner width spec: Unique Code + Customer Name are the two widest; Code and
            Overdue stay compact; Actions pinned right. Width HINTS (no table-fixed), so
            a column can still grow to fit its content and nothing is clipped. */}
          <colgroup>
            <col style={{ width: '15%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="col-center px-3 py-2">Unique Code</th>
              <th className="px-3 py-2 text-left">Customer Name</th>
              <th className="col-center px-3 py-2">Code</th>
              <th className="col-center px-3 py-2">Remarks / Financer</th>
              <th className="col-center px-3 py-2">Total Amount</th>
              <th className="col-center px-3 py-2">Date Purchased</th>
              <th className="col-center px-3 py-2">Overdue Date</th>
              <th className="col-center px-3 py-2">Overdue</th>
              <th className="col-actions px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-2.5 py-6 text-center text-muted-foreground">
                  {loading ? 'Loading…' : 'No layaway accounts found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                // Canonical countdown from the Owner's rule (date purchased + 3 calendar months).
                // null for a closed / fully-paid / no-purchase-date row → no badge, no highlight.
                const cd = layawayRowCountdown(r, today);
                const overdueDate = TERMINAL_STATUSES.has(normStatus(r.status))
                  ? null
                  : layawayOverdueDate(r.datePurchased);
                return (
                  <tr
                    key={r.key}
                    className={cn(
                      'hover:bg-accent/40',
                      cd?.state === 'near' && 'bg-amber-500/[0.07]',
                      cd?.state === 'due_today' && 'bg-amber-500/10',
                      cd?.state === 'overdue' && 'bg-destructive/[0.07]',
                    )}
                  >
                    <td
                      className="truncate px-3 py-2 text-center font-mono text-[11px]"
                      title={`Unique Code${r.uniqueCode ? `: ${r.uniqueCode}` : ' — not linked'} · Order/Account No. ${r.accountNo}`}
                    >
                      {r.officialOrderId ? (
                        <OrderNumberButton
                          orderId={r.officialOrderId}
                          label={uniqueCodeLabel(r)}
                          onOpen={onOpenOrder}
                        />
                      ) : r.uniqueCode ? (
                        uniqueCodeLabel(r)
                      ) : (
                        <span className="text-muted-foreground">
                          {uniqueCodeLabel(r)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium" title={r.customerName}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate">{r.customerName}</span>
                        {cd && cd.state !== 'normal' ? (
                          <span
                            data-testid="layaway-days-badge"
                            className={cn(
                              'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              cd.state === 'overdue'
                                ? 'bg-destructive/15 text-destructive'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                            )}
                          >
                            {countdownBadgeLabel(cd)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="col-center truncate px-3 py-2 font-mono font-semibold">
                      {r.code ?? '—'}
                    </td>
                    <td
                      className="col-clip truncate px-3 py-2 text-center text-muted-foreground"
                      title={
                        [r.financer, r.remarks].filter(Boolean).join(' · ') || undefined
                      }
                    >
                      {[r.financer, r.remarks].filter(Boolean).join(' · ') || '—'}
                    </td>
                    {/* A Completed account is fully paid, so its Total Amount shows
                    nothing (Owner request). Full money detail stays in View. */}
                    <td className="col-center px-3 py-2 tabular-nums">
                      {isCompletedStatus(r.status) ? '—' : cash(r.item)}
                    </td>
                    <td className="col-center whitespace-nowrap px-3 py-2">
                      {r.datePurchased ? formatDate(r.datePurchased) : '—'}
                    </td>
                    {/* OVERDUE DATE — canonical = date purchased + 3 calendar months (Owner rule),
                    same long format as the rest of the app. Blank on a closed account. */}
                    <td className="col-center whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {overdueDate ? formatDate(overdueDate) : '—'}
                    </td>
                    {/* OVERDUE — No / Near Overdue / Due Today / Overdue, compact rounded badge. */}
                    <td className="col-center px-3 py-2">
                      {!cd || cd.state === 'normal' ? (
                        <span className="text-muted-foreground">
                          {overdueColumnLabel(cd)}
                        </span>
                      ) : cd.state === 'overdue' ? (
                        <span className="inline-block rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                          Overdue
                        </span>
                      ) : (
                        <span className="inline-block rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                          {overdueColumnLabel(cd)}
                        </span>
                      )}
                    </td>
                    <td className="col-actions px-3 py-2">
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
                            <LayawayDetailsModal
                              row={r.layawayRow}
                              financers={financers}
                            />
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
                            <LedgerRowDelete
                              isSuperAdmin={isSuperAdmin}
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
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {total > 0 ? (
        <Pagination
          page={Math.min(page, layPageCount)}
          pageCount={layPageCount}
          total={total}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          sticky
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
  total,
  page,
  pageSize,
  loading,
  onPageChange,
  onPageSizeChange,
}: {
  /** The CURRENT server page of completed accounts (already windowed by the DB). */
  rows: LayawayAccountRow[];
  onOpenOrder: (orderId: string) => void;
  /** Manage Access `layaway_delete` — shows the per-row Delete action. */
  canDeleteLayaway: boolean;
  /** Super Admin deletes directly; an Admin only requests (§2). */
  isSuperAdmin: boolean;
  /** DB total for the completed section + filters — drives the page count. */
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const layPageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div>
      <div className="table-scroll rounded-xl border border-border bg-card">
        <table
          className="data-table lay-table w-full min-w-[1000px] text-left text-xs"
          data-testid="layaway-completed-table"
        >
          <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="col-center px-3 py-2">Code</th>
              <th className="px-3 py-2">Customer Name</th>
              <th className="px-3 py-2">Remarks / Financer</th>
              <th className="px-3 py-2">Date Purchased</th>
              <th className="px-3 py-2 text-right">Item</th>
              <th className="px-3 py-2 text-right">Total Interest</th>
              <th className="px-3 py-2 text-right">Grand Total</th>
              <th className="px-3 py-2 text-right">Total Payment</th>
              <th className="px-3 py-2">Completion Date</th>
              <th className="px-3 py-2">Order / Account No.</th>
              <th className="col-actions px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={11}
                  className="px-2.5 py-6 text-center text-muted-foreground"
                >
                  {loading ? 'Loading…' : 'No completed layaway accounts found.'}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.key} className="hover:bg-accent/40">
                  <td className="col-center px-3 py-2 font-mono font-semibold">
                    {r.code ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-medium">{r.customerName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {[r.financer, r.remarks].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.datePurchased ? formatDate(r.datePurchased) : '—'}
                  </td>
                  {/* Completed = fully paid: money columns are intentionally blank
                    (Owner request). */}
                  <td className="px-3 py-2 text-right tabular-nums">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">—</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">—</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.completionDate ?? '—'}
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-[11px]"
                    title={`Unique Code${r.uniqueCode ? `: ${r.uniqueCode}` : ' — not linked'} · Order/Account No. ${r.accountNo}`}
                  >
                    {r.officialOrderId ? (
                      <OrderNumberButton
                        orderId={r.officialOrderId}
                        label={uniqueCodeLabel(r)}
                        onOpen={onOpenOrder}
                      />
                    ) : r.uniqueCode ? (
                      uniqueCodeLabel(r)
                    ) : (
                      <span className="text-muted-foreground">{uniqueCodeLabel(r)}</span>
                    )}
                  </td>
                  <td className="col-actions px-3 py-2">
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
                          <LedgerRowDelete
                            isSuperAdmin={isSuperAdmin}
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
      {total > 0 ? (
        <Pagination
          page={Math.min(page, layPageCount)}
          pageCount={layPageCount}
          total={total}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          sticky
        />
      ) : null}
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
            Delete the imported account <span className="font-mono">{accountNo}</span> for{' '}
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
                      label={l.customerDisplayName}
                      onOpen={onOpenOrder}
                    />{' '}
                    · {l.invoiceNumber}
                  </p>
                </div>
                <StatusBadge
                  label={l.status.replace(/_/g, ' ')}
                  tone={layawayStatusTone(l.status)}
                  className="capitalize"
                />
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
                  Overpayment Credit {money(l.overpaymentCredit)} — unresolved. Completion
                  is blocked until it is handled through the correction workflow.
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
    const res = await requestLayawayLedgerDeletionAction(
      id,
      `${accountNo} — ${customerName}`,
      reason.trim(),
    );
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
