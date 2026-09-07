'use server';

import { revalidatePath } from 'next/cache';

import {
  correctAttendanceClockOut,
  deleteAttendanceRecord,
  kioskClockIn,
  kioskClockOut,
  listAttendancePage,
  listAttendanceSelfiesFor,
  type AttendanceSelfies,
} from '@/lib/hr/attendance';
import type {
  AttendanceFilters,
  AttendancePage,
  AttendancePageSize,
} from '@/lib/hr/attendance-paging';
import { requirePermission } from '@/lib/authz/guard';
import {
  requestOwnerDeletion,
  type RequestDeletionResult,
} from '@/lib/authz/request-deletion';
import { registerThisDevice, revokeDevice } from '@/lib/hr/devices';
import { setSalaryRate } from '@/lib/hr/rate';
import type { HrActionState } from '@/lib/hr/action-state';

/**
 * HR attendance server actions (Bible §F). Transport only — authority (active
 * staff, self-only writes) and the one-open-session rule live in the domain
 * module and the database.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Lazy-load the signed selfie URLs for ONE day's attendance records — invoked when the
 * reviewer opens a day in Review Attendance. Keeps the page load from minting a signed URL
 * for EVERY selfie ever (that eager read was the page's main delay). Gated on
 * hr_review_attendance, the same permission the page requires.
 */
export async function loadAttendanceSelfiesAction(
  recordIds: string[],
): Promise<AttendanceSelfies> {
  await requirePermission('hr_review_attendance');
  return listAttendanceSelfiesFor(recordIds);
}

/**
 * One page of attendance records for the toolbar (search, date range, staff, status) and the
 * pagination footer. Gated on hr_attendance — the same permission the page requires — and the
 * rows themselves stay RLS-scoped, so this can never widen what a member may read.
 */
export async function loadAttendancePageAction(
  filters: AttendanceFilters,
  page: number,
  pageSize: AttendancePageSize,
): Promise<AttendancePage> {
  await requirePermission('hr_attendance');
  return listAttendancePage(filters, page, pageSize);
}

export async function clockInAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  // Kiosk model: the selected team member is clocked in (not necessarily the caller).
  const result = await kioskClockIn(
    text(formData, 'staffProfileId') ?? '',
    text(formData, 'note'),
  );
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  // Return the new record id so the client can attach the clock-in selfie to it.
  return { error: null, success: result.message, recordId: result.recordId ?? null };
}

export async function clockOutAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const result = await kioskClockOut(text(formData, 'staffProfileId') ?? '');
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  // Return the closed session's id so the client can attach the clock-out selfie.
  return { error: null, success: result.message, recordId: result.recordId ?? null };
}

/** Owner registers THIS device as the approved shop phone (sets an httpOnly cookie). */
export async function registerDeviceAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const result = await registerThisDevice(text(formData, 'label') ?? '');
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  return {
    error: null,
    success: 'This device is now the approved shop phone for clock in/out.',
  };
}

/** Owner revokes a device — it can no longer clock in/out. */
export async function revokeDeviceAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const id = text(formData, 'deviceId');
  if (!id) return { error: 'Missing device.', success: null };
  const result = await revokeDevice(id);
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  return { error: null, success: 'Device revoked. It can no longer clock in/out.' };
}

/**
 * Permanently delete one attendance record (Owner/Admin). Requires typing DELETE;
 * the database blocks anyone below Selected Admin. Payroll is derived, so it
 * recomputes automatically after the revalidate.
 */
export async function deleteAttendanceRecordAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const recordId = text(formData, 'recordId');
  const confirm = text(formData, 'confirm');
  if (!recordId) return { error: 'Missing attendance record.', success: null };
  if (confirm !== 'DELETE') {
    return { error: 'Type DELETE to permanently delete this record.', success: null };
  }

  const result = await deleteAttendanceRecord(recordId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/attendance');
  revalidatePath('/admin/attendance/review');
  revalidatePath('/admin/payroll');
  return { error: null, success: 'Attendance record permanently deleted.' };
}

/**
 * Correct a record's clock-out time (Review Attendance, Owner/Selected Admin). Closes a
 * forgotten open session or shortens an over-long one with a mandatory reason; the domain
 * module + database re-check the role and validate the time. Payroll recomputes on the next
 * read (issued payslips are frozen).
 */
export async function correctAttendanceClockOutAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const recordId = text(formData, 'recordId');
  const timeOut = text(formData, 'timeOut');
  const reason = text(formData, 'reason');
  if (!recordId) return { error: 'Missing attendance record.', success: null };
  if (!timeOut) return { error: 'Enter a clock-out time.', success: null };
  if (!reason) return { error: 'A correction reason is required.', success: null };

  const result = await correctAttendanceClockOut(recordId, timeOut, reason);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/attendance/review');
  revalidatePath('/admin/attendance');
  revalidatePath('/admin/payroll');
  return { error: null, success: 'Clock-out corrected.' };
}

/**
 * Approvals Phase 2: a non-owner Admin asks the Owner to approve deleting an
 * attendance record. Creates a pending Owner-approval request — deletes nothing
 * until the Owner approves + executes it in /approvals (delete_attendance_record).
 */
export async function requestAttendanceDeletionAction(
  recordId: string,
  label: string,
  reason: string,
): Promise<RequestDeletionResult> {
  const result = await requestOwnerDeletion(
    'attendance_delete',
    'attendance_record',
    recordId,
    `attendance record (${label})`,
    reason,
  );
  if (result.ok) revalidatePath('/admin/attendance');
  return result;
}

/**
 * Set (or clear) a staff member's hourly rate. Owner-only — the domain module
 * re-checks and RLS is the real boundary. Transport only.
 */
export async function setHourlyRateAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  if (!staffProfileId) {
    return { error: 'Missing staff member.', success: null };
  }
  const result = await setSalaryRate(
    staffProfileId,
    text(formData, 'rate'),
    text(formData, 'frequency'),
    text(formData, 'effectiveDate'),
  );
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  revalidatePath('/admin/payroll');
  return { error: null, success: result.message };
}
