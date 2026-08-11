'use server';

import { revalidatePath } from 'next/cache';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { mapSnapshotRow } from '@/lib/hr/payslip';
import type { PayslipActionState } from '@/lib/hr/payslip-types';
import { createClient } from '@/lib/supabase/server';

/**
 * Payslip server actions (Bible §F). Transport only — generating and marking-paid
 * are Owner acts; requireOwner and the payroll_snapshots RLS both enforce it. The
 * money math lives in the SQL function (generate_payslip_snapshot), never here.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function generatePayslipAction(
  _prev: PayslipActionState,
  formData: FormData,
): Promise<PayslipActionState> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { error: cause.message, success: null, snapshot: null };
    }
    throw cause;
  }

  const employeeId = text(formData, 'employeeId');
  const from = text(formData, 'from');
  const to = text(formData, 'to');
  const deductionsRaw = text(formData, 'deductions');

  if (!employeeId || !from || !to) {
    return {
      error: 'Missing employee or payroll period.',
      success: null,
      snapshot: null,
    };
  }
  // Deductions cross the wire as a string; the SQL clamps to >= 0.
  if (deductionsRaw !== null && !/^\d+(\.\d{1,2})?$/.test(deductionsRaw)) {
    return {
      error: 'Deductions must be a non-negative amount like 0 or 500.00.',
      success: null,
      snapshot: null,
    };
  }

  const supabase = await createClient();
  const response = await supabase.rpc('generate_payslip_snapshot', {
    p_employee: employeeId,
    p_from: from,
    p_to: to,
    p_deductions: deductionsRaw ?? '0',
  });

  if (response.error || !response.data) {
    return {
      error: response.error?.message ?? 'The payslip could not be generated.',
      success: null,
      snapshot: null,
    };
  }

  // The RPC returns the inserted row; re-read it with the staff name embedded so
  // the modal has everything it needs.
  const rowId = (response.data as Record<string, unknown>).id as string;
  const readBack = await supabase
    .from('payroll_snapshots')
    .select(
      'id, employee_id, payroll_start_date, payroll_end_date, regular_hours, overtime_hours, hourly_rate, daily_rate, days_worked, night_shifts, rate_basis, regular_salary, overtime_pay, gross_salary, deductions, net_salary, payment_status, payment_date, generated_at, staff:staff_profiles!employee_id ( full_name, role_key )',
    )
    .eq('id', rowId)
    .single();

  const snapshot = readBack.data
    ? mapSnapshotRow(readBack.data)
    : mapSnapshotRow(response.data as Record<string, unknown>);

  await recordAuditEvent({
    action: 'payroll.payslip_generated',
    entityType: 'payroll_snapshot',
    entityId: rowId,
    context: { from, to, net_salary: snapshot.netSalary },
  });

  revalidatePath('/admin/payroll');
  return { error: null, success: 'Payslip generated.', snapshot };
}

export async function markPayslipPaidAction(
  _prev: PayslipActionState,
  formData: FormData,
): Promise<PayslipActionState> {
  // Owner or authorized Admin may mark a payroll record paid.
  let actor;
  try {
    actor = await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { error: cause.message, success: null, snapshot: null };
    }
    throw cause;
  }

  const snapshotId = text(formData, 'snapshotId');
  const paymentDate =
    text(formData, 'paymentDate') ?? new Date().toISOString().slice(0, 10);
  if (!snapshotId) {
    return { error: 'Missing payslip.', success: null, snapshot: null };
  }

  const supabase = await createClient();
  // Guard: only a still-pending snapshot flips to paid — a repeat confirmation
  // changes nothing and never overwrites the original paid date / who paid it.
  const { data, error } = await supabase
    .from('payroll_snapshots')
    .update({
      payment_status: 'paid',
      payment_date: paymentDate,
      paid_at: new Date().toISOString(),
      paid_by: actor.staffProfileId,
    })
    .eq('id', snapshotId)
    .eq('payment_status', 'pending')
    .select('id, payment_status, payment_date')
    .single();

  if (error || !data) {
    return {
      error: 'Could not mark the payslip as paid. It may already be paid.',
      success: null,
      snapshot: null,
    };
  }

  await recordAuditEvent({
    action: 'payroll.payslip_marked_paid',
    entityType: 'payroll_snapshot',
    entityId: snapshotId,
    context: { payment_date: paymentDate, paid_by: actor.staffProfileId },
  });

  revalidatePath('/admin/payroll');
  return { error: null, success: 'Payslip marked as paid.', snapshot: null };
}
