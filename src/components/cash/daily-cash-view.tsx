'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  addCashMovementAction,
  addExpenseAction,
  addRemittanceAction,
  deleteCashRecordAction,
  loadCashDetailAction,
  saveActualCashCountAction,
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
  type RemittanceRow,
  type TradeDeductionRow,
  type WalkInRow,
} from '@/lib/cash/types';
import { formatPeso } from '@/lib/payments/format';
import { formatDateTime } from '@/lib/format/date';
import { downloadCsv } from '@/lib/export/csv';
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

type AddMode = 'modal' | 'link' | 'none';
function addConfig(tab: CashTab): { label: string; mode: AddMode } {
  switch (tab) {
    case 'sales_walkins':
      return { label: '+ Add New Sale', mode: 'link' };
    case 'expenses':
      return { label: '+ Add Expense', mode: 'modal' };
    case 'remittance':
      return { label: '+ Add Remittance', mode: 'modal' };
    case 'other_cash_in':
      return { label: '+ Add Cash In', mode: 'modal' };
    case 'other_cash_out':
      return { label: '+ Add Cash Out', mode: 'modal' };
    default:
      return { label: '', mode: 'none' }; // derived tabs: no manual duplicate creation
  }
}

export function DailyCashView({
  date,
  summary,
  initialWalkIns,
}: {
  date: string;
  summary: DailyCashSummary;
  initialWalkIns: DetailPage<WalkInRow>;
}) {
  const router = useRouter();

  // --- End of Day: actual cash count + live difference ----------------------
  const [actual, setActual] = useState(summary.actualCount ?? '');
  useEffect(() => {
    // Reset the count field when a new day's summary loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActual(summary.actualCount ?? '');
  }, [summary.actualCount, date]);
  const [savingCount, setSavingCount] = useState(false);

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
      : formatPeso(`${(diff < 0n ? -diff : diff) / 100n}.${String((diff < 0n ? -diff : diff) % 100n).padStart(2, '0')}`);

  const saveCount = async () => {
    if (savingCount || actual.trim() === '') return;
    setSavingCount(true);
    await saveActualCashCountAction(date, actual, summary.expected);
    setSavingCount(false);
    router.refresh();
  };

  // --- Date control ---------------------------------------------------------
  const onDate = (next: string) => {
    if (next) router.push(`/cash/daily?date=${next}`);
  };

  // --- Export ---------------------------------------------------------------
  const exportCsv = () => {
    downloadCsv(
      `Daily-Cash-Summary-${date}`,
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
        { k: 'Difference', v: diff === null ? '' : (diff < 0n ? '-' : '') + (String((diff < 0n ? -diff : diff) / 100n) + '.' + String((diff < 0n ? -diff : diff) % 100n).padStart(2, '0')) },
      ],
    );
  };

  const cards = [
    { label: 'CASH SALES', amount: summary.cashSales, sub: 'Total cash payments received', color: C.green, icon: '🛒' },
    { label: 'PREVIOUS CASH', amount: summary.previousCash, sub: 'Cash carried over', color: C.blue, icon: '🗂' },
    { label: 'OTHER CASH IN', amount: summary.otherCashIn, sub: 'Borrowed / Other cash in', color: C.purple, icon: '💵' },
    { label: 'EXPENSES / DEDUCTIONS', amount: summary.expenses, sub: 'Total expenses and deductions', color: C.red, icon: '🧾' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">Daily Cash Summary</h1>
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv} data-testid="cash-export">
            ⭳ Export
          </Button>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Date</span>
            <Input
              type="date"
              value={date}
              onChange={(e) => onDate(e.target.value)}
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
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
                <p className="truncate text-lg font-bold text-foreground">{formatPeso(c.amount)}</p>
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
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">Cash Breakdown</h2>
            <BreakRow label="Cash Sales" value={formatPeso(summary.cashSales)} />
            <BreakRow label="Previous Cash" value={`+ ${formatPeso(summary.previousCash)}`} />
            <BreakRow label="Other Cash In" value={`+ ${formatPeso(summary.otherCashIn)}`} />
            <div className="my-2 border-t border-dashed border-border" />
            <BreakRow label="Expenses / Deductions" value={`- ${formatPeso(summary.expenses)}`} color={C.red} />
            <BreakRow label="Remittance" value={`- ${formatPeso(summary.remittance)}`} color={C.red} />
            {toCents(summary.otherCashOut) > 0n ? (
              <BreakRow label="Other Cash Out" value={`- ${formatPeso(summary.otherCashOut)}`} color={C.red} />
            ) : null}
            <div className="my-2 border-t border-border" />
            <div className="flex items-end justify-between">
              <div>
                <p className="text-sm font-semibold text-foreground">Expected Cash on Hand</p>
                <p className="text-[11px] text-muted-foreground">(End of Day)</p>
              </div>
              <p className="text-xl font-bold" style={{ color: C.gold }}>
                {formatPeso(summary.expected)}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-foreground">End of Day</h2>
            <p className="text-sm text-muted-foreground">Expected Cash on Hand</p>
            <p className="mb-3 text-2xl font-bold" style={{ color: C.gold }} data-testid="cash-expected">
              {formatPeso(summary.expected)}
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
            <p className="mt-1 text-right text-lg font-bold" style={{ color: diffLabel.tone }} data-testid="cash-diff-amount">
              {diffMoney}
            </p>
            <div className="mt-3 flex justify-end">
              <Button type="button" size="sm" onClick={() => void saveCount()} disabled={savingCount || actual.trim() === ''}>
                {savingCount ? 'Saving…' : summary.closeStatus === 'closed' ? 'Update Count' : 'Save & Close Day'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      <DetailsSection date={date} initialWalkIns={initialWalkIns} />

      <p className="pt-1 text-center text-[11px] text-muted-foreground">
        All amounts are in Philippine Peso (₱).
      </p>
    </div>
  );
}

