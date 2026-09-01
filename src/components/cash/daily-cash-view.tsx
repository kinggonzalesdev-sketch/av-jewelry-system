'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addCashMovementAction,
  addExpenseAction,
  addRemittanceAction,
  deleteCashRecordAction,
  loadCashDetailAction,
  loadCashExportAction,
  loadCashSummaryAction,
  loadWalkInItemsAction,
  saveActualCashCountAction,
  updateCashMovementAction,
  updateExpenseAction,
  updateRemittanceAction,
} from '@/lib/cash/actions';
import {
  CASH_TABS,
  CASH_TAB_LABEL,
  type CashMovementRow,
  type CashPaymentRow,
  type CashTab,
  type DailyCashSummary,
  type DetailPage,
  type ExpenseRow,
  type MutationResult,
  type RemittanceRow,
  type TradeDeductionRow,
  type TradeExpenseRow,
  type WalkInRow,
} from '@/lib/cash/types';
import type { WalkInItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { OrderEdit } from '@/components/orders/order-edit';
import { OrderDelete } from '@/components/orders/cancelled-order-delete';
import { NewOrderModal } from '@/components/orders/new-order-workflow';
import { usePrivacyMoney } from '@/components/shell/privacy';
import { formatDateTime } from '@/lib/format/date';
import { toCsv, downloadCsvText } from '@/lib/export/csv';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal, ModalFormGrid, ModalFieldFull } from '@/components/ui/modal';
import { DataTable, Thead, Tr, Th, Td, EmptyRow } from '@/components/ui/data-table';
import { Pagination } from '@/components/ui/pagination';

/** The approved semantic palette (same meaning in light + dark). */
const C = {
  green: '#16A34A',
  blue: '#2563EB',
  purple: '#9333EA',
  red: '#DC2626',
  gold: '#D4AF67',
  amber: '#D97706',
};

/** Peso string → integer centavos (exact, no float). */
function toCents(s: string): bigint {
  const neg = s.trim().startsWith('-');
  const [w, f = ''] = s.replace('-', '').split('.');
  const c = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2) || '0');
  return neg ? -c : c;
}

