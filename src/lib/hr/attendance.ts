import 'server-only';

import { ATTACHMENTS_BUCKET } from '@/lib/attachments/service';
import { recordAuditEvent } from '@/lib/audit/log';
import {
  AuthorizationError,
  requireActiveStaff,
  requireOwnerOrAdmin,
} from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { isAttendanceGatingActive, verifyDeviceCookie } from '@/lib/hr/devices';

/**
 * Device gate: once the Owner has registered a shop phone, only that device (its
 * httpOnly cookie token) may clock in/out. Before any device is registered this is
 * a no-op — clock-in behaves exactly as before, so nobody is locked out. A blocked
 * attempt from an unregistered device is refused AND written to the audit log.
 */
async function requireApprovedDevice(
  staffProfileId: string,
  event: 'clock_in' | 'clock_out',
): Promise<{ ok: true; deviceId: string | null } | { ok: false; error: string }> {
  if (!(await isAttendanceGatingActive())) return { ok: true, deviceId: null };
  const deviceId = await verifyDeviceCookie();
  if (deviceId) return { ok: true, deviceId };

  await recordAuditEvent({
    action: 'attendance.blocked_device',
    entityType: 'attendance_record',
    entityId: staffProfileId,
    outcome: 'denied',
    reason: `Blocked ${event}: this device is not the approved shop phone.`,
  });
  return {
    ok: false,
    error:
      'This device is not the approved shop phone. Clock in/out from the registered device.',
  };
}

/**
 * HR: attendance (Bible §F). A staff member clocks in and out; RLS ensures a
 * member only ever sees/writes their OWN records, while the Owner sees all.
 * Attendance is never deleted, and payroll is DERIVED from it (report_payroll),
 * never hand-entered.
 */

export type AttendanceRow = {
  id: string;
  staffProfileId: string;
  staffName: string | null;
  workDate: string;
  timeIn: string;
  timeOut: string | null;
  note: string | null;
  /** True when the session started at/after 10 PM Asia/Manila (decided in SQL). */
  isOvertime: boolean;
  /** Flat overtime pay as an authoritative string (numeric in SQL), e.g. "300.00". */
  overtimeAmount: string;
};

export type ClockResult =
  | {
      ok: true;
      message: string;
      /** Present on clock-IN only — the new attendance record (for the selfie). */
      recordId?: string;
      isOvertime?: boolean;
      overtimeAmount?: string;
    }
  | { ok: false; error: string };

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

/** One active team member the kiosk can clock in/out (name + role only). */
export type ClockStaff = { id: string; fullName: string; roleKey: string };

/**
 * The active-staff roster for the kiosk "Select who is signing in" dropdown.
 * Available to any hr_attendance holder (not just the Owner) via a permission-scoped
 * SECURITY DEFINER function — the page's owner-only listTeamMembers read used to hide
 * the kiosk from a granted staff/admin. Returns name + role only (no PII).
 */
export async function listClockStaff(): Promise<ClockStaff[]> {
  const supabase = await createClient();
  const res = (await supabase.rpc('list_clock_staff')) as {
    data: Array<{ id: string; full_name: string; role_key: string }> | null;
    error: { message: string } | null;
  };
  if (res.error || !res.data) return [];
  return res.data.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    roleKey: r.role_key,
  }));
}

/** Staff id → the ISO time of their current OPEN session (clocked in, not out). */
export async function listOpenSessions(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendance_records')
    .select('staff_profile_id, time_in')
    .is('time_out', null);
  const map: Record<string, string> = {};
  for (const r of (data ?? []) as Array<{ staff_profile_id: string; time_in: string }>) {
    map[r.staff_profile_id] = r.time_in;
  }
  return map;
}

/**
 * Staff id → the ISO time of their MOST RECENT clock-out TODAY (Manila). Drives the
 * "Continue Duty" state: a staff member who has already clocked out today (and has no
 * open session) can resume with a NEW work session on the SAME attendance day, rather
 * than being offered a plain Clock In. RLS-scoped exactly like listOpenSessions.
 */
