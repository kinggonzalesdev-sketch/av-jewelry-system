'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  addCashMovementAction,
  addExpenseAction,
  addRemittanceAction,
  addTradeAction,
  deleteCashRecordAction,
  loadCashDetailAction,
  loadCashExportAction,
  loadCashSummaryAction,
  loadTradesExpensesAction,
  loadWalkInItemsAction,
  saveActualCashCountAction,
  updateExpenseAction,
  updateTradeAction,
} from '@/lib/cash/actions';
import {
  type CashMovementRow,
  type CashPaymentRow,
  type DailyCashSummary,
  type DetailPage,
  type ExpenseRow,
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

/** An in-progress edit of a Trades & Expenses row (its type is fixed by the record). */
type EntryEdit = {
  id: string;
  type: 'expense' | 'trade';
  initial: {
    name: string;
    amount: string;
    category: string | null;
    relatedSale: string | null;
    remarks: string | null;
  };
};

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

  // "More" cash records — Remittance / Other Cash In / Other Cash Out. These are less
  // frequent than walk-ins/expenses, so they live behind a "More" button instead of the
  // main boxes, but they DO affect Expected Cash, so a change here recalculates the totals.
  const [showMore, setShowMore] = useState(false);

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
            { header: 'Order', value: (r) => r.orderNumber },
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
            { header: 'Order', value: (r) => r.orderNumber },
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
            { header: 'Order', value: (r) => r.orderNumber },
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Daily Cash Summary
        </h1>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowMore(true)}
            data-testid="cash-more"
          >
            ⋯ More
          </Button>
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

      {/* Lower area — two side-by-side boxes (Owner-approved layout 2026-08-12), same
          card style as Cash Breakdown / End of Day. The old 7-tab strip is gone. Left =
          Sales Walk-ins (the existing table). Right = Trades & Expenses (manual expenses +
          manual trades, combined). Add/View/Edit/Delete open modals only — nothing here
          navigates or reloads; a financial change recalculates the totals above in place. */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <SalesWalkInsBox
          date={date}
          initialWalkIns={initialWalkIns}
          admins={admins}
          canAddWalkIn={canAddWalkIn}
          isOwner={isOwner}
          onFinancialChange={refreshSummary}
        />
        <TradesExpensesBox date={date} onFinancialChange={refreshSummary} />
      </div>

      <p className="pt-1 text-center text-[11px] text-muted-foreground">
        All amounts are in Philippine Peso (₱).
      </p>

      {showMore ? (
        <MoreCashModal
          date={date}
          onClose={() => setShowMore(false)}
          onChanged={refreshSummary}
        />
      ) : null}
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
// Lower area — two side-by-side boxes (Sales Walk-ins · Trades & Expenses)
// ===========================================================================

/** Left box: the existing Sales Walk-ins table + the in-place "Add New Sale" modal. Its
 *  data + logic are unchanged — only the presentation moved out of the old tab strip. */
function SalesWalkInsBox({
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
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(8);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DetailPage<WalkInRow>>(initialWalkIns);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [viewing, setViewing] = useState<RowView | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // The walk-in item picker (~1,900 inventory rows) is LAZY-loaded the first time "+ Add New
  // Sale" is opened, so opening Daily Cash stays fast. Cached after the first fetch.
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

  // The first page for the initial date is server-rendered (initialWalkIns), so skip that
  // exact first load once; every later date/page/size/refresh re-reads only this box.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (page === 1 && size === 8 && refreshKey === 0) return;
    }
    let alive = true;
    setLoading(true);
    void loadCashDetailAction('sales_walkins', date, page, size)
      .then((res) => {
        if (alive) setData(res as DetailPage<WalkInRow>);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [date, page, size, refreshKey]);

  const pageCount = Math.max(1, Math.ceil(data.total / size));
  const afterSave = () => {
    setRefreshKey((k) => k + 1);
    void onFinancialChange();
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Sales Walk-ins
          </h2>
          {canAddWalkIn ? (
            <Button
              type="button"
              size="sm"
              onClick={openWalkIn}
              disabled={loadingItems}
              data-testid="cash-add-walkin"
            >
              {loadingItems ? 'Loading…' : '+ Add New Sale'}
            </Button>
          ) : null}
        </div>

        <WalkInsTable
          loading={loading}
          rows={data.rows}
          isOwner={isOwner}
          onView={setViewing}
          onChanged={afterSave}
        />

        {data.total > 0 ? (
          <Pagination
            page={Math.min(page, pageCount)}
            pageCount={pageCount}
            total={data.total}
            pageSize={size}
            pageSizes={[8, 15, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        ) : null}
      </CardContent>

      {showWalkIn ? (
        // The SHARED rich Walk-In modal (Owner request 2026-08-13) — same component the
        // Orders "New Entry → Walk In" uses, opened WALK-IN ONLY (no New Entry toggle),
        // with multi-item entry + the Transfer Destination dropdown. Saving refreshes this
        // box + the summary totals in place (onSaved); the modal's own "Done" closes it.
        <NewOrderModal
          walkInOnly
          walkInItems={walkInItems}
          admins={admins}
          defaultSaleDate={date}
          onClose={() => setShowWalkIn(false)}
          onSaved={afterSave}
        />
      ) : null}

      {viewing ? <RowViewModal view={viewing} onClose={() => setViewing(null)} /> : null}
    </Card>
  );
}

/** Right box: manual Expenses (counted in the Cash Breakdown) + manual Trades (display-
 *  only), one combined paginated list, with an "Add New Entry" modal that picks the type. */
function TradesExpensesBox({
  date,
  onFinancialChange,
}: {
  date: string;
  onFinancialChange: () => Promise<void>;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(8);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DetailPage<TradeExpenseRow>>({ rows: [], total: 0 });
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<EntryEdit | null>(null);
  const [viewing, setViewing] = useState<RowView | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch spinner: flip to loading, then swap in server data on arrival
    setLoading(true);
    void loadTradesExpensesAction(date, page, size)
      .then((res) => {
        if (alive) setData(res);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [date, page, size, refreshKey]);

  const pageCount = Math.max(1, Math.ceil(data.total / size));
  // An Expense reduces Expected Cash, so recalc the totals above; a Trade is display-only
  // (the recalc is a harmless no-op there). Either way nothing else on the page reloads.
  const afterSave = () => {
    setRefreshKey((k) => k + 1);
    void onFinancialChange();
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">
            Trades &amp; Expenses
          </h2>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowAdd(true);
            }}
            data-testid="cash-add-entry"
          >
            + Add New Entry
          </Button>
        </div>

        <TradesExpensesTable
          loading={loading}
          rows={data.rows}
          onChanged={afterSave}
          onView={setViewing}
          onEdit={(row) => {
            setEditing({
              id: row.id,
              type: row.type,
              initial: {
                name: row.name,
                amount: row.amount,
                category: row.category,
                relatedSale: row.relatedSale,
                remarks: row.remarks,
              },
            });
            setShowAdd(true);
          }}
        />

        {data.total > 0 ? (
          <Pagination
            page={Math.min(page, pageCount)}
            pageCount={pageCount}
            total={data.total}
            pageSize={size}
            pageSizes={[8, 15, 25, 50]}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        ) : null}
      </CardContent>

      {showAdd ? (
        <AddEntryModal
          key={editing?.id ?? 'add'}
          date={date}
          editing={editing}
          onClose={() => {
            setShowAdd(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowAdd(false);
            setEditing(null);
            afterSave();
          }}
        />
      ) : null}

      {viewing ? <RowViewModal view={viewing} onClose={() => setViewing(null)} /> : null}
    </Card>
  );
}

/** The Type pill (§4): Trade = blue, Expense = purple. Same badge style used elsewhere. */
function TypeBadge({ type }: { type: 'expense' | 'trade' }) {
  const color = type === 'trade' ? C.blue : C.purple;
  return (
    <span
      className="rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {type === 'trade' ? 'Trade' : 'Expense'}
    </span>
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

/** Safe string read off an untyped row value — never Object's "[object Object]". */
function cashStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** The Sales Walk-ins table — the approved design, unchanged (columns, styles, View). */
function WalkInsTable({
  loading,
  rows,
  isOwner,
  onView,
  onChanged,
}: {
  loading: boolean;
  rows: WalkInRow[];
  /** The Owner also gets Edit / Delete (order-level, guarded) on each walk-in. */
  isOwner: boolean;
  onView: (view: RowView) => void;
  onChanged: () => void;
}) {
  const money = usePrivacyMoney();
  if (loading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  }
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
                          { label: 'Order', value: row.orderNumber },
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

/** The combined Trades & Expenses table (#/Name/Amount/Type/Remarks/Action). Reuses the
 *  approved DataTable + View/Edit/Delete controls; the Type pill distinguishes the two. */
function TradesExpensesTable({
  loading,
  rows,
  onChanged,
  onView,
  onEdit,
}: {
  loading: boolean;
  rows: TradeExpenseRow[];
  onChanged: () => void;
  onView: (view: RowView) => void;
  onEdit: (row: TradeExpenseRow) => void;
}) {
  const money = usePrivacyMoney();
  if (loading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  }
  const del = async (row: TradeExpenseRow) => {
    const table = row.type === 'trade' ? 'daily_cash_trades' : 'daily_cash_expenses';
    const res = await deleteCashRecordAction(table, row.id);
    if (res.ok) onChanged();
  };
  return (
    <DataTable minWidth="620px" columns={['5%', '30%', '18%', '14%', '21%', '12%']}>
      <Thead>
        <Tr plain>
          <Th kind="center">#</Th>
          <Th>Name</Th>
          <Th kind="num">Amount</Th>
          <Th kind="center">Type</Th>
          <Th kind="center">Remarks</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={6}>No trades or expenses for this date.</EmptyRow>
        ) : (
          rows.map((row, i) => (
            <Tr key={row.id}>
              <Td kind="center">{i + 1}</Td>
              <Td clip title={row.name}>
                {row.name}
              </Td>
              <Td kind="num">{money(row.amount)}</Td>
              <Td kind="center">
                <TypeBadge type={row.type} />
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
                        title: `${row.type === 'trade' ? 'Trade' : 'Expense'} — ${row.name}`,
                        fields: [
                          { label: 'Name', value: row.name },
                          { label: 'Amount', value: money(row.amount) },
                          {
                            label: 'Type',
                            value: row.type === 'trade' ? 'Trade' : 'Expense',
                          },
                          row.type === 'trade'
                            ? { label: 'Related Sale', value: row.relatedSale ?? '—' }
                            : { label: 'Category', value: row.category ?? '—' },
                          { label: 'Remarks', value: row.remarks ?? '—' },
                          { label: 'Date / Time', value: fmt(row.createdAt) },
                          { label: 'Created By', value: row.createdByName },
                        ],
                      })
                    }
                  />
                  <EditButton onEdit={() => onEdit(row)} />
                  <DeleteButton
                    noun={row.type === 'trade' ? 'trade' : 'expense'}
                    onDelete={() => del(row)}
                  />
                </div>
              </Td>
            </Tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}

function fmt(iso: string): string {
  if (!iso) return '—';
  return formatDateTime(iso);
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
// Add / Edit entry modal — Trade or Expense (Trades & Expenses box)
// ===========================================================================

/** The compact modal for the Trades & Expenses box. On ADD it first asks the Type
 *  (Trade / Expense), then shows that type's fields; on EDIT the type is fixed by the
 *  record. Expense → daily_cash_expenses (counted in the Breakdown); Trade →
 *  daily_cash_trades (display-only, never changes Expected Cash). Never navigates. */
function AddEntryModal({
  date,
  editing,
  onClose,
  onSaved,
}: {
  date: string;
  editing: EntryEdit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const init = editing?.initial;
  const [type, setType] = useState<'expense' | 'trade'>(editing?.type ?? 'expense');
  const [name, setName] = useState(init?.name ?? '');
  const [amount, setAmount] = useState(init?.amount ?? '');
  const [category, setCategory] = useState(init?.category ?? '');
  const [relatedSale, setRelatedSale] = useState(init?.relatedSale ?? '');
  const [remarks, setRemarks] = useState(init?.remarks ?? '');
  const [entryDate, setEntryDate] = useState(date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTrade = type === 'trade';
  const title = `${editing ? 'Edit' : 'Add'} ${isTrade ? 'Trade' : 'Expense'}`;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let res;
    if (isTrade) {
      const payload = {
        date: entryDate,
        name,
        amount,
        relatedSale: relatedSale || null,
        remarks: remarks || null,
      };
      res = editing
        ? await updateTradeAction(editing.id, payload)
        : await addTradeAction(payload);
    } else {
      const payload = {
        date: entryDate,
        payee: name,
        amount,
        category: category || null,
        remarks: remarks || null,
      };
      res = editing
        ? await updateExpenseAction(editing.id, payload)
        : await addExpenseAction(payload);
    }
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
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
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <ModalFormGrid>
        {/* Type is chosen on ADD (it drives the fields); on EDIT it is fixed by the record. */}
        {!editing ? (
          <ModalFieldFull>
            <Label htmlFor="entry-type" className="text-xs">
              Type
            </Label>
            <select
              id="entry-type"
              value={type}
              onChange={(e) => setType(e.target.value === 'trade' ? 'trade' : 'expense')}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
              data-testid="cash-entry-type"
            >
              <option value="expense">Expense</option>
              <option value="trade">Trade</option>
            </select>
          </ModalFieldFull>
        ) : null}
        <ModalFieldFull>
          <Label htmlFor="entry-name" className="text-xs">
            {isTrade ? 'Name' : 'Name / Payee'}
          </Label>
          <Input
            id="entry-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-9"
          />
        </ModalFieldFull>
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
        {isTrade ? (
          <ModalFieldFull>
            <Label htmlFor="entry-related" className="text-xs">
              Related Sale / Customer (optional)
            </Label>
            <Input
              id="entry-related"
              value={relatedSale}
              onChange={(e) => setRelatedSale(e.target.value)}
              placeholder="e.g. order # or customer"
              className="mt-1 h-9"
            />
          </ModalFieldFull>
        ) : (
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
        )}
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
      </ModalFormGrid>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

// ===========================================================================
// "More" cash records — Remittance / Other Cash In / Other Cash Out. Less-frequent
// entries kept out of the two main boxes but STILL part of the Cash Breakdown, so an
// add/delete here recalculates Expected Cash (onChanged). Reuses the existing
// add/detail/delete actions; never navigates or reloads the page.
// ===========================================================================

type MoreKind = 'remittance' | 'other_cash_in' | 'other_cash_out';
type MoreRow = { id: string; amount: string; note: string; createdAt: string };

const MORE_META: Record<
  MoreKind,
  { title: string; table: string; noteLabel: string; effect: string }
> = {
  remittance: {
    title: 'Remittance',
    table: 'daily_cash_remittances',
    noteLabel: 'Reference / Remarks',
    effect: 'Reduces Expected Cash on Hand',
  },
  other_cash_in: {
    title: 'Other Cash In',
    table: 'daily_cash_movements',
    noteLabel: 'Remarks',
    effect: 'Adds to Expected Cash on Hand',
  },
  other_cash_out: {
    title: 'Other Cash Out',
    table: 'daily_cash_movements',
    noteLabel: 'Remarks',
    effect: 'Reduces Expected Cash on Hand',
  },
};

function MoreCashModal({
  date,
  onClose,
  onChanged,
}: {
  date: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const money = usePrivacyMoney();
  const [kind, setKind] = useState<MoreKind>('remittance');
  const [rows, setRows] = useState<MoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch spinner: flip to loading, then swap in server data on arrival
    setLoading(true);
    void loadCashDetailAction(kind, date, 1, 50)
      .then((res) => {
        if (!alive) return;
        setRows(
          (res.rows as Array<Record<string, unknown>>).map((r) => ({
            id: cashStr(r.id),
            amount: cashStr(r.amount) || '0',
            note:
              kind === 'remittance'
                ? cashStr(r.reference) || cashStr(r.remarks)
                : cashStr(r.remarks),
            createdAt: cashStr(r.createdAt),
          })),
        );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [kind, date, refreshKey]);

  const add = async () => {
    if (busy) return;
    if (amount.trim() === '') {
      setError('Enter an amount.');
      return;
    }
    setBusy(true);
    setError(null);
    const res =
      kind === 'remittance'
        ? await addRemittanceAction({
            date,
            amount,
            reference: note.trim() || null,
            remarks: null,
          })
        : await addCashMovementAction({
            date,
            direction: kind === 'other_cash_in' ? 'in' : 'out',
            movementType: null,
            amount,
            remarks: note.trim() || null,
          });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAmount('');
    setNote('');
    setRefreshKey((k) => k + 1);
    void onChanged();
  };

  const del = async (id: string) => {
    const res = await deleteCashRecordAction(MORE_META[kind].table, id);
    if (res.ok) {
      setRefreshKey((k) => k + 1);
      void onChanged();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="More Cash Records"
      size="md"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {/* Which record type — Remittance / Other Cash In / Other Cash Out. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {(Object.keys(MORE_META) as MoreKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k);
              setError(null);
            }}
            data-testid={`cash-more-tab-${k}`}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
              kind === k
                ? 'border-gold bg-gold/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent'
            }`}
          >
            {MORE_META[k].title}
          </button>
        ))}
      </div>

      {/* Add a record of the selected type. */}
      <div className="mb-2 flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="w-32">
          <Label htmlFor="more-amount" className="text-xs">
            Amount (₱)
          </Label>
          <MoneyInput
            id="more-amount"
            value={amount}
            onValueChange={setAmount}
            className="mt-1 h-9"
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="more-note" className="text-xs">
            {MORE_META[kind].noteLabel}
          </Label>
          <Input
            id="more-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 h-9"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void add()}
          disabled={busy}
          data-testid="cash-more-add"
        >
          {busy ? 'Adding…' : '+ Add'}
        </Button>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">{MORE_META[kind].effect}.</p>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable minWidth="480px" columns={['22%', '40%', '26%', '12%']}>
          <Thead>
            <Tr plain>
              <Th kind="num">Amount</Th>
              <Th>{MORE_META[kind].noteLabel}</Th>
              <Th kind="center">Date / Time</Th>
              <Th kind="center">Action</Th>
            </Tr>
          </Thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={4}>
                No {MORE_META[kind].title} for this date.
              </EmptyRow>
            ) : (
              rows.map((r) => (
                <Tr key={r.id}>
                  <Td kind="num">{money(r.amount)}</Td>
                  <Td clip title={r.note}>
                    {r.note || '—'}
                  </Td>
                  <Td kind="center" className="text-muted-foreground">
                    {fmt(r.createdAt)}
                  </Td>
                  <Td kind="center">
                    <DeleteButton
                      noun={MORE_META[kind].title.toLowerCase()}
                      onDelete={() => del(r.id)}
                    />
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </DataTable>
      )}
    </Modal>
  );
}
