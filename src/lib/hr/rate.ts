import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { requireActiveStaff } from '@/lib/authz/guard';
import { normalizeHourlyRate } from '@/lib/hr/format';
import { createClient } from '@/lib/supabase/server';

/**
 * HR: setting a staff member's hourly rate (Bible §F, #4 polish).
 *
 * Authority is NOT this module's to grant — the actual protection is RLS
 * (staff_profiles_update_owner): only the Owner may UPDATE a staff profile, so a
 * non-Owner's write returns zero affected rows even if this ran. The requireOwner
 * gate below is the UX affordance; RLS is the boundary (Bible §30.3 r2).
 *
 * Money discipline: the rate is a `numeric(10,2)` in SQL. It is sent as a STRING
 * and cast by Postgres — never parsed into a JS float here. The column's own
 * check constraint (>= 0) is the last word on validity; we surface its refusal.
 */

export type SetRateResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Set (or clear) a staff member's hourly rate. Setting a rate appends an
 * effective-dated row to staff_hourly_rates (history preserved) via the
 * set_staff_hourly_rate DEFINER function — Owner or Selected Admin. Clearing a rate
 * (empty input) writes null on staff_profiles and is Owner-only (RLS). Payroll uses
 * the rate effective for the period, so the effective date matters.
 */