function BreakRow({ label, value, color }: { label: string; value: string; color?: string }) {
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
// Details section — lazy-loaded, paginated tabs
// ===========================================================================

function DetailsSection({ date, initialWalkIns }: { date: string; initialWalkIns: DetailPage<WalkInRow> }) {
  const [tab, setTab] = useState<CashTab>('sales_walkins');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(8);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DetailPage<unknown>>(initialWalkIns);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load whenever the tab / page / size / date changes. The default tab's first page is
  // already server-rendered (initialWalkIns), so skip that exact combination once.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      if (tab === 'sales_walkins' && page === 1 && size === 8 && refreshKey === 0) return;
    }
    let alive = true;
    setLoading(true);
    void loadCashDetailAction(tab, date, page, size)
      .then((res) => {
        if (alive) setData(res);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, page, size, date, refreshKey]);

  const cfg = addConfig(tab);
  const pageCount = Math.max(1, Math.ceil(data.total / size));

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border">
          <div className="flex flex-wrap items-center gap-1 overflow-x-auto">
            {CASH_TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setPage(1);
                }}
                data-testid={`cash-tab-${t}`}
                className="whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium"
                style={
                  t === tab
                    ? { color: C.gold, borderColor: C.gold }
                    : { color: 'var(--muted-foreground)', borderColor: 'transparent' }
                }
              >
                {CASH_TAB_LABEL[t]}
              </button>
            ))}
          </div>
          {cfg.mode === 'link' ? (
            <a href="/orders">
              <Button type="button" size="sm" data-testid="cash-add">
                {cfg.label}
              </Button>
            </a>
          ) : cfg.mode === 'modal' ? (
            <Button type="button" size="sm" onClick={() => setShowAdd(true)} data-testid="cash-add">
              {cfg.label}
            </Button>
          ) : null}
        </div>

        <TabTable
          tab={tab}
          loading={loading}
          rows={data.rows}
          onChanged={() => setRefreshKey((k) => k + 1)}
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
        <AddCashModal
          tab={tab}
          date={date}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      ) : null}
    </Card>
  );
}

