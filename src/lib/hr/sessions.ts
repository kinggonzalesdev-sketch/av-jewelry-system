import type { AttendanceRow } from '@/lib/hr/attendance';
import { durationHours } from '@/lib/hr/format';

/**
 * Continue Duty — grouping flat attendance rows into ONE record per (staff, day).
 *
 * Each `attendance_records` row is a WORK SESSION (the DB already allows several per
 * day + enforces one open session at a time). A "daily attendance record" is the
 * virtual grouping of the rows sharing a staff member and work_date. This helper is
 * PURE and unit-tested, and it is the single source of the daily total:
 *
 *   Total worked = SUM of each COMPLETED session's (clock_out − clock_in)
 *
 * never final-clock-out minus first-clock-in — so an off-duty gap between sessions
 * is NEVER counted. This mirrors exactly how the database's report_payroll already
 * sums hours, so the on-screen total and payroll agree.
 */

export type AttendanceSession = {
  row: AttendanceRow;
  /** 1-based order by clock-in time. */
  sessionNumber: number;
  /** True for the 2nd+ session of the day — i.e. a Continued Duty session. */
  continued: boolean;
  /** Completed session length in hours, or null while still open. */
  durationHrs: number | null;
};

/** An off-duty gap between one session's clock-out and the next session's clock-in. */
export type OffDutyGap = { from: string; to: string; hours: number };

export type AttendanceDay = {
  key: string;
  staffProfileId: string;
  staffName: string | null;
  workDate: string;
  /** Sessions ordered by clock-in time (ascending). */
  sessions: AttendanceSession[];
  sessionCount: number;
  firstIn: string;
  /** The last session's clock-out, or null when a session is still open. */
  finalOut: string | null;
  hasOpen: boolean;
  /** SUM of completed session durations (gaps excluded). Hours, 2 dp. */
  totalHours: number;
  gaps: OffDutyGap[];
  /** True when any session of the day is an overtime (night) session. */
  isOvertime: boolean;
  /** Sum of the day's session overtime bonuses, as a money STRING (no float). */
  overtimeAmount: string;
};

/** Sum money strings in exact integer centavos — never a JS float. */
function sumMoney(values: string[]): string {
  let cents = 0n;
  for (const v of values) {
    const [w, f = ''] = (v || '0').split('.');
    cents += BigInt(w || '0') * 100n + BigInt((f + '00').slice(0, 2) || '0');
  }
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function groupAttendanceDays(rows: AttendanceRow[]): AttendanceDay[] {
  const byKey = new Map<string, AttendanceRow[]>();
  for (const r of rows) {
    const key = `${r.staffProfileId}__${r.workDate}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const days: AttendanceDay[] = [];
  for (const [key, list] of byKey) {
    // Order sessions by clock-in time so "Session 1" is the first of the day.
    const ordered = [...list].sort((a, b) => a.timeIn.localeCompare(b.timeIn));
    const sessions: AttendanceSession[] = ordered.map((row, i) => ({
      row,
      sessionNumber: i + 1,
      continued: i > 0,
      durationHrs: durationHours(row.timeIn, row.timeOut),
    }));

    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    if (!first || !last) continue;

    const hasOpen = ordered.some((r) => r.timeOut === null);
    const totalHours =
      Math.round(sessions.reduce((sum, s) => sum + (s.durationHrs ?? 0), 0) * 100) / 100;

    // Off-duty gaps sit BETWEEN a session's clock-out and the next session's clock-in.
    const gaps: OffDutyGap[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const out = ordered[i]?.timeOut ?? null;
      const nextIn = ordered[i + 1]?.timeIn ?? null;
      if (out && nextIn) {
        const h = durationHours(out, nextIn);
        if (h && h > 0) gaps.push({ from: out, to: nextIn, hours: h });
      }
    }

    days.push({
      key,
      staffProfileId: first.staffProfileId,
      staffName: first.staffName,
      workDate: first.workDate,
      sessions,
      sessionCount: sessions.length,
      firstIn: first.timeIn,
      finalOut: hasOpen ? null : (last.timeOut ?? null),
      hasOpen,
      totalHours,
      gaps,
      isOvertime: sessions.some((s) => s.row.isOvertime),
      overtimeAmount: sumMoney(sessions.map((s) => s.row.overtimeAmount)),
    });
  }

  // Newest day first; ties broken by staff name for a stable, readable order.
  days.sort(
    (a, b) =>
      b.workDate.localeCompare(a.workDate) ||
      (a.staffName ?? '').localeCompare(b.staffName ?? ''),
  );
  return days;
}
