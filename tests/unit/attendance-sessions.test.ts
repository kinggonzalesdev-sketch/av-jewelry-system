import { describe, expect, it } from 'vitest';

import type { AttendanceRow } from '@/lib/hr/attendance';
import { groupAttendanceDays } from '@/lib/hr/sessions';

/**
 * Continue Duty — the daily total MUST be the sum of each session's worked time,
 * never final-clock-out minus first-clock-in, so an off-duty gap is never paid.
 * Times are in UTC to keep the assertions timezone-free.
 */

function row(over: Partial<AttendanceRow>): AttendanceRow {
  return {
    id: crypto.randomUUID(),
    staffProfileId: 'staff-1',
    staffName: 'Ana',
    workDate: '2026-08-10',
    timeIn: '2026-08-10T01:00:00.000Z',
    timeOut: '2026-08-10T09:00:00.000Z',
    note: null,
    isOvertime: false,
    overtimeAmount: '0',
    ...over,
  };
}

describe('groupAttendanceDays', () => {
  it('sums session durations and excludes the off-duty gap (10h, not 12h)', () => {
    const rows = [
      row({ timeIn: '2026-08-10T01:00:00Z', timeOut: '2026-08-10T09:00:00Z' }), // 8h
      row({ timeIn: '2026-08-10T11:00:00Z', timeOut: '2026-08-10T13:00:00Z' }), // 2h, after a 2h gap
    ];
    const days = groupAttendanceDays(rows);
    expect(days).toHaveLength(1);
    const d = days[0]!;
    expect(d.sessionCount).toBe(2);
    expect(d.totalHours).toBe(10); // NOT 12 — the 2h gap is off-duty
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]!.hours).toBe(2);
    expect(d.firstIn).toBe('2026-08-10T01:00:00Z');
    expect(d.finalOut).toBe('2026-08-10T13:00:00Z');
    expect(d.hasOpen).toBe(false);
    expect(d.sessions[0]!.continued).toBe(false);
    expect(d.sessions[1]!.continued).toBe(true); // 2nd session = Continued Duty
  });

  it('orders sessions by clock-in even when the rows arrive out of order', () => {
    const rows = [
      row({ timeIn: '2026-08-10T11:00:00Z', timeOut: '2026-08-10T13:00:00Z' }),
      row({ timeIn: '2026-08-10T01:00:00Z', timeOut: '2026-08-10T09:00:00Z' }),
    ];
    const d = groupAttendanceDays(rows)[0]!;
    expect(d.sessions[0]!.row.timeIn).toBe('2026-08-10T01:00:00Z');
    expect(d.sessions[1]!.continued).toBe(true);
  });

  it('keeps different days separate; an open session contributes no total yet', () => {
    const rows = [
      row({
        workDate: '2026-08-10',
        timeIn: '2026-08-10T01:00:00Z',
        timeOut: '2026-08-10T09:00:00Z',
      }),
      row({ workDate: '2026-08-11', timeIn: '2026-08-11T01:00:00Z', timeOut: null }),
    ];
    const days = groupAttendanceDays(rows);
    expect(days).toHaveLength(2);
    const open = days.find((x) => x.workDate === '2026-08-11')!;
    expect(open.hasOpen).toBe(true);
    expect(open.finalOut).toBeNull();
    expect(open.totalHours).toBe(0);
  });

  it('earns the night bonus at most ONCE per day, not per session', () => {
    const rows = [
      row({
        timeIn: '2026-08-10T14:00:00Z',
        timeOut: '2026-08-10T15:00:00Z',
        isOvertime: true,
        overtimeAmount: '300.00',
      }),
      row({
        timeIn: '2026-08-10T16:00:00Z',
        timeOut: '2026-08-10T17:00:00Z',
        isOvertime: true,
        overtimeAmount: '300.00',
      }),
    ];
    const d = groupAttendanceDays(rows)[0]!;
    expect(d.isOvertime).toBe(true);
    expect(d.overtimeAmount).toBe('300.00'); // one bonus, not ₱600
  });
});
