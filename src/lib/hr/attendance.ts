import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

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
};

export type ClockResult = { ok: true; message: string } | { ok: false; error: string };

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
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
  const supabase = await createClient();

  const { error } = await supabase.from('attendance_records').insert({
    staff_profile_id: staff.staffProfileId,
    note: note?.trim() || null,
  });

  if (error) {
    // 23505 = the "one open session" unique index: already clocked in.
    if (error.code === '23505') {
      return { ok: false, error: 'You are already clocked in. Clock out first.' };
    }
    return { ok: false, error: 'Could not clock in.' };
  }

  await recordAuditEvent({
    action: 'attendance.clock_in',
    entityType: 'attendance_record',
    entityId: staff.staffProfileId,
  });
  return { ok: true, message: 'Clocked in.' };
}

export async function clockOut(): Promise<ClockResult> {
  const staff = await requireActiveStaff();
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

  await recordAuditEvent({
    action: 'attendance.clock_out',
    entityType: 'attendance_record',
    entityId: staff.staffProfileId,
  });
  return { ok: true, message: 'Clocked out.' };
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
      'id, staff_profile_id, work_date, time_in, time_out, note, staff:staff_profiles!staff_profile_id ( full_name )',
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
    };
  });
}