export async function listLastClockOutToday(): Promise<Record<string, string>> {
  const supabase = await createClient();
  // "Today" in the shop's timezone, matching how work_date is read elsewhere.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const { data } = await supabase
    .from('attendance_records')
    .select('staff_profile_id, time_out')
    .eq('work_date', today)
    .not('time_out', 'is', null)
    .order('time_out', { ascending: true });
  const map: Record<string, string> = {};
  // Ascending order → the last write for each staff is their most recent clock-out.
  for (const r of (data ?? []) as Array<{ staff_profile_id: string; time_out: string }>) {
    map[r.staff_profile_id] = r.time_out;
  }
  return map;
}

/**
 * Kiosk clock-IN for a SELECTED team member (shop-device model). The operator must
 * be active staff; the device gate + the DEFINER function enforce the shop-phone
 * rule, active-target rule, and one-open-session rule. The selfie is attached to
 * the returned record by the caller.
 */
export async function kioskClockIn(
  staffProfileId: string,
  note: string | null,
): Promise<ClockResult> {
  await requireActiveStaff();
  if (!staffProfileId) return { ok: false, error: 'Select a team member first.' };

  const device = await requireApprovedDevice(staffProfileId, 'clock_in');
  if (!device.ok) return { ok: false, error: device.error };

  const supabase = await createClient();
  const res = (await supabase.rpc('kiosk_clock_in', {
    p_staff_id: staffProfileId,
    p_device_id: device.deviceId,
    p_note: note?.trim() || null,
  })) as { data: string | null; error: { message: string } | null };
  if (res.error || !res.data) {
    return {
      ok: false,
      error:
        res.error?.message.replace(/^ERROR:\s*/i, '').trim() ?? 'Could not clock in.',
    };
  }

  const recordId = res.data;
  // Best-effort read of what SQL decided about overtime (visible to the Owner).
  const { data: rec } = await supabase
    .from('attendance_records')
    .select('is_overtime, overtime_amount')
    .eq('id', recordId)
    .maybeSingle();
  const isOvertime = rec?.is_overtime === true;
  const overtimeAmount = String((rec?.overtime_amount as string | number | null) ?? '0');

  await recordAuditEvent({
    action: 'attendance.clock_in',
    entityType: 'attendance_record',
    entityId: recordId,
    context: {
      for_staff: staffProfileId,
      ...(isOvertime ? { overtime_amount: overtimeAmount } : {}),
    },
  });

  return {
    ok: true,
    message: isOvertime
      ? `Clocked in. Overtime — ₱${overtimeAmount} was added (clock-in at/after 10 PM).`
      : 'Clocked in.',
    recordId,
    isOvertime,
    overtimeAmount,
  };
}

/** Kiosk clock-OUT for a SELECTED team member. */
export async function kioskClockOut(staffProfileId: string): Promise<ClockResult> {
  await requireActiveStaff();
  if (!staffProfileId) return { ok: false, error: 'Select a team member first.' };

  const device = await requireApprovedDevice(staffProfileId, 'clock_out');
  if (!device.ok) return { ok: false, error: device.error };

  const supabase = await createClient();
  const res = (await supabase.rpc('kiosk_clock_out', {
    p_staff_id: staffProfileId,
  })) as { data: string | null; error: { message: string } | null };
  if (res.error || !res.data) {
    return {
      ok: false,
      error:
        res.error?.message.replace(/^ERROR:\s*/i, '').trim() ?? 'Could not clock out.',
    };
  }

  const recordId = res.data;
  await recordAuditEvent({
    action: 'attendance.clock_out',
    entityType: 'attendance_record',
    entityId: recordId,
    context: { for_staff: staffProfileId },
  });
  return { ok: true, message: 'Clocked out.', recordId };
}

