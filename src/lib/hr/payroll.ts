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
    computedSalary:
      r.computed_salary === null || r.computed_salary === undefined
        ? null
        : String(r.computed_salary as string | number),
  }));

  return { ok: true, rows };
}