export function DailyCashView({
  date: dateProp,
  summary: summaryProp,
  initialWalkIns,
  admins,
  canAddWalkIn,
  isOwner,
}: {
  date: string;
  summary: DailyCashSummary;
  initialWalkIns: DetailPage<WalkInRow>;
  /** Full admin-name context — the shared Walk-In modal needs it (not just the id). */
  admins: AdminNameContext;
  canAddWalkIn: boolean;
  /** The Owner may Edit / Delete a walk-in sale (order-level, guarded server-side). */
  isOwner: boolean;
}) {
  // The ENTIRE Daily Cash Summary lives in this one view — no interaction here ever
  // navigates or reloads the page (Owner request). The server props seed the initial
  // state; everything after (date change, edits) is handled in place, client-side.
  const [date, setDate] = useState(dateProp);
  const [summary, setSummary] = useState(summaryProp);
  // Privacy Mode (batch 2): mask every displayed peso to ₱•••••• when hidden. Screen-only
  // — the CSV export reads the raw summary values, so it is unaffected (§10).
  const money = usePrivacyMoney();
  const refreshSummary = async () => {
    setSummary(await loadCashSummaryAction(date));
  };

  // --- End of Day: actual cash count + live difference ----------------------
  // A Details-section edit refreshes `summary` but never resets `actual`, so the count
  // the user is entering is never cleared by switching tabs or saving a record (§7).
  const [actual, setActual] = useState(summaryProp.actualCount ?? '');
  const [savingCount, setSavingCount] = useState(false);

  // Changing the day STAYS in this section: re-read the day's summary in place and let
  // the Details section reload its active tab (it is keyed on `date`). The URL is
  // synced without a navigation, so a manual refresh still lands on the same day.
  const changeDate = async (next: string) => {
    if (!next || next === date) return;
    setDate(next);
    window.history.replaceState(null, '', `/cash/daily?date=${encodeURIComponent(next)}`);
    const fresh = await loadCashSummaryAction(next);
    setSummary(fresh);
    setActual(fresh.actualCount ?? ''); // a new day → its own saved count (or blank)
  };

  const diff = useMemo(() => {
    if (actual.trim() === '') return null;
    const d = toCents(actual) - toCents(summary.expected);
    return d; // centavos, signed
  }, [actual, summary.expected]);

  const diffLabel = (() => {
    if (diff === null) return { text: 'Enter count', tone: C.gold, badge: '' };
    if (diff === 0n) return { text: '✓ BALANCED', tone: C.green, badge: 'BALANCED' };
    if (diff < 0n) return { text: '! SHORT', tone: C.red, badge: 'SHORT' };
    return { text: '! OVER', tone: C.amber, badge: 'OVER' };
  })();
  const diffMoney =
    diff === null
      ? '—'
      : money(
          `${(diff < 0n ? -diff : diff) / 100n}.${String((diff < 0n ? -diff : diff) % 100n).padStart(2, '0')}`,
        );

  const saveCount = async () => {
    if (savingCount || actual.trim() === '') return;
    setSavingCount(true);
    await saveActualCashCountAction(date, actual, summary.expected);
    // Recalculate in place (close status → button label) without a reload, so the
    // count the user just entered stays put.
    await refreshSummary();
    setSavingCount(false);
  };

  // --- Export (§23: summary + detailed transactions) ------------------------
  const [exporting, setExporting] = useState(false);
  const diffSigned =
    diff === null
      ? ''
      : (diff < 0n ? '-' : '') +
        `${(diff < 0n ? -diff : diff) / 100n}.${String((diff < 0n ? -diff : diff) % 100n).padStart(2, '0')}`;

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const d = await loadCashExportAction(date);
      const sections: string[] = [];
      sections.push(
        toCsv<{ k: string; v: string }>(
          [
            { header: 'Field', value: (r) => r.k },
            { header: 'Amount', value: (r) => r.v },
          ],
          [
            { k: 'Date', v: date },
            { k: 'Cash Sales', v: summary.cashSales },
            { k: 'Previous Cash', v: summary.previousCash },
            { k: 'Other Cash In', v: summary.otherCashIn },
            { k: 'Expenses / Deductions', v: summary.expenses },
            { k: 'Remittance', v: summary.remittance },
            { k: 'Other Cash Out', v: summary.otherCashOut },
            { k: 'Scrap Cash-Out', v: summary.scrapCashOut },
            { k: 'Expected Cash on Hand', v: summary.expected },
            { k: 'Actual Cash Count', v: actual || '' },
            { k: 'Difference', v: diffSigned },
          ],
        ),
      );
      const section = (title: string, csv: string) => sections.push(`${title}\r\n${csv}`);
      section(
        'SALES WALK-INS',
        toCsv<WalkInRow>(
          [
            { header: 'Name', value: (r) => r.name },
            { header: 'Purchased Amount', value: (r) => r.purchased },
            { header: 'Depo/Bank/CC', value: (r) => r.nonCash },
            { header: 'Trade Deductions', value: (r) => r.tradeDeductions },
            { header: 'Cash Payments', value: (r) => r.cash },
          ],
          d.walkIns,
        ),
      );
      section(
        'CASH PAYMENTS',
        toCsv<CashPaymentRow>(
          [
            { header: 'Name', value: (r) => r.name },
            { header: 'Amount', value: (r) => r.amount },
            { header: 'Date / Time', value: (r) => r.at },
            { header: 'Reference', value: (r) => r.reference ?? '' },
          ],
          d.cashPayments,
        ),
      );
      section(
        'TRADE DEDUCTIONS',
        toCsv<TradeDeductionRow>(
          [
            { header: 'Name', value: (r) => r.name },
            { header: 'Label', value: (r) => r.label },
            { header: 'Amount', value: (r) => r.amount },
            { header: 'Date / Time', value: (r) => r.at },
          ],
          d.tradeDeductions,
        ),
      );
      section(
        'EXPENSES',
        toCsv<ExpenseRow>(
          [
            { header: 'Name / Payee', value: (r) => r.payee },
            { header: 'Amount', value: (r) => r.amount },
            { header: 'Category', value: (r) => r.category ?? '' },
            { header: 'Remarks', value: (r) => r.remarks ?? '' },
            { header: 'Date / Time', value: (r) => r.createdAt },
            { header: 'Created By', value: (r) => r.createdByName },
          ],
          d.expenses,
        ),
      );
      section(
        'MANUAL TRADES',
        toCsv<TradeExpenseRow>(
          [
            { header: 'Name', value: (r) => r.name },
            { header: 'Amount', value: (r) => r.amount },
            { header: 'Related Sale', value: (r) => r.relatedSale ?? '' },
            { header: 'Remarks', value: (r) => r.remarks ?? '' },
            { header: 'Date / Time', value: (r) => r.createdAt },
            { header: 'Recorded By', value: (r) => r.createdByName },
          ],
          d.trades,
        ),
      );
      section(
        'REMITTANCE',
        toCsv<RemittanceRow>(
          [
            { header: 'Amount', value: (r) => r.amount },
            {
              header: 'Reference / Remarks',
              value: (r) => r.reference || r.remarks || '',
            },
            { header: 'Date / Time', value: (r) => r.createdAt },
            { header: 'Recorded By', value: (r) => r.createdByName },
          ],
          d.remittances,
        ),
      );
      const movementCols = [
        { header: 'Type', value: (r: CashMovementRow) => r.movementType ?? '' },
        { header: 'Amount', value: (r: CashMovementRow) => r.amount },
        { header: 'Remarks', value: (r: CashMovementRow) => r.remarks ?? '' },
        { header: 'Date / Time', value: (r: CashMovementRow) => r.createdAt },
        { header: 'Recorded By', value: (r: CashMovementRow) => r.createdByName },
      ];
      section('OTHER CASH IN', toCsv<CashMovementRow>(movementCols, d.cashIn));
      section('OTHER CASH OUT', toCsv<CashMovementRow>(movementCols, d.cashOut));

      downloadCsvText(`Daily-Cash-Summary-${date}`, sections.join('\r\n\r\n'));
    } finally {
      setExporting(false);
    }
  };

  const cards = [
    {
      label: 'CASH SALES',
      amount: summary.cashSales,
      sub: 'Total cash payments received',
      color: C.green,
      icon: '🛒',
    },
    {
      label: 'PREVIOUS CASH',
      amount: summary.previousCash,
      sub: 'Cash carried over',
      color: C.blue,
      icon: '🗂',
    },
    {
      label: 'OTHER CASH IN',
      amount: summary.otherCashIn,
      sub: 'Borrowed / Other cash in',
      color: C.purple,
      icon: '💵',
    },
    {
      label: 'EXPENSES / DEDUCTIONS',
      amount: summary.expenses,
      sub: 'Total expenses and deductions',
      color: C.red,
      icon: '🧾',
    },
  ];

  return (
    <div className="space-y-4">
      {/* Header — the Date selector + Export controls stay put while the Details section
          below is used (§MAIN RULE). */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Daily Cash Summary
        </h1>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void exportCsv()}
            disabled={exporting}
            data-testid="cash-export"
          >
            {exporting ? 'Preparing…' : '⭳ Export'}
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => void changeDate(e.target.value)}
              className="h-9 w-[170px]"
              data-testid="cash-date"
            />
          </div>
        </div>
      </div>

      {/* 4 summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="flex items-center gap-3 p-4">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg"
                style={{ backgroundColor: `${c.color}22`, color: c.color }}
              >
                {c.icon}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </p>
                <p className="truncate text-lg font-bold text-foreground">
                  {money(c.amount)}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cash Breakdown + End of Day */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">
              Cash Breakdown
            </h2>
            <BreakRow label="Cash Sales" value={money(summary.cashSales)} />
            <BreakRow
              label="Previous Cash"
              value={`+ ${money(summary.previousCash)}`}
            />
            <BreakRow
              label="Other Cash In"
              value={`+ ${money(summary.otherCashIn)}`}
            />
            <div className="my-2 border-t border-dashed border-border" />
            <BreakRow
              label="Expenses / Deductions"
              value={`- ${money(summary.expenses)}`}
              color={C.red}
            />
            <BreakRow
              label="Remittance"
              value={`- ${money(summary.remittance)}`}
              color={C.red}
            />
            {toCents(summary.otherCashOut) > 0n ? (
              <BreakRow
                label="Other Cash Out"
                value={`- ${money(summary.otherCashOut)}`}
                color={C.red}
              />
            ) : null}
            {toCents(summary.scrapCashOut) > 0n ? (
              <BreakRow
                label="Scrap Cash-Out"
                value={`- ${money(summary.scrapCashOut)}`}
                color={C.red}
              />
            ) : null}
            <div className="my-2 border-t border-border" />
            <div className="flex items-end justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Expected Cash on Hand
                </p>
                <p className="text-[11px] text-muted-foreground">(End of Day)</p>
              </div>
              <p className="text-xl font-bold" style={{ color: C.gold }}>
                {money(summary.expected)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">
              End of Day
            </h2>
            <p className="text-sm text-muted-foreground">Expected Cash on Hand</p>
            <p
              className="mb-3 text-2xl font-bold"
              style={{ color: C.gold }}
              data-testid="cash-expected"
            >
              {money(summary.expected)}
            </p>
            <Label htmlFor="cash-actual" className="text-sm text-muted-foreground">
              Actual Cash Count
            </Label>
            <MoneyInput
              id="cash-actual"
              value={actual}
              onValueChange={setActual}
              className="mt-1 h-10"
            />
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Difference</span>
              <span
                className="rounded-md px-2 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: `${diffLabel.tone}22`, color: diffLabel.tone }}
                data-testid="cash-diff-status"
              >
                {diffLabel.text}
              </span>
            </div>
            <p
              className="mt-1 text-right text-lg font-bold"
              style={{ color: diffLabel.tone }}
              data-testid="cash-diff-amount"
            >
              {diffMoney}
            </p>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => void saveCount()}
                disabled={savingCount || actual.trim() === ''}
              >
                {savingCount
                  ? 'Saving…'
                  : summary.closeStatus === 'closed'
                    ? 'Update Count'
                    : 'Save & Close Day'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details — one self-contained, tabbed section (Owner request 2026-08-19). Every
          interaction here (tab switch, Add / View / Edit / Delete) stays inside this card:
          it never navigates, never reloads the page, and never touches the cards / Cash
          Breakdown / End-of-Day / date above. A financial change re-reads ONLY the day's
          totals (refreshSummary) so the Actual Cash Count being typed is preserved (§7,§10). */}
      <DetailsSection
        date={date}
        initialWalkIns={initialWalkIns}
        admins={admins}
        canAddWalkIn={canAddWalkIn}
        isOwner={isOwner}
        onFinancialChange={refreshSummary}
      />
    </div>
  );
}

function BreakRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

// ===========================================================================
// Details — one self-contained, tabbed section (Owner request 2026-08-19).
//
// A single card with a 7-tab strip. Clicking a tab swaps ONLY this section's table
// (lazy-loaded + cached per tab); it never navigates, never reloads the page, and never
// touches the summary cards, Cash Breakdown, End-of-Day, date, or the Actual Cash Count
// the operator may be entering. Add / View / Edit / Delete all open modals in place; a
// financial change re-reads ONLY the day's totals above. Cash Payments and Trade
// Deductions are DERIVED from orders — read-only (View only, no Add); every other tab
// carries its own Add button + compact modal.
// ===========================================================================

type CashEntryKind = 'expense' | 'remittance' | 'cash_in' | 'cash_out';

/** The Add button + modal wiring for each editable tab (the two derived tabs have none). */
const ENTRY_META: Record<
  CashEntryKind,
  { noun: string; addLabel: string; addTestId: string }
> = {
  expense: { noun: 'Expense', addLabel: '+ Add Expense', addTestId: 'cash-add-expense' },
  remittance: {
    noun: 'Remittance',
    addLabel: '+ Add Remittance',
    addTestId: 'cash-add-remittance',
  },
  cash_in: { noun: 'Cash In', addLabel: '+ Add Cash In', addTestId: 'cash-add-cashin' },
  cash_out: {
    noun: 'Cash Out',
    addLabel: '+ Add Cash Out',
    addTestId: 'cash-add-cashout',
  },
};