/** True when the caller currently has an open session (clocked in, not out). */
export async function getOpenSession(): Promise<{ open: boolean; since: string | null }> {
  const staff = await requireActiveStaff();
  const supabase = await createClient();
  const { data } = await supabase
    .from('attendance_records')
    .select('time_in')
    .eq('staff_profile_id', staff.staffProfileId)
    .is('time_out', null)
    .maybeSingle();
  return { open: Boolean(data), since: (data?.time_in as string | null) ?? null };
}

export async function clockIn(note: string | null): Promise<ClockResult> {
  const staff = await requireActiveStaff();

  // Owner-only (Owner request): only the Owner may use the time clock. UI hiding
  // is not the control — this is the real server boundary.
  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Owner can clock in.' };
  }

  const device = await requireApprovedDevice(staff.staffProfileId, 'clock_in');
  if (!device.ok) return { ok: false, error: device.error };

  const supabase = await createClient();

  // Overtime is decided by the database trigger from the real clock-in time — the
  // insert sends no overtime flag, and reads back what SQL decided.
  const { data, error } = await supabase
    .from('attendance_records')
    .insert({
      staff_profile_id: staff.staffProfileId,
      note: note?.trim() || null,
      device_id: device.deviceId,
    })
    .select('id, is_overtime, overtime_amount')
    .single();

  if (error || !data) {
    // 23505 = the "one open session" unique index: already clocked in.
    if (error?.code === '23505') {
      return { ok: false, error: 'You are already clocked in. Clock out first.' };
    }
    return { ok: false, error: 'Could not clock in.' };
  }

  const isOvertime = data.is_overtime === true;
  const overtimeAmount = String(data.overtime_amount as string | number);

  await recordAuditEvent({
    action: 'attendance.clock_in',
    entityType: 'attendance_record',
    entityId: data.id as string,
    ...(isOvertime ? { context: { overtime_amount: overtimeAmount } } : {}),
  });
  return {
    ok: true,
    message: isOvertime
      ? `Clocked in. Overtime — ₱${overtimeAmount} was added (clock-in at/after 10 PM).`
      : 'Clocked in.',
    recordId: data.id as string,
    isOvertime,
    overtimeAmount,
  };
}

export async function clockOut(): Promise<ClockResult> {
  const staff = await requireActiveStaff();

  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Owner can clock out.' };
  }

  const device = await requireApprovedDevice(staff.staffProfileId, 'clock_out');
  if (!device.ok) return { ok: false, error: device.error };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('attendance_records')
    .update({ time_out: new Date().toISOString() })
    .eq('staff_profile_id', staff.staffProfileId)
    .is('time_out', null)
    .select('id');

  if (error) return { ok: false, error: 'Could not clock out.' };
  if (!data || data.length === 0) {
    return { ok: false, error: 'You are not clocked in.' };
  }

  const recordId = data[0]?.id as string;

  await recordAuditEvent({
    action: 'attendance.clock_out',
    entityType: 'attendance_record',
    entityId: recordId,
  });
  // recordId lets the client attach the clock-out selfie to the same session.
  return { ok: true, message: 'Clocked out.', recordId };
}

/**
 * Permanently delete ONE attendance record — Owner or Selected Admin only. The
 * database function re-checks the role and removes the row; payroll is DERIVED
 * from attendance (report_payroll), so it recomputes on the next read. This is
 * irreversible. Any loose clock-in/out selfie stays as orphaned storage — it has
 * no FK and is harmless.
 */
export async function deleteAttendanceRecord(
  recordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'attendance.delete',
        entityType: 'attendance_record',
        entityId: recordId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_attendance_record', {
    p_record_id: recordId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'attendance.delete',
      entityType: 'attendance_record',
      entityId: recordId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'attendance.delete',
    entityType: 'attendance_record',
    entityId: recordId,
    context: { permanent: true },
  });
  return { ok: true };
}

/** Clock-in / clock-out selfie URLs for one attendance record. Each is a
 *  short-lived signed URL (5 min) minted with a download disposition, so it both
 *  renders in an <img> and saves to the browser's Downloads folder when clicked. */