export async function setHourlyRate(
  staffProfileId: string,
  rawRate: string | null,
  effectiveDate?: string | null,
): Promise<SetRateResult> {
  const staff = await requireActiveStaff();
  const isOwner = staff.roleKey === 'owner';
  const isAdmin = staff.roleKey === 'selected_admin';

  const normalized = normalizeHourlyRate(rawRate);
  if ('error' in normalized) return { ok: false, error: normalized.error };

  const supabase = await createClient();

  // Clearing the rate → direct null write (Owner-only via RLS).
  if (normalized.rate === null) {
    if (!isOwner) {
      return { ok: false, error: 'Only the Owner may clear an hourly rate.' };
    }
    const { data, error } = await supabase
      .from('staff_profiles')
      .update({ hourly_rate: null })
      .eq('id', staffProfileId)
      .select('id');
    if (error || !data || data.length === 0) {
      return { ok: false, error: 'Could not clear the hourly rate.' };
    }
    await recordAuditEvent({
      action: 'payroll.set_hourly_rate',
      entityType: 'staff_profile',
      entityId: staffProfileId,
      context: { rate: null },
    });
    return { ok: true, message: 'Hourly rate cleared.' };
  }

  // Setting a rate → history-aware RPC (Owner/Admin). UX gate here; the DEFINER
  // function re-checks the role.
  if (!isOwner && !isAdmin) {
    await recordAuditEvent({
      action: 'payroll.set_hourly_rate',
      entityType: 'staff_profile',
      entityId: staffProfileId,
      outcome: 'denied',
      reason: 'not_owner_or_admin',
    });
    return {
      ok: false,
      error: 'Only the Owner or a Selected Admin may set an hourly rate.',
    };
  }

  const { error } = await supabase.rpc('set_staff_hourly_rate', {
    p_staff: staffProfileId,
    p_rate: normalized.rate,
    p_effective: effectiveDate?.trim() || new Date().toISOString().slice(0, 10),
  });

  if (error) {
    await recordAuditEvent({
      action: 'payroll.set_hourly_rate',
      entityType: 'staff_profile',
      entityId: staffProfileId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'payroll.set_hourly_rate',
    entityType: 'staff_profile',
    entityId: staffProfileId,
    context: { rate: normalized.rate, effective_date: effectiveDate ?? 'today' },
  });

  return { ok: true, message: 'Hourly rate updated.' };
}

export type EmployeeRateRow = {
  staffProfileId: string;
  fullName: string;
  roleKey: string;
  /** The current DAILY salary rate, or null when none is set. */
  hourlyRate: string | null;
  /** 'weekly' | 'bi_weekly' | 'monthly'. */
  payFrequency: string;
  effectiveDate: string | null;
  lastUpdated: string | null;
};

/**
 * Active team members with their CURRENT hourly rate + when it took effect and was
 * last changed (from the rate history). Powers the Employee Rates tab. RLS-scoped;
 * the page gates this to Owner/Admin.
 */
export async function listEmployeeRates(): Promise<EmployeeRateRow[]> {
  const supabase = await createClient();

  const [{ data: staff }, { data: rates }] = await Promise.all([
    supabase
      .from('staff_profiles')
      .select('id, full_name, role_key, hourly_rate')
      .eq('is_active', true)
      .eq('is_demo', false)
      .neq('role_key', 'owner') // Owners are not on payroll (Owner 2026-09-07)
      .order('full_name', { ascending: true }),
    supabase
      .from('staff_salary_rates')
      .select('staff_profile_id, daily_rate, pay_frequency, effective_date, created_at')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);

  // The newest effective row per person IS the current salary rate — the profile's
  // legacy hourly_rate column is no longer the pay basis.
  const latest = new Map<
    string,
    {
      effective_date: string;
      created_at: string;
      daily_rate: string | null;
      pay_frequency: string;
    }
  >();
  for (const r of (rates ?? []) as Array<Record<string, unknown>>) {
    const sid = r.staff_profile_id as string;
    if (!latest.has(sid)) {
      latest.set(sid, {
        effective_date: r.effective_date as string,
        created_at: r.created_at as string,
        daily_rate:
          typeof r.daily_rate === 'number' || typeof r.daily_rate === 'string'
            ? String(r.daily_rate)
            : null,
        pay_frequency: (r.pay_frequency as string | null) ?? 'weekly',
      });
    }
  }

  const staffRows = (staff ?? []) as Array<{
    id: string;
    full_name: string | null;
    role_key: string | null;
    hourly_rate: number | string | null;
  }>;

  return staffRows.map((s) => {
    const lr = latest.get(s.id);
    return {
      staffProfileId: s.id,
      fullName: s.full_name ?? 'Team member',
      roleKey: s.role_key ?? 'staff',
      hourlyRate: lr?.daily_rate ?? null,
      payFrequency: lr?.pay_frequency ?? 'weekly',
      effectiveDate: lr?.effective_date ?? null,
      lastUpdated: lr?.created_at ?? null,
    };
  });
}

/**
 * Set a team member's SALARY rate (Owner decision: a DAILY rate on a weekly cycle).
 *
 * Effective-dated: each save writes a NEW row for that date rather than editing the
 * old one, so a payroll period already computed keeps the rate that applied then and
 * historical pay is never rewritten. Super Admin only — enforced again in the
 * database function beneath this.
 */
export async function setSalaryRate(
  staffProfileId: string,
  rawRate: string | null,
  frequency: string | null,
  effectiveDate: string | null,
): Promise<SetRateResult> {
  if (!staffProfileId) return { ok: false, error: 'Missing staff member.' };

  const rate = (rawRate ?? '').trim();
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(rate)) {
    return { ok: false, error: 'Enter a salary amount of zero or more.' };
  }
  const freq = (frequency ?? 'weekly').trim();
  if (!['weekly', 'bi_weekly', 'monthly'].includes(freq)) {
    return { ok: false, error: 'Pay frequency must be Weekly, Bi-Weekly, or Monthly.' };
  }
  const effective = (effectiveDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    return { ok: false, error: 'An effective date is required.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_staff_salary_rate', {
    p_staff: staffProfileId,
    p_daily_rate: rate,
    p_frequency: freq,
    p_effective: effective,
  });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'payroll.set_salary_rate',
    entityType: 'staff_profile',
    entityId: staffProfileId,
    context: { daily_rate: rate, pay_frequency: freq, effective_date: effective },
  });

  return {
    ok: true,
    message: `Salary rate saved: ₱${rate} per day, ${freq.replace('_', '-')}, effective ${effective}.`,
  };
}