/** Which Add modal a tab opens. The derived tabs (cash_payments, trade_deductions) are
 *  intentionally absent — they are read-only. */
const TAB_ENTRY_KIND: Partial<Record<CashTab, CashEntryKind>> = {
  expenses: 'expense',
  remittance: 'remittance',
  other_cash_in: 'cash_in',
  other_cash_out: 'cash_out',
};

type CashEntryModalState = {
  kind: CashEntryKind;
  /** The row being edited, or null for an Add. */
  edit: ExpenseRow | RemittanceRow | CashMovementRow | null;
} | null;

function DetailsSection({
  date,
  initialWalkIns,
  admins,
  canAddWalkIn,
  isOwner,
  onFinancialChange,
}: {
  date: string;
  initialWalkIns: DetailPage<WalkInRow>;
  admins: AdminNameContext;
  canAddWalkIn: boolean;
  isOwner: boolean;
  onFinancialChange: () => Promise<void>;
}) {
  const [active, setActive] = useState<CashTab>('sales_walkins');

  // Each tab keeps its OWN page/size, so paging one tab never disturbs another (§8).
  const [tabState, setTabState] = useState<
    Record<CashTab, { page: number; size: number }>
  >(
    () =>
      Object.fromEntries(CASH_TABS.map((t) => [t, { page: 1, size: 8 }])) as Record<
        CashTab,
        { page: number; size: number }
      >,
  );
  const { page, size } = tabState[active];
  const setPage = (p: number) =>
    setTabState((s) => ({ ...s, [active]: { ...s[active], page: p } }));
  const setSize = (n: number) =>
    setTabState((s) => ({ ...s, [active]: { page: 1, size: n } }));

  // Lazy load + per-(tab·date·page·size) cache (§8): a tab fetches only when first opened,
  // and serves instantly from cache on return. The SSR-provided first Sales Walk-ins page
  // seeds the view so the default tab paints with no fetch. `reloadKey` (bumped + cache
  // cleared on a financial change) forces fresh reads after an add / edit / delete.
  const [initialDate] = useState(date);
  const cache = useRef(new Map<string, DetailPage<unknown>>());
  const [reloadKey, setReloadKey] = useState(0);
  const currentKey = `${active}|${date}|${page}|${size}|${reloadKey}`;
  const [loaded, setLoaded] = useState<{ key: string; data: DetailPage<unknown> }>(() => ({
    key: `sales_walkins|${date}|1|8|0`,
    data: initialWalkIns,
  }));

  useEffect(() => {
    if (loaded.key === currentKey) return;
    const cached = cache.current.get(currentKey);
    if (cached) {
      setLoaded({ key: currentKey, data: cached });
      return;
    }
    // The first Sales Walk-ins page for the SSR date is already in props — never refetch it.
    if (
      active === 'sales_walkins' &&
      date === initialDate &&
      page === 1 &&
      size === 8 &&
      reloadKey === 0
    ) {
      cache.current.set(currentKey, initialWalkIns);
      setLoaded({ key: currentKey, data: initialWalkIns });
      return;
    }
    let alive = true;
    void loadCashDetailAction(active, date, page, size).then((res) => {
      if (!alive) return;
      cache.current.set(currentKey, res);
      setLoaded({ key: currentKey, data: res });
    });
    return () => {
      alive = false;
    };
  }, [
    currentKey,
    active,
    date,
    page,
    size,
    reloadKey,
    initialDate,
    initialWalkIns,
    loaded.key,
  ]);

  // Derive purely from state (never read the cache ref during render). The active view is
  // "ready" only when `loaded` matches the current key; until then show "Loading…" — the
  // effect fills it from the cache on the very next tick (a revisit) or when a fetch returns.
  // Gating on the exact key also stops one tab's rows from being drawn against another tab's
  // columns during a switch.
  const ready = loaded.key === currentKey;
  const loading = !ready;
  const rows = ready ? loaded.data.rows : [];
  const total = ready ? loaded.data.total : 0;
  const pageCount = Math.max(1, Math.ceil(total / size));

  // A financial add/edit/delete: drop cached pages, re-read the active tab, and recalc ONLY
  // the day's totals above — never a full-page reload (which would wipe the Actual Cash Count).
  const afterChange = () => {
    cache.current.clear();
    setReloadKey((k) => k + 1);
    void onFinancialChange();
  };

  // Walk-in Add opens the shared rich modal; its ~1,900-row item picker lazy-loads on first
  // open, so opening Daily Cash never pays that inventory read up front.
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkInItems, setWalkInItems] = useState<WalkInItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const openWalkIn = () => {
    if (walkInItems.length > 0) {
      setShowWalkIn(true);
      return;
    }
    setLoadingItems(true);
    void loadWalkInItemsAction()
      .then((items) => {
        setWalkInItems(items);
        setShowWalkIn(true);
      })
      .finally(() => setLoadingItems(false));
  };

  // The compact per-tab Add / Edit modal (Expense · Remittance · Cash In · Cash Out).
  const [modal, setModal] = useState<CashEntryModalState>(null);
  const [viewing, setViewing] = useState<RowView | null>(null);

  const entryKind = TAB_ENTRY_KIND[active] ?? null;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Details
          </h2>
          {/* The Add button belongs ONLY to the active tab (§2). Derived tabs have none. */}
          {active === 'sales_walkins' ? (
            canAddWalkIn ? (
              <Button
                type="button"
                size="sm"
                onClick={openWalkIn}
                disabled={loadingItems}
                data-testid="cash-add-walkin"
              >
                {loadingItems ? 'Loading…' : '+ Add New Sale'}
              </Button>
            ) : null
          ) : entryKind ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setModal({ kind: entryKind, edit: null })}
              data-testid={ENTRY_META[entryKind].addTestId}
            >
              {ENTRY_META[entryKind].addLabel}
            </Button>
          ) : null}
        </div>

        {/* 7-tab strip — clicking a tab changes ONLY this section (§1). Scrolls sideways on
            a narrow screen; the page never scrolls horizontally. */}
        <div className="mb-3 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {CASH_TABS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={active === t}
              onClick={() => setActive(t)}
              data-testid={`cash-tab-${t}`}
              className={`whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium ${
                active === t
                  ? 'border-gold bg-gold/10 text-foreground'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {CASH_TAB_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Active tab's table — only this swaps when the tab changes. */}
        {active === 'sales_walkins' ? (
          <WalkInsTable
            loading={loading}
            rows={rows as WalkInRow[]}
            isOwner={isOwner}
            onView={setViewing}
            onChanged={afterChange}
          />
        ) : active === 'cash_payments' ? (
          <CashPaymentsTable
            loading={loading}
            rows={rows as CashPaymentRow[]}
            onView={setViewing}
          />
        ) : active === 'trade_deductions' ? (
          <TradeDeductionsTable
            loading={loading}
            rows={rows as TradeDeductionRow[]}
            onView={setViewing}
          />
        ) : active === 'expenses' ? (
          <ExpensesTable
            loading={loading}
            rows={rows as ExpenseRow[]}
            onView={setViewing}
            onEdit={(row) => setModal({ kind: 'expense', edit: row })}
            onChanged={afterChange}
          />
        ) : active === 'remittance' ? (
          <RemittanceTable
            loading={loading}
            rows={rows as RemittanceRow[]}
            onView={setViewing}
            onEdit={(row) => setModal({ kind: 'remittance', edit: row })}
            onChanged={afterChange}
          />
        ) : (
          <MovementsTable
            loading={loading}
            rows={rows as CashMovementRow[]}
            onView={setViewing}
            onEdit={(row) =>
              setModal({
                kind: active === 'other_cash_in' ? 'cash_in' : 'cash_out',
                edit: row,
              })
            }
            onChanged={afterChange}
          />
        )}

        {total > 0 ? (
          <Pagination
            page={Math.min(page, pageCount)}
            pageCount={pageCount}
            total={total}
            pageSize={size}
            pageSizes={[8, 15, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={setSize}
          />
        ) : null}
      </CardContent>

      {showWalkIn ? (
        // The SHARED rich Walk-In modal — same component Orders "New Entry → Walk In" uses,
        // opened WALK-IN ONLY. Saving refreshes this section + the totals in place (onSaved);
        // the modal's own "Done" closes it. It never navigates or reloads the page.
        <NewOrderModal
          walkInOnly
          walkInItems={walkInItems}
          admins={admins}
          defaultSaleDate={date}
          onClose={() => setShowWalkIn(false)}
          onSaved={afterChange}
        />
      ) : null}

      {modal ? (
        <CashEntryModal
          state={modal}
          date={date}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            afterChange();
          }}
        />
      ) : null}

      {viewing ? <RowViewModal view={viewing} onClose={() => setViewing(null)} /> : null}
    </Card>
  );
}

/** A read-only "View" popup for one Details row (§4). Fully self-contained — it shows
 *  the row's details in place and NEVER leaves the Daily Cash Summary section. */
type RowView = { title: string; fields: { label: string; value: string }[] };

function RowViewModal({ view, onClose }: { view: RowView; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={view.title}
      size="sm"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <dl className="divide-y divide-border">
        {view.fields.map((f) => (
          <div key={f.label} className="flex items-start justify-between gap-4 py-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {f.label}
            </dt>
            <dd className="text-right text-sm font-medium text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

function DetailLoading() {
  return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
}

function fmt(iso: string): string {
  if (!iso) return '—';
  return formatDateTime(iso);
}

// ===========================================================================
// Per-tab tables
// ===========================================================================

/** Sales Walk-ins — the approved design, unchanged (columns, styles, View). The Owner also
 *  gets order-level Edit / Delete (guarded server-side); both refresh in place. */
function WalkInsTable({
  loading,
  rows,
  isOwner,
  onView,
  onChanged,
}: {
  loading: boolean;
  rows: WalkInRow[];
  isOwner: boolean;
  onView: (view: RowView) => void;
  onChanged: () => void;
}) {
  const money = usePrivacyMoney();
  if (loading) return <DetailLoading />;
  return (
    <DataTable
      minWidth={isOwner ? '1040px' : '900px'}
      columns={
        isOwner
          ? ['5%', '20%', '13%', '12%', '12%', '11%', '11%', '16%']
          : ['5%', '22%', '14%', '13%', '13%', '13%', '12%', '8%']
      }
    >
      <Thead>
        <Tr plain>
          <Th kind="center">#</Th>
          <Th>Name</Th>
          <Th kind="num">Purchased Amount</Th>
          <Th kind="num">Depo/Bank/CC</Th>
          <Th kind="num">Trade Deductions</Th>
          <Th kind="num">Cash Payments</Th>
          <Th kind="center">Remarks</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={8}>No walk-in sales for this date.</EmptyRow>
        ) : (
          rows.map((row, i) => (
            <Tr key={row.id}>
              <Td kind="center">{i + 1}</Td>
              <Td clip title={row.name}>
                {row.name}
              </Td>
              <Td kind="num">{money(row.purchased)}</Td>
              <Td kind="num">{money(row.nonCash)}</Td>
              <Td kind="num">{money(row.tradeDeductions)}</Td>
              <Td kind="num">{money(row.cash)}</Td>
              <Td kind="center" className="text-muted-foreground">
                —
              </Td>
              <Td kind="center">
                <div className="flex items-center justify-center gap-1">
                  <ViewButton
                    onView={() =>
                      onView({
                        title: `Walk-in — ${row.name}`,
                        fields: [
                          { label: 'Name', value: row.name },
                          { label: 'Purchased Amount', value: money(row.purchased) },
                          { label: 'Depo / Bank / CC', value: money(row.nonCash) },
                          {
                            label: 'Trade Deductions',
                            value: money(row.tradeDeductions),
                          },
                          { label: 'Cash Payment', value: money(row.cash) },
                        ],
                      })
                    }
                  />
                  {/* Owner-only, order-level + guarded in the DB: Edit corrects the customer
                      name / total; Delete removes the order, returns the item to stock, and
                      reverses its payment. Both refresh in place (no page reload). */}
                  {isOwner ? (
                    <>
                      <OrderEdit
                        orderId={row.id}
                        currentName={row.name}
                        currentTotal={row.purchased}
                        onDone={onChanged}
                      />
                      <OrderDelete
                        orderId={row.id}
                        orderLabel={row.orderNumber}
                        customerName={row.name}
                        onDone={onChanged}
                      />
                    </>
                  ) : null}
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

/** Cash Payments — DERIVED from verified cash payments, read-only (View only, no Add/Edit). */
function CashPaymentsTable({
  loading,
  rows,
  onView,
}: {
  loading: boolean;
  rows: CashPaymentRow[];
  onView: (view: RowView) => void;
}) {
  const money = usePrivacyMoney();
  if (loading) return <DetailLoading />;
  return (
    <DataTable minWidth="600px" columns={['6%', '34%', '20%', '25%', '15%']}>
      <Thead>
        <Tr plain>
          <Th kind="center">#</Th>
          <Th>Name</Th>
          <Th kind="num">Amount</Th>
          <Th kind="center">Date / Time</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={5}>No cash payments for this date.</EmptyRow>
        ) : (
          rows.map((row, i) => (
            <Tr key={row.id}>
              <Td kind="center">{i + 1}</Td>
              <Td clip title={row.name}>
                {row.name}
              </Td>
              <Td kind="num">{money(row.amount)}</Td>
              <Td kind="center" className="text-muted-foreground">
                {fmt(row.at)}
              </Td>
              <Td kind="center">
                <ViewButton
                  onView={() =>
                    onView({
                      title: `Cash Payment — ${row.name}`,
                      fields: [
                        { label: 'Name', value: row.name },
                        { label: 'Amount', value: money(row.amount) },
                        { label: 'Reference', value: row.reference ?? '—' },
                        { label: 'Date / Time', value: fmt(row.at) },
                      ],
                    })
                  }
                />
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

/** Trade Deductions — DERIVED per-order trade-in deductions, read-only (View only). */
function TradeDeductionsTable({
  loading,
  rows,
  onView,
}: {
  loading: boolean;
  rows: TradeDeductionRow[];
  onView: (view: RowView) => void;
}) {
  const money = usePrivacyMoney();
  if (loading) return <DetailLoading />;
  return (
    <DataTable minWidth="660px" columns={['5%', '30%', '24%', '13%', '18%', '10%']}>
      <Thead>
        <Tr plain>
          <Th kind="center">#</Th>
          <Th>Name</Th>
          <Th>Label</Th>
          <Th kind="num">Amount</Th>
          <Th kind="center">Date / Time</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6}>No trade deductions for this date.</EmptyRow>
        ) : (
          rows.map((row, i) => (
            <Tr key={row.id}>
              <Td kind="center">{i + 1}</Td>
              <Td clip title={row.name}>
                {row.name}
              </Td>
              <Td clip title={row.label} className="text-muted-foreground">
                {row.label}
              </Td>
              <Td kind="num">{money(row.amount)}</Td>
              <Td kind="center" className="text-muted-foreground">
                {fmt(row.at)}
              </Td>
              <Td kind="center">
                <ViewButton
                  onView={() =>
                    onView({
                      title: `Trade Deduction — ${row.name}`,
                      fields: [
                        { label: 'Name', value: row.name },
                        { label: 'Label', value: row.label },
                        { label: 'Amount', value: money(row.amount) },
                        { label: 'Date / Time', value: fmt(row.at) },
                      ],
                    })
                  }
                />
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

/** Expenses — manual, counted in the Cash Breakdown. View / Edit / Delete. */
function ExpensesTable({
  loading,
  rows,
  onView,
  onEdit,
  onChanged,
}: {
  loading: boolean;
  rows: ExpenseRow[];
  onView: (view: RowView) => void;
  onEdit: (row: ExpenseRow) => void;
  onChanged: () => void;
}) {
  const money = usePrivacyMoney();
  if (loading) return <DetailLoading />;
  const del = async (row: ExpenseRow) => {
    const res = await deleteCashRecordAction('daily_cash_expenses', row.id);
    if (res.ok) onChanged();
  };
  return (
    <DataTable minWidth="720px" columns={['5%', '26%', '15%', '16%', '24%', '14%']}>
      <Thead>
        <Tr plain>
          <Th kind="center">#</Th>
          <Th>Name / Payee</Th>
          <Th kind="num">Amount</Th>
          <Th kind="center">Category</Th>
          <Th kind="center">Remarks</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6}>No expenses for this date.</EmptyRow>
        ) : (
          rows.map((row, i) => (
            <Tr key={row.id}>
              <Td kind="center">{i + 1}</Td>
              <Td clip title={row.payee}>
                {row.payee}
              </Td>
              <Td kind="num">{money(row.amount)}</Td>
              <Td
                kind="center"
                clip
                className="text-muted-foreground"
                title={row.category ?? undefined}
              >
                {row.category ?? '—'}
              </Td>
              <Td
                kind="center"
                clip
                className="text-muted-foreground"
                title={row.remarks ?? undefined}
              >
                {row.remarks ?? '—'}
              </Td>
              <Td kind="center">
                <div className="flex items-center justify-center gap-1">
                  <ViewButton
                    onView={() =>
                      onView({
                        title: `Expense — ${row.payee}`,
                        fields: [
                          { label: 'Name / Payee', value: row.payee },
                          { label: 'Amount', value: money(row.amount) },
                          { label: 'Category', value: row.category ?? '—' },
                          { label: 'Remarks', value: row.remarks ?? '—' },
                          { label: 'Date / Time', value: fmt(row.createdAt) },
                          { label: 'Created By', value: row.createdByName },
                        ],
                      })
                    }
                  />
                  <EditButton onEdit={() => onEdit(row)} />
                  <DeleteButton noun="expense" onDelete={() => del(row)} />
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

/** Remittance — manual, reduces Expected Cash. View / Edit / Delete. */
function RemittanceTable({
  loading,
  rows,
  onView,
  onEdit,
  onChanged,
}: {
  loading: boolean;
  rows: RemittanceRow[];
  onView: (view: RowView) => void;
  onEdit: (row: RemittanceRow) => void;
  onChanged: () => void;
}) {
  const money = usePrivacyMoney();
  if (loading) return <DetailLoading />;
  const del = async (row: RemittanceRow) => {
    const res = await deleteCashRecordAction('daily_cash_remittances', row.id);
    if (res.ok) onChanged();
  };
  const note = (r: RemittanceRow) => r.reference || r.remarks || '—';
  return (
    <DataTable minWidth="640px" columns={['16%', '32%', '24%', '16%', '12%']}>
      <Thead>
        <Tr plain>
          <Th kind="num">Amount</Th>
          <Th>Reference / Remarks</Th>
          <Th kind="center">Date / Time</Th>
          <Th kind="center">Recorded By</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={5}>No remittance for this date.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.id}>
              <Td kind="num">{money(row.amount)}</Td>
              <Td clip title={note(row)}>
                {note(row)}
              </Td>
              <Td kind="center" className="text-muted-foreground">
                {fmt(row.createdAt)}
              </Td>
              <Td kind="center" clip title={row.createdByName}>
                {row.createdByName}
              </Td>
              <Td kind="center">
                <div className="flex items-center justify-center gap-1">
                  <ViewButton
                    onView={() =>
                      onView({
                        title: 'Remittance',
                        fields: [
                          { label: 'Amount', value: money(row.amount) },
                          { label: 'Reference', value: row.reference ?? '—' },
                          { label: 'Remarks', value: row.remarks ?? '—' },
                          { label: 'Date / Time', value: fmt(row.createdAt) },
                          { label: 'Recorded By', value: row.createdByName },
                        ],
                      })
                    }
                  />
                  <EditButton onEdit={() => onEdit(row)} />
                  <DeleteButton noun="remittance" onDelete={() => del(row)} />
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

/** Other Cash In / Other Cash Out — manual movements. View / Edit / Delete. */
function MovementsTable({
  loading,
  rows,
  onView,
  onEdit,
  onChanged,
}: {
  loading: boolean;
  rows: CashMovementRow[];
  onView: (view: RowView) => void;
  onEdit: (row: CashMovementRow) => void;
  onChanged: () => void;
}) {
  const money = usePrivacyMoney();
  if (loading) return <DetailLoading />;
  const del = async (row: CashMovementRow) => {
    const res = await deleteCashRecordAction('daily_cash_movements', row.id);
    if (res.ok) onChanged();
  };
  return (
    <DataTable minWidth="600px" columns={['16%', '40%', '20%', '12%', '12%']}>
      <Thead>
        <Tr plain>
          <Th kind="num">Amount</Th>
          <Th>Remarks</Th>
          <Th kind="center">Date / Time</Th>
          <Th kind="center">Recorded By</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={5}>No records for this date.</EmptyRow>
        ) : (
          rows.map((row) => (
            <Tr key={row.id}>
              <Td kind="num">{money(row.amount)}</Td>
              <Td clip className="text-muted-foreground" title={row.remarks ?? undefined}>
                {row.remarks ?? '—'}
              </Td>
              <Td kind="center" className="text-muted-foreground">
                {fmt(row.createdAt)}
              </Td>
              <Td kind="center" clip title={row.createdByName}>
                {row.createdByName}
              </Td>
              <Td kind="center">
                <div className="flex items-center justify-center gap-1">
                  <ViewButton
                    onView={() =>
                      onView({
                        title: 'Cash Movement',
                        fields: [
                          { label: 'Amount', value: money(row.amount) },
                          { label: 'Remarks', value: row.remarks ?? '—' },
                          { label: 'Date / Time', value: fmt(row.createdAt) },
                          { label: 'Recorded By', value: row.createdByName },
                        ],
                      })
                    }
                  />
                  <EditButton onEdit={() => onEdit(row)} />
                  <DeleteButton noun="record" onDelete={() => del(row)} />
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

/** Open the row's details in a popup — never navigates away (§4). */
function ViewButton({ onView }: { onView: () => void }) {
  return (
    <button
      type="button"
      onClick={onView}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
    >
      👁 View
    </button>
  );
}

function EditButton({ onEdit }: { onEdit: () => void }) {
  return (
    <button
      type="button"
      onClick={onEdit}
      className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent"
    >
      Edit
    </button>
  );
}

/** Delete opens a confirmation popup first — it never deletes on the first click and
 *  never navigates (§6). The record's own guarded action runs on confirm. */
function DeleteButton({
  noun,
  onDelete,
}: {
  noun: string;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>
      {open ? (
        <Modal
          open
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          title={`Delete ${noun}?`}
          size="sm"
          critical
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void run()}
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Delete'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            This removes the {noun} from today&apos;s cash summary. This cannot be undone.
          </p>
        </Modal>
      ) : null}
    </>
  );
}

// ===========================================================================
// Add / Edit entry modal — Expense · Remittance · Other Cash In · Other Cash Out.
// One compact modal drives all four editable tabs; the `kind` picks its fields and which
// guarded server action runs. It opens over the page (the section stays mounted behind
// it) and never navigates. On Save it closes, refreshes the active tab, and recalculates
// only the affected totals above.
// ===========================================================================

function CashEntryModal({
  state,
  date,
  onClose,
  onSaved,
}: {
  state: NonNullable<CashEntryModalState>;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { kind, edit } = state;
  const editing = edit != null;
  const asExpense = edit as ExpenseRow | null;
  const asRemit = edit as RemittanceRow | null;
  const asMove = edit as CashMovementRow | null;

  const [amount, setAmount] = useState(edit?.amount ?? '');
  const [entryDate, setEntryDate] = useState(date);
  const [payee, setPayee] = useState(kind === 'expense' ? (asExpense?.payee ?? '') : '');
  const [category, setCategory] = useState(
    kind === 'expense' ? (asExpense?.category ?? '') : '',
  );
  const [reference, setReference] = useState(
    kind === 'remittance' ? (asRemit?.reference ?? asRemit?.remarks ?? '') : '',
  );
  const [remarks, setRemarks] = useState(
    kind === 'expense'
      ? (asExpense?.remarks ?? '')
      : kind === 'cash_in' || kind === 'cash_out'
        ? (asMove?.remarks ?? '')
        : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    if (amount.trim() === '') {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError(null);
    let res: MutationResult;
    if (kind === 'expense') {
      const payload = {
        date: entryDate,
        payee,
        amount,
        category: category || null,
        remarks: remarks || null,
      };
      res =
        editing && asExpense
          ? await updateExpenseAction(asExpense.id, payload)
          : await addExpenseAction(payload);
    } else if (kind === 'remittance') {
      const payload = {
        date: entryDate,
        amount,
        reference: reference || null,
        remarks: null,
      };
      res =
        editing && asRemit
          ? await updateRemittanceAction(asRemit.id, payload)
          : await addRemittanceAction(payload);
    } else {
      const direction = kind === 'cash_in' ? 'in' : 'out';
      res =
        editing && asMove
          ? await updateCashMovementAction(asMove.id, {
              date: entryDate,
              movementType: null,
              amount,
              remarks: remarks || null,
            })
          : await addCashMovementAction({
              date: entryDate,
              direction,
              movementType: null,
              amount,
              remarks: remarks || null,
            });
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  const meta = ENTRY_META[kind];
  return (
    <Modal
      open
      onClose={onClose}
      title={`${editing ? 'Edit' : 'Add'} ${meta.noun}`}
      size="sm"
      critical
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            data-testid="cash-entry-save"
          >
            {busy ? 'Saving…' : `Save ${meta.noun}`}
          </Button>
        </>
      }
    >
      <ModalFormGrid>
        {kind === 'expense' ? (
          <ModalFieldFull>
            <Label htmlFor="entry-payee" className="text-xs">
              Name / Payee
            </Label>
            <Input
              id="entry-payee"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              className="mt-1 h-9"
            />
          </ModalFieldFull>
        ) : null}
        <div>
          <Label htmlFor="entry-amount" className="text-xs">
            Amount (₱)
          </Label>
          <MoneyInput
            id="entry-amount"
            value={amount}
            onValueChange={setAmount}
            className="mt-1 h-9"
          />
        </div>
        <div>
          <Label htmlFor="entry-date" className="text-xs">
            Date
          </Label>
          <Input
            id="entry-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="mt-1 h-9"
          />
        </div>
        {kind === 'expense' ? (
          <div>
            <Label htmlFor="entry-cat" className="text-xs">
              Category
            </Label>
            <Input
              id="entry-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Supplies"
              className="mt-1 h-9"
            />
          </div>
        ) : null}
        {kind === 'remittance' ? (
          <ModalFieldFull>
            <Label htmlFor="entry-ref" className="text-xs">
              Reference / Remarks
            </Label>
            <Input
              id="entry-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="mt-1 h-9"
            />
          </ModalFieldFull>
        ) : null}
        {kind === 'expense' || kind === 'cash_in' || kind === 'cash_out' ? (
          <ModalFieldFull>
            <Label htmlFor="entry-remarks" className="text-xs">
              Remarks
            </Label>
            <Input
              id="entry-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="mt-1 h-9"
            />
          </ModalFieldFull>
        ) : null}
      </ModalFormGrid>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
