import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Payroll read (Bible §F). Every figure comes from report_payroll, where hours,
 * overtime, and salary are computed in SQL. Salary is an authoritative string
 * (numeric in SQL), or null when no hourly rate is set — never invented.
 */

export type PayrollRow = {
  staffProfileId: string;
  fullName: string;
  roleKey: string;
  totalHours: number;
  overtimeHours: number;
  /** The DAILY salary rate as a string, or null when no rate is set. */
  dailyRate: string | null;
  /** 'weekly' | 'bi_weekly' | 'monthly'. */
  payFrequency: string;
  /** Days actually worked in the period, counted from attendance. */
  daysWorked: number;
  /** Shifts clocked out at or after 22:00 Manila — each earns the flat bonus. */
  nightShifts: number;
  /** Flat night-shift bonus total for the period. */
  overtimePay: string;
  /** Numeric-in-SQL salary as a string, or null when no rate is set. */
  computedSalary: string | null;
};

export type PayrollResult = { ok: true; rows: PayrollRow[] } | { ok: false };

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function getPayroll(from: string, to: string): Promise<PayrollResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('report_payroll', { p_from: from, p_to: to });

  if (response.error || !response.data) return { ok: false };

  const rows = (response.data as Array<Record<string, unknown>>).map((r) => ({
    staffProfileId: r.staff_profile_id as string,
    fullName: (r.full_name as string | null) ?? 'Staff member',
    roleKey: (r.role_key as string | null) ?? 'staff',
    totalHours: num(r.total_hours),
    overtimeHours: num(r.overtime_hours),
    dailyRate:
      typeof r.daily_rate === 'number' || typeof r.daily_rate === 'string'
        ? String(r.daily_rate)
        : null,
    payFrequency: (r.pay_frequency as string | null) ?? 'weekly',
    daysWorked: num(r.days_worked),
    nightShifts: num(r.night_shifts),
    overtimePay:
      typeof r.overtime_pay === 'number' || typeof r.overtime_pay === 'string'
        ? String(r.overtime_pay)
        : '0',
    computedSalary:
      r.computed_salary === null || r.computed_salary === undefined
        ? null
        : String(r.computed_salary as string | number),
  }));

  return { ok: true, rows };
}