function money(v: string): string {
  return formatPeso(v);
}

function TabTable({
  tab,
  loading,
  rows,
  onChanged,
}: {
  tab: CashTab;
  loading: boolean;
  rows: unknown[];
  onChanged: () => void;
}) {
  if (loading) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>;
  }

  const del = async (table: string, id: string) => {
    const res = await deleteCashRecordAction(table, id);
    if (res.ok) onChanged();
  };

  if (tab === 'sales_walkins') {
    const r = rows as WalkInRow[];
    return (
      <DataTable minWidth="900px" columns={['5%', '22%', '14%', '13%', '13%', '13%', '12%', '8%']}>
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
          {r.length === 0 ? (
            <EmptyRow colSpan={8}>No walk-in sales for this date.</EmptyRow>
          ) : (
            r.map((row, i) => (
              <Tr key={row.id}>
                <Td kind="center">{i + 1}</Td>
                <Td clip title={row.name}>{row.name}</Td>
                <Td kind="num">{money(row.purchased)}</Td>
                <Td kind="num">{money(row.nonCash)}</Td>
                <Td kind="num">{money(row.tradeDeductions)}</Td>
                <Td kind="num">{money(row.cash)}</Td>
                <Td kind="center" className="text-muted-foreground">—</Td>
                <Td kind="center">
                  <span className="text-xs text-muted-foreground">{row.orderNumber}</span>
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </DataTable>
    );
  }

  if (tab === 'cash_payments') {
    const r = rows as CashPaymentRow[];
    return (
      <DataTable minWidth="720px" columns={['24%', '18%', '16%', '20%', '14%', '8%']}>
        <Thead>
          <Tr plain>
            <Th>Name</Th>
            <Th kind="center">Order</Th>
            <Th kind="num">Amount</Th>
            <Th kind="center">Date / Time</Th>
            <Th kind="center">Remarks</Th>
            <Th kind="center">Action</Th>
          </Tr>
        </Thead>
        <tbody>
          {r.length === 0 ? (
            <EmptyRow colSpan={6}>No cash payments for this date.</EmptyRow>
          ) : (
            r.map((row) => (
              <Tr key={row.id}>
                <Td clip title={row.name}>{row.name}</Td>
                <Td kind="center" className="text-xs">{row.orderNumber}</Td>
                <Td kind="num"><span style={{ color: C.green }}>{money(row.amount)}</span></Td>
                <Td kind="center" className="text-xs text-muted-foreground">{fmt(row.at)}</Td>
                <Td kind="center" clip className="text-muted-foreground" title={row.reference ?? undefined}>
                  {row.reference ?? '—'}
                </Td>
                <Td kind="center" className="text-muted-foreground">—</Td>
              </Tr>
            ))
          )}
        </tbody>
      </DataTable>
    );
  }

  if (tab === 'trade_deductions') {
    const r = rows as TradeDeductionRow[];
    return (
      <DataTable minWidth="720px" columns={['24%', '16%', '24%', '16%', '20%']}>
        <Thead>
          <Tr plain>
            <Th>Name</Th>
            <Th kind="center">Order</Th>
            <Th>Label</Th>
            <Th kind="num">Amount</Th>
            <Th kind="center">Date / Time</Th>
          </Tr>
        </Thead>
        <tbody>
          {r.length === 0 ? (
            <EmptyRow colSpan={5}>No trade deductions for this date.</EmptyRow>
          ) : (
            r.map((row) => (
              <Tr key={row.id}>
                <Td clip title={row.name}>{row.name}</Td>
                <Td kind="center" className="text-xs">{row.orderNumber}</Td>
                <Td clip title={row.label}>{row.label}</Td>
                <Td kind="num"><span style={{ color: C.red }}>{money(row.amount)}</span></Td>
                <Td kind="center" className="text-xs text-muted-foreground">{fmt(row.at)}</Td>
              </Tr>
            ))
          )}
        </tbody>
      </DataTable>
    );
  }

  if (tab === 'expenses') {
    const r = rows as ExpenseRow[];
    return (
      <DataTable minWidth="820px" columns={['22%', '14%', '15%', '18%', '15%', '10%', '6%']}>
        <Thead>
          <Tr plain>
            <Th>Name / Payee</Th>
            <Th kind="num">Amount</Th>
            <Th kind="center">Category</Th>
            <Th kind="center">Remarks</Th>
            <Th kind="center">Date / Time</Th>
            <Th kind="center">Created By</Th>
            <Th kind="center">Action</Th>
          </Tr>
        </Thead>
        <tbody>
          {r.length === 0 ? (
            <EmptyRow colSpan={7}>No expenses for this date.</EmptyRow>
          ) : (
            r.map((row) => (
              <Tr key={row.id}>
                <Td clip title={row.payee}>{row.payee}</Td>
                <Td kind="num"><span style={{ color: C.red }}>{money(row.amount)}</span></Td>
                <Td kind="center" className="text-muted-foreground">{row.category ?? '—'}</Td>
                <Td kind="center" clip className="text-muted-foreground" title={row.remarks ?? undefined}>{row.remarks ?? '—'}</Td>
                <Td kind="center" className="text-xs text-muted-foreground">{fmt(row.createdAt)}</Td>
                <Td kind="center" className="text-xs text-muted-foreground">{row.createdByName}</Td>
                <Td kind="center">
                  <DeleteButton onDelete={() => del('daily_cash_expenses', row.id)} />
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </DataTable>
    );
  }

  if (tab === 'remittance') {
    const r = rows as RemittanceRow[];
    return (
      <DataTable minWidth="680px" columns={['18%', '26%', '18%', '18%', '20%']}>
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
          {r.length === 0 ? (
            <EmptyRow colSpan={5}>No remittances for this date.</EmptyRow>
          ) : (
            r.map((row) => (
              <Tr key={row.id}>
                <Td kind="num"><span style={{ color: C.red }}>{money(row.amount)}</span></Td>
                <Td clip title={row.reference ?? row.remarks ?? undefined} className="text-muted-foreground">
                  {row.reference || row.remarks || '—'}
                </Td>
                <Td kind="center" className="text-xs text-muted-foreground">{fmt(row.createdAt)}</Td>
                <Td kind="center" className="text-xs text-muted-foreground">{row.createdByName}</Td>
                <Td kind="center">
                  <DeleteButton onDelete={() => del('daily_cash_remittances', row.id)} />
                </Td>
              </Tr>
            ))
          )}
        </tbody>
      </DataTable>
    );
  }

  // other_cash_in / other_cash_out
  const r = rows as CashMovementRow[];
  const isIn = tab === 'other_cash_in';
  return (
    <DataTable minWidth="680px" columns={['18%', '16%', '26%', '18%', '14%', '8%']}>
      <Thead>
        <Tr plain>
          <Th>Type</Th>
          <Th kind="num">Amount</Th>
          <Th>Remarks</Th>
          <Th kind="center">Date / Time</Th>
          <Th kind="center">Recorded By</Th>
          <Th kind="center">Action</Th>
        </Tr>
      </Thead>
      <tbody>
        {r.length === 0 ? (
          <EmptyRow colSpan={6}>No {isIn ? 'cash-in' : 'cash-out'} entries for this date.</EmptyRow>
        ) : (
          r.map((row) => (
            <Tr key={row.id}>
              <Td><span style={{ color: isIn ? C.purple : C.red }}>{row.movementType ?? (isIn ? 'Cash In' : 'Cash Out')}</span></Td>
              <Td kind="num"><span style={{ color: isIn ? C.purple : C.red }}>{money(row.amount)}</span></Td>
              <Td clip className="text-muted-foreground" title={row.remarks ?? undefined}>{row.remarks ?? '—'}</Td>
              <Td kind="center" className="text-xs text-muted-foreground">{fmt(row.createdAt)}</Td>
              <Td kind="center" className="text-xs text-muted-foreground">{row.createdByName}</Td>
              <Td kind="center">
                <DeleteButton onDelete={() => del('daily_cash_movements', row.id)} />
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

function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    await onDelete();
    setBusy(false);
  };
  return (
    <button
      type="button"
      onClick={() => void run()}
      className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] text-destructive hover:bg-destructive/10"
    >
      {busy ? '…' : 'Delete'}
    </button>
  );
}

// ===========================================================================
// Add modal (compact) — Expense / Remittance / Cash In / Cash Out
// ===========================================================================

function AddCashModal({
  tab,
  date,
  onClose,
  onSaved,
}: {
  tab: CashTab;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [payee, setPayee] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [reference, setReference] = useState('');
  const [movementType, setMovementType] = useState('');
  const [remarks, setRemarks] = useState('');
  const [entryDate, setEntryDate] = useState(date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    tab === 'expenses' ? 'Add Expense'
    : tab === 'remittance' ? 'Add Remittance'
    : tab === 'other_cash_in' ? 'Add Cash In'
    : 'Add Cash Out';

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let res;
    if (tab === 'expenses') {
      res = await addExpenseAction({ date: entryDate, payee, amount, category: category || null, remarks: remarks || null });
    } else if (tab === 'remittance') {
      res = await addRemittanceAction({ date: entryDate, amount, reference: reference || null, remarks: remarks || null });
    } else {
      res = await addCashMovementAction({
        date: entryDate,
        direction: tab === 'other_cash_in' ? 'in' : 'out',
        movementType: movementType || null,
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
          <Button type="button" onClick={() => void save()} disabled={busy} data-testid="cash-add-save">
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <ModalFormGrid>
        {tab === 'expenses' ? (
          <ModalFieldFull>
            <Label htmlFor="ex-payee" className="text-xs">Name / Payee</Label>
            <Input id="ex-payee" value={payee} onChange={(e) => setPayee(e.target.value)} className="mt-1 h-9" />
          </ModalFieldFull>
        ) : null}
        {tab === 'other_cash_in' || tab === 'other_cash_out' ? (
          <ModalFieldFull>
            <Label htmlFor="mv-type" className="text-xs">Type</Label>
            <Input id="mv-type" value={movementType} onChange={(e) => setMovementType(e.target.value)} placeholder={tab === 'other_cash_in' ? 'e.g. Borrowed / Owner Cash In' : 'e.g. Cash Out'} className="mt-1 h-9" />
          </ModalFieldFull>
        ) : null}
        <div>
          <Label htmlFor="cash-amount" className="text-xs">Amount (₱)</Label>
          <MoneyInput id="cash-amount" value={amount} onValueChange={setAmount} className="mt-1 h-9" />
        </div>
        <div>
          <Label htmlFor="cash-entry-date" className="text-xs">Date</Label>
          <Input id="cash-entry-date" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="mt-1 h-9" />
        </div>
        {tab === 'expenses' ? (
          <div>
            <Label htmlFor="ex-cat" className="text-xs">Category</Label>
            <Input id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Supplies" className="mt-1 h-9" />
          </div>
        ) : null}
        {tab === 'remittance' ? (
          <div>
            <Label htmlFor="rm-ref" className="text-xs">Reference</Label>
            <Input id="rm-ref" value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1 h-9" />
          </div>
        ) : null}
        <ModalFieldFull>
          <Label htmlFor="cash-remarks" className="text-xs">Remarks</Label>
          <Input id="cash-remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} className="mt-1 h-9" />
        </ModalFieldFull>
      </ModalFormGrid>
      {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    </Modal>
  );
}
