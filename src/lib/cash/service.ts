import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import type {
  CashMovementRow,
  CashPaymentRow,
  DailyCashSummary,
  DetailPage,
  ExpenseRow,
  RemittanceRow,
  TradeDeductionRow,
  WalkInRow,
} from '@/lib/cash/types';

/**
 * Daily Cash Summary — server reads. All values come from the canonical MineFlow
 * records (payments, orders, charges) + the module's own manual-entry tables, never
 * double-counting. Every read is gated on `view_reports` (financial). Money stays a
 * string. Detail readers are paginated (server-side) so a busy day never loads
 * thousands of rows.
 */

/** A JSON scalar → plain string (never "[object Object]"). */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** A money JSON value (rpc numerics come back as numbers) → authoritative string. */
function money(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string' && v.trim() !== '') return v;
  return '0';
}

export async function getDailyCashSummary(date: string): Promise<DailyCashSummary> {
  await requirePermission('view_reports');
  const supabase = await createClient();
  const { data } = (await supabase.rpc('daily_cash_summary', { p_date: date })) as {
    data: Record<string, unknown> | null;
  };
  const d = data ?? {};
  return {
    date,
    cashSales: money(d.cashSales),
    previousCash: money(d.previousCash),
    otherCashIn: money(d.otherCashIn),
    expenses: money(d.expenses),
    remittance: money(d.remittance),
    otherCashOut: money(d.otherCashOut),
    expected: money(d.expected),
    actualCount: d.actualCount == null ? null : money(d.actualCount),
    closeStatus: d.closeStatus === 'closed' ? 'closed' : 'open',
  };
}

/** A DEFINER reader that returns { rows, total }. */
async function rpcPage(
  fn: string,
  date: string,
  page: number,
  size: number,
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const supabase = await createClient();
  const { data } = (await supabase.rpc(fn, {
    p_date: date,
    p_limit: size,
    p_offset: (page - 1) * size,
  })) as { data: { rows?: Record<string, unknown>[]; total?: number } | null };
  return { rows: data?.rows ?? [], total: Number(data?.total ?? 0) };
}

export async function getWalkIns(
  date: string,
  page: number,
  size: number,
): Promise<DetailPage<WalkInRow>> {
  await requirePermission('view_reports');
  const { rows, total } = await rpcPage('daily_cash_walkins', date, page, size);
  return {
    total,
    rows: rows.map((r) => ({
      id: str(r.id),
      orderNumber: str(r.orderNumber) || '—',
      name: str(r.name) || '—',
      purchased: money(r.purchased),
      nonCash: money(r.nonCash),
      cash: money(r.cash),
      tradeDeductions: money(r.tradeDeductions),
    })),
  };
}

export async function getCashPayments(
  date: string,
  page: number,
  size: number,
): Promise<DetailPage<CashPaymentRow>> {
  await requirePermission('view_reports');
  const { rows, total } = await rpcPage('daily_cash_payments', date, page, size);
  return {
    total,
    rows: rows.map((r) => ({
      id: str(r.id),
      name: str(r.name) || '—',
      orderNumber: str(r.orderNumber) || '—',
      amount: money(r.amount),
      reference: (r.reference as string | null) ?? null,
      at: str(r.at),
    })),
  };
}

export async function getTradeDeductions(
  date: string,
  page: number,
  size: number,
): Promise<DetailPage<TradeDeductionRow>> {
  await requirePermission('view_reports');
  const { rows, total } = await rpcPage('daily_cash_trade_deductions', date, page, size);
  return {
    total,
    rows: rows.map((r) => ({
      id: str(r.id),
      name: str(r.name) || '—',
      orderNumber: str(r.orderNumber) || '—',
      label: str(r.label) || '—',
      amount: money(r.amount),
      at: str(r.at),
    })),
  };
}

/** Resolve staff ids → full names in one query (created_by has no FK to embed). */
async function staffNames(
  supabase: SupabaseClient,
  ids: (string | null)[],
): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (uniq.length === 0) return {};
  const { data } = await supabase
    .from('staff_profiles')
    .select('id, full_name')
    .in('id', uniq);
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as { id: string; full_name: string | null }[]) {
    map[r.id] = r.full_name ?? '—';
  }
  return map;
}

async function tablePage(
  table: string,
  dateColumn: string,
  date: string,
  page: number,
  size: number,
): Promise<{
  rows: Record<string, unknown>[];
  total: number;
  names: Record<string, string>;
}> {
  const supabase = await createClient();
  const { data, count } = await supabase
    .from(table)
    .select('*', { count: 'exact' })
    .eq(dateColumn, date)
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .range((page - 1) * size, page * size - 1);
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await staffNames(
    supabase,
    rows.map((r) => r.created_by as string | null),
  );
  return { rows, total: count ?? 0, names };
}

export async function getExpenses(
  date: string,
  page: number,
  size: number,
): Promise<DetailPage<ExpenseRow>> {
  await requirePermission('view_reports');
  const { rows, total, names } = await tablePage(
    'daily_cash_expenses',
    'expense_date',
    date,
    page,
    size,
  );
  return {
    total,
    rows: rows.map((r) => ({
      id: str(r.id),
      payee: str(r.payee) || '—',
      amount: money(r.amount),
      category: (r.category as string | null) ?? null,
      remarks: (r.remarks as string | null) ?? null,
      createdByName: names[r.created_by as string] ?? '—',
      createdAt: str(r.created_at),
    })),
  };
}

export async function getRemittances(
  date: string,
  page: number,
  size: number,
): Promise<DetailPage<RemittanceRow>> {
  await requirePermission('view_reports');
  const { rows, total, names } = await tablePage(
    'daily_cash_remittances',
    'remit_date',
    date,
    page,
    size,
  );
  return {
    total,
    rows: rows.map((r) => ({
      id: str(r.id),
      amount: money(r.amount),
      reference: (r.reference as string | null) ?? null,
      remarks: (r.remarks as string | null) ?? null,
      createdByName: names[r.created_by as string] ?? '—',
      createdAt: str(r.created_at),
    })),
  };
}

export async function getCashMovements(
  date: string,
  direction: 'in' | 'out',
  page: number,
  size: number,
): Promise<DetailPage<CashMovementRow>> {
  await requirePermission('view_reports');
  const supabase = await createClient();
  const { data, count } = await supabase
    .from('daily_cash_movements')
    .select('*', { count: 'exact' })
    .eq('movement_date', date)
    .eq('direction', direction)
    .eq('is_test', false)
    .order('created_at', { ascending: false })
    .range((page - 1) * size, page * size - 1);
  const rows = (data ?? []) as Record<string, unknown>[];
  const names = await staffNames(
    supabase,
    rows.map((r) => r.created_by as string | null),
  );
  const total = count ?? 0;
  return {
    total,
    rows: rows.map((r) => ({
      id: str(r.id),
      movementType: (r.movement_type as string | null) ?? null,
      amount: money(r.amount),
      remarks: (r.remarks as string | null) ?? null,
      createdByName: names[r.created_by as string] ?? '—',
      createdAt: str(r.created_at),
    })),
  };
}
