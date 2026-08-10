/**
 * Daily Cash Summary — shared types (client-safe). Money is carried as authoritative
 * STRINGS end-to-end (never a float). Aggregation happens server-side.
 */

export type DailyCashSummary = {
  date: string;
  cashSales: string;
  previousCash: string;
  otherCashIn: string;
  expenses: string;
  remittance: string;
  otherCashOut: string;
  expected: string;
  /** The saved physical count for this day, or null if not counted yet. */
  actualCount: string | null;
  closeStatus: 'open' | 'closed';
};

export type DetailPage<T> = { rows: T[]; total: number };

export type WalkInRow = {
  id: string;
  orderNumber: string;
  name: string;
  purchased: string;
  nonCash: string;
  cash: string;
  tradeDeductions: string;
};

export type CashPaymentRow = {
  id: string;
  name: string;
  orderNumber: string;
  amount: string;
  reference: string | null;
  at: string;
};

export type TradeDeductionRow = {
  id: string;
  name: string;
  orderNumber: string;
  label: string;
  amount: string;
  at: string;
};

export type ExpenseRow = {
  id: string;
  payee: string;
  amount: string;
  category: string | null;
  remarks: string | null;
  createdByName: string;
  createdAt: string;
};

export type RemittanceRow = {
  id: string;
  amount: string;
  reference: string | null;
  remarks: string | null;
  createdByName: string;
  createdAt: string;
};

export type CashMovementRow = {
  id: string;
  movementType: string | null;
  amount: string;
  remarks: string | null;
  createdByName: string;
  createdAt: string;
};

/** The Details tabs, in the approved order. */
export const CASH_TABS = [
  'sales_walkins',
  'cash_payments',
  'trade_deductions',
  'expenses',
  'remittance',
  'other_cash_in',
  'other_cash_out',
] as const;
export type CashTab = (typeof CASH_TABS)[number];

export const CASH_TAB_LABEL: Record<CashTab, string> = {
  sales_walkins: 'Sales Walk-ins',
  cash_payments: 'Cash Payments',
  trade_deductions: 'Trade Deductions',
  expenses: 'Expenses',
  remittance: 'Remittance',
  other_cash_in: 'Other Cash In',
  other_cash_out: 'Other Cash Out',
};

export type MutationResult = { ok: true } | { ok: false; error: string };
