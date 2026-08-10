'use server';

import { revalidatePath } from 'next/cache';

import {
  addCashMovement,
  addExpense,
  addRemittance,
  deleteCashRecord,
  saveActualCashCount,
} from '@/lib/cash/mutations';
import {
  getCashMovements,
  getCashPayments,
  getExpenses,
  getRemittances,
  getTradeDeductions,
  getWalkIns,
} from '@/lib/cash/service';
import type { CashTab, MutationResult } from '@/lib/cash/types';

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

export async function deleteCashRecordAction(table: string, id: string): Promise<MutationResult> {
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
