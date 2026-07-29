import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { PayslipSnapshot } from '@/lib/hr/payslip-types';

/**
 * Payslip snapshots reader (Bible §F). Read-only; every figure is the frozen
 * value the SQL function computed at generation time — this module never
 * recomputes salary. RLS scopes rows to the caller's own payslips, or all for
 * the Owner.
 */

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

/** Maps a raw payroll_snapshots row (+ embedded staff) to the client shape. */
export function mapSnapshotRow(row: Record<string, unknown>): PayslipSnapshot {
  const staff = one<{ full_name: string; role_key: string }>(row.staff);
  const money = (v: unknown): string => String((v as string | number | null) ?? '0');
  return {
    id: row.id as string,
    employeeId: row.employee_id as string,
    employeeName: staff?.full_name ?? 'Staff member',
    roleKey: staff?.role_key ?? 'staff',
    payrollStartDate: row.payroll_start_date as string,
    payrollEndDate: row.payroll_end_date as string,
    regularHours: money(row.regular_hours),
    overtimeHours: money(row.overtime_hours),
    // A daily payslip stores its figure in daily_rate; legacy ones in hourly_rate.
    hourlyRate:
      row.daily_rate !== null && row.daily_rate !== undefined
        ? money(row.daily_rate)
        : row.hourly_rate === null || row.hourly_rate === undefined
          ? null
          : money(row.hourly_rate),
    rateBasis: (row.rate_basis as 'hourly' | 'daily' | null) ?? 'hourly',
    daysWorked: Number(row.days_worked ?? 0),
    nightShifts: Number(row.night_shifts ?? 0),
    regularSalary: money(row.regular_salary),
    overtimePay: money(row.overtime_pay),
    grossSalary: money(row.gross_salary),
    deductions: money(row.deductions),
    netSalary: money(row.net_salary),
    paymentStatus: (row.payment_status as 'pending' | 'paid') ?? 'pending',
    paymentDate: (row.payment_date as string | null) ?? null,
    generatedAt: row.generated_at as string,
  };
}

const SELECT =
  'id, employee_id, payroll_start_date, payroll_end_date, regular_hours, overtime_hours, hourly_rate, daily_rate, days_worked, night_shifts, rate_basis, regular_salary, overtime_pay, gross_salary, deductions, net_salary, payment_status, payment_date, generated_at, staff:staff_profiles!employee_id ( full_name, role_key )';

/**
 * The payslip snapshots for an exact payroll period. Keyed by employee id so the
 * Payroll table can show, per row, whether a payslip exists and its pay status.
 * When several snapshots exist for the same employee+period (regenerations), the
 * most recent wins for display — history is preserved in the table.
 */
export async function listPayslipsForPeriod(
  from: string,
  to: string,
): Promise<Record<string, PayslipSnapshot>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('payroll_snapshots')
    .select(SELECT)
    .eq('payroll_start_date', from)
    .eq('payroll_end_date', to)
    .order('generated_at', { ascending: false });

  if (error || !data) return {};

  const byEmployee: Record<string, PayslipSnapshot> = {};
  for (const raw of data as Array<Record<string, unknown>>) {
    const snap = mapSnapshotRow(raw);
    // First seen wins (rows are newest-first) — the latest snapshot per employee.
    if (!byEmployee[snap.employeeId]) byEmployee[snap.employeeId] = snap;
  }
  return byEmployee;
}