export type AttendanceSelfies = Record<
  string,
  { inUrl: string | null; outUrl: string | null }
>;

/**
 * Clock-in/out selfies for the attendance the caller may see (RLS-scoped exactly
 * like the records: own, or all for the Owner). Read-only. Returns a map keyed by
 * attendance record id; the in/out selfie is told apart by the stored file name.
 *
 * The bytes never leave the private bucket — only a short-lived signed URL does,
 * and it is minted per read (never persisted). A failure to sign one selfie leaves
 * the rest intact.
 */
export async function listAttendanceSelfies(): Promise<AttendanceSelfies> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attachments')
    .select('related_entity_id, file_name, storage_path')
    .eq('related_entity_type', 'attendance_record')
    .order('uploaded_at', { ascending: true });

  if (error || !data) return {};

  const rows = data as Array<{
    related_entity_id: string;
    file_name: string | null;
    storage_path: string;
  }>;

  const out: AttendanceSelfies = {};
  await Promise.all(
    rows.map(async (r) => {
      const signed = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(r.storage_path, 300, {
          download: r.file_name ?? 'attendance-selfie.jpg',
        })
        .then((res) => res.data?.signedUrl ?? null)
        .catch(() => null);

      const entry = out[r.related_entity_id] ?? { inUrl: null, outUrl: null };
      if ((r.file_name ?? '').includes('clock-out')) entry.outUrl = signed;
      else entry.inUrl = signed;
      out[r.related_entity_id] = entry;
    }),
  );

  return out;
}

/**
 * Signed selfie URLs for a BOUNDED set of attendance records — used to LAZY-load only the
 * one day a reviewer actually opens, instead of minting a signed URL for EVERY selfie ever
 * on page load (~2 Storage round-trips per record over ALL history — the Review Attendance
 * page's main delay). RLS still scopes what the caller may read. Empty input → {}.
 */
export async function listAttendanceSelfiesFor(
  recordIds: string[],
): Promise<AttendanceSelfies> {
  const ids = [...new Set(recordIds.filter((id) => Boolean(id?.trim())))];
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attachments')
    .select('related_entity_id, file_name, storage_path')
    .eq('related_entity_type', 'attendance_record')
    .in('related_entity_id', ids)
    .order('uploaded_at', { ascending: true });

  if (error || !data) return {};

  const rows = data as Array<{
    related_entity_id: string;
    file_name: string | null;
    storage_path: string;
  }>;

  const out: AttendanceSelfies = {};
  await Promise.all(
    rows.map(async (r) => {
      const signed = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(r.storage_path, 300, {
          download: r.file_name ?? 'attendance-selfie.jpg',
        })
        .then((res) => res.data?.signedUrl ?? null)
        .catch(() => null);

      const entry = out[r.related_entity_id] ?? { inUrl: null, outUrl: null };
      if ((r.file_name ?? '').includes('clock-out')) entry.outUrl = signed;
      else entry.inUrl = signed;
      out[r.related_entity_id] = entry;
    }),
  );

  return out;
}

/**
 * Attendance rows the caller may see (RLS: own rows, or all for the Owner).
 * Newest first.
 */
export async function listAttendance(limit = 100): Promise<AttendanceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attendance_records')
    .select(
      'id, staff_profile_id, work_date, time_in, time_out, note, is_overtime, overtime_amount, staff:staff_profiles!staff_profile_id ( full_name )',
    )
    .order('time_in', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => {
    const staff = one<{ full_name: string }>(r.staff);
    return {
      id: r.id as string,
      staffProfileId: r.staff_profile_id as string,
      staffName: staff?.full_name ?? null,
      workDate: r.work_date as string,
      timeIn: r.time_in as string,
      timeOut: (r.time_out as string | null) ?? null,
      note: (r.note as string | null) ?? null,
      isOvertime: r.is_overtime === true,
      overtimeAmount: String((r.overtime_amount as string | number | null) ?? '0'),
    };
  });
}
