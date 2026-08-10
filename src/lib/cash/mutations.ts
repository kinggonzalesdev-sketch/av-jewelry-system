import 'server-only';

import { requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { recordAuditEvent } from '@/lib/audit/log';
import type { MutationResult } from '@/lib/cash/types';

/**
 * Daily Cash Summary — WRITE domain (authority lives here + in RLS). Every write
 * re-checks Owner / Selected Admin and is audited; the thin `actions.ts` only
 * transports. Owner / Selected Admin is the boundary (RLS enforces it in the DB too).
 * Money is a string; the close difference is computed in exact centavos, never a float.
 * Nothing here touches orders, payments, or any existing record.
 */

/** Valid non-negative money string, else null. */
function money(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  return s;
}

/** Two money strings → their difference as a signed money string (exact centavos). */
function diffCentavos(actual: string, expected: string): string {
  const toC = (x: string): bigint => {
    const [w, f = ''] = x.replace('-', '').split('.');
    const cents = BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2) || '0');
    return x.trim().startsWith('-') ? -cents : cents;
  };
  const d = toC(actual) - toC(expected);
  const neg = d < 0n;
  const abs = neg ? -d : d;
  const body = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return neg ? `-${body}` : body;
}

async function requireManager(): Promise<MutationResult> {
  try {
    await requireOwnerOrAdmin();
    return { ok: true };
  } catch {
    return { ok: false, error: 'Only the Owner or a Selected Admin can edit cash records.' };
  }
}

export async function addExpense(input: {
  date: string;
  payee: string;
  amount: string;
  category: string | null;
  remarks: string | null;
}): Promise<MutationResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const amount = money(input.amount);
  if (!amount) return { ok: false, error: 'Enter a valid amount.' };
  if (!input.payee.trim()) return { ok: false, error: 'A name / payee is required.' };
  if (!input.date) return { ok: false, error: 'A date is required.' };
  const supabase = await createClient();
  const { error } = await supabase.from('daily_cash_expenses').insert({
    expense_date: input.date,
    payee: input.payee.trim(),
    amount,
    category: input.category?.trim() || null,
    remarks: input.remarks?.trim() || null,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({ action: 'daily_cash.expense.add', entityType: 'daily_cash_expense', entityId: input.date, context: { amount } });
  return { ok: true };
}

export async function addRemittance(input: {
  date: string;
  amount: string;
  reference: string | null;
  remarks: string | null;
}): Promise<MutationResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const amount = money(input.amount);
  if (!amount) return { ok: false, error: 'Enter a valid amount.' };
  if (!input.date) return { ok: false, error: 'A date is required.' };
  const supabase = await createClient();
  const { error } = await supabase.from('daily_cash_remittances').insert({
    remit_date: input.date,
    amount,
    reference: input.reference?.trim() || null,
    remarks: input.remarks?.trim() || null,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({ action: 'daily_cash.remittance.add', entityType: 'daily_cash_remittance', entityId: input.date, context: { amount } });
  return { ok: true };
}

export async function addCashMovement(input: {
  date: string;
  direction: 'in' | 'out';
  movementType: string | null;
  amount: string;
  remarks: string | null;
}): Promise<MutationResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const amount = money(input.amount);
  if (!amount) return { ok: false, error: 'Enter a valid amount.' };
  if (!input.date) return { ok: false, error: 'A date is required.' };
  const supabase = await createClient();
  const { error } = await supabase.from('daily_cash_movements').insert({
    movement_date: input.date,
    direction: input.direction,
    movement_type: input.movementType?.trim() || null,
    amount,
    remarks: input.remarks?.trim() || null,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({ action: `daily_cash.cash_${input.direction}.add`, entityType: 'daily_cash_movement', entityId: input.date, context: { amount } });
  return { ok: true };
}

const DELETABLE = new Set(['daily_cash_expenses', 'daily_cash_remittances', 'daily_cash_movements']);

export async function deleteCashRecord(table: string, id: string): Promise<MutationResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  if (!DELETABLE.has(table) || !id) return { ok: false, error: 'That record cannot be deleted here.' };
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({ action: 'daily_cash.record.delete', entityType: table, entityId: id });
  return { ok: true };
}

export async function saveActualCashCount(
  date: string,
  actualCount: string,
  expected: string,
): Promise<MutationResult> {
  const g = await requireManager();
  if (!g.ok) return g;
  const actual = money(actualCount);
  if (!actual) return { ok: false, error: 'Enter the actual counted cash.' };
  if (!date) return { ok: false, error: 'A date is required.' };
  const difference = diffCentavos(actual, money(expected) ?? '0');
  const supabase = await createClient();
  const { error } = await supabase.from('daily_cash_closes').upsert(
    {
      close_date: date,
      actual_cash_count: actual,
      expected_cash: money(expected) ?? '0',
      difference,
      status: 'closed',
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'close_date' },
  );
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({ action: 'daily_cash.close', entityType: 'daily_cash_close', entityId: date, context: { actual, expected, difference } });
  return { ok: true };
}
