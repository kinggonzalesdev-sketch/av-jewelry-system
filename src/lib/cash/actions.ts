'use server';

import { revalidatePath } from 'next/cache';

import {
  addCashMovement,
  addExpense,
  addRemittance,
  addTrade,
  deleteCashRecord,
  saveActualCashCount,
  updateCashMovement,
  updateExpense,
  updateRemittance,
  updateTrade,
} from '@/lib/cash/mutations';
import {
  getCashMovements,
  getCashPayments,
  getDailyCashSummary,
  getExpenses,
  getRemittances,
  getTradeDeductions,
  getTradesExpenses,
  getWalkIns,
} from '@/lib/cash/service';
import type {
  CashMovementRow,
  CashPaymentRow,
  CashTab,
  DailyCashSummary,
  DetailPage,
  ExpenseRow,
  MutationResult,
  RemittanceRow,
  TradeDeductionRow,
  TradeExpenseRow,
  WalkInRow,
} from '@/lib/cash/types';
import { listWalkInItems, type WalkInItem } from '@/lib/orders/service';
import { requirePermission } from '@/lib/authz/guard';

/**
 * Lazy-load the walk-in item picker ONLY when the operator opens "+ Add New Sale". It wraps
 * `listInventory()` (~1,900 rows + a staff join + ~4 DB round-trips), so eager-loading it on
 * every Daily Cash open was the page's main delay even though the modal was closed. Gated on
 * `claim_capture` — the same permission the "+ Add New Sale" button requires.
 */
export async function loadWalkInItemsAction(): Promise<WalkInItem[]> {
  await requirePermission('claim_capture');
  return listWalkInItems();
}

/**
 * Daily Cash Summary — server actions (transport only). Authority (Owner / Selected
 * Admin), validation, and audit live in the mutations domain module + the database.
 * These just call the domain and revalidate the page.
 */

const CASH_PATH = '/cash/daily';

/**
 * Lazy tab loader (spec §22 — only fetch a Details tab when it is opened, paginated).
 * Reads go through the service domain module, each gated on view_reports.
 */
export async function loadCashDetailAction(
  tab: CashTab,
  date: string,
  page: number,
  size: number,
): Promise<{ total: number; rows: unknown[] }> {
  switch (tab) {
    case 'sales_walkins':
      return getWalkIns(date, page, size);
    case 'cash_payments':
      return getCashPayments(date, page, size);
    case 'trade_deductions':
      return getTradeDeductions(date, page, size);
    case 'expenses':
      return getExpenses(date, page, size);
    case 'remittance':
      return getRemittances(date, page, size);
    case 'other_cash_in':
      return getCashMovements(date, 'in', page, size);
    case 'other_cash_out':
      return getCashMovements(date, 'out', page, size);
    default:
      return { total: 0, rows: [] };
  }
}

/** Load the combined "Trades & Expenses" list (manual expenses + manual trades),
 *  paginated for the selected date — the right-hand box's data source. */
export async function loadTradesExpensesAction(
  date: string,
  page: number,
  size: number,
): Promise<DetailPage<TradeExpenseRow>> {
  return getTradesExpenses(date, page, size);
}

/**
 * Re-read ONLY the day's summary (cards / breakdown / expected). The Details section
 * calls this after a manual add/edit/delete so the totals recalculate in place —
 * no full-page reload, so the End-of-Day Actual Cash Count the user is typing is
 * never reset. Read-gated on view_reports (same as the page).
 */
export async function loadCashSummaryAction(date: string): Promise<DailyCashSummary> {
  return getDailyCashSummary(date);
}

export type CashExport = {
  walkIns: WalkInRow[];
  cashPayments: CashPaymentRow[];
  tradeDeductions: TradeDeductionRow[];
  expenses: ExpenseRow[];
  /** Manual Trades (display-only entries) — separate from order Trade Deductions. */
  trades: TradeExpenseRow[];
  remittances: RemittanceRow[];
  cashIn: CashMovementRow[];
  cashOut: CashMovementRow[];
};

/**
 * Gather the day's FULL detailed transactions for Export (spec §23) — every tab, not
 * just the on-screen page. Read-gated on view_reports (each service reader). Capped per
 * tab so a huge day still exports safely; a day's transactions are naturally bounded.
 */
export async function loadCashExportAction(date: string): Promise<CashExport> {
  const P = 1;
  const N = 2000;
  const [w, cp, td, ex, te, rm, ci, co] = await Promise.all([
    getWalkIns(date, P, N),
    getCashPayments(date, P, N),
    getTradeDeductions(date, P, N),
    getExpenses(date, P, N),
    getTradesExpenses(date, P, N),
    getRemittances(date, P, N),
    getCashMovements(date, 'in', P, N),
    getCashMovements(date, 'out', P, N),
  ]);
  return {
    walkIns: w.rows,
    cashPayments: cp.rows,
    tradeDeductions: td.rows,
    expenses: ex.rows,
    // Only the manual TRADES (the expenses are exported separately, above).
    trades: te.rows.filter((r) => r.type === 'trade'),
    remittances: rm.rows,
    cashIn: ci.rows,
    cashOut: co.rows,
  };
}

export async function addExpenseAction(input: {
  date: string;
  payee: string;
  amount: string;
  category: string | null;
  remarks: string | null;
}): Promise<MutationResult> {
  const result = await addExpense(input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function addTradeAction(input: {
  date: string;
  name: string;
  amount: string;
  relatedSale: string | null;
  remarks: string | null;
}): Promise<MutationResult> {
  const result = await addTrade(input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function updateTradeAction(
  id: string,
  input: {
    date: string;
    name: string;
    amount: string;
    relatedSale: string | null;
    remarks: string | null;
  },
): Promise<MutationResult> {
  const result = await updateTrade(id, input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function addRemittanceAction(input: {
  date: string;
  amount: string;
  reference: string | null;
  remarks: string | null;
}): Promise<MutationResult> {
  const result = await addRemittance(input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function addCashMovementAction(input: {
  date: string;
  direction: 'in' | 'out';
  movementType: string | null;
  amount: string;
  remarks: string | null;
}): Promise<MutationResult> {
  const result = await addCashMovement(input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function updateExpenseAction(
  id: string,
  input: {
    date: string;
    payee: string;
    amount: string;
    category: string | null;
    remarks: string | null;
  },
): Promise<MutationResult> {
  const result = await updateExpense(id, input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function updateRemittanceAction(
  id: string,
  input: {
    date: string;
    amount: string;
    reference: string | null;
    remarks: string | null;
  },
): Promise<MutationResult> {
  const result = await updateRemittance(id, input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function updateCashMovementAction(
  id: string,
  input: {
    date: string;
    movementType: string | null;
    amount: string;
    remarks: string | null;
  },
): Promise<MutationResult> {
  const result = await updateCashMovement(id, input);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function deleteCashRecordAction(
  table: string,
  id: string,
): Promise<MutationResult> {
  const result = await deleteCashRecord(table, id);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}

export async function saveActualCashCountAction(
  date: string,
  actualCount: string,
  expected: string,
): Promise<MutationResult> {
  const result = await saveActualCashCount(date, actualCount, expected);
  if (result.ok) revalidatePath(CASH_PATH);
  return result;
}
