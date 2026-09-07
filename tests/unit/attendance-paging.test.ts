import { describe, expect, it } from 'vitest';

import type { AttendanceRow } from '@/lib/hr/attendance';
import {
  addDays,
  assembleDayPage,
  matchStaffIds,
  pageCount,
  quickRange,
  rowMatchesFilters,
  shopDayBounds,
  summarizeAttendanceToday,
  type AttendanceFilters,
} from '@/lib/hr/attendance-paging';

/**
 * The pure paging/filter helpers behind the refined Attendance records list (Owner 2026-09-06).
 * These mirror the SQL the server reader runs, and they are what lets a page of SESSION rows be
 * shown as complete DAYS without ever changing a total.
 */

function row(over: Partial<AttendanceRow>): AttendanceRow {
  return {
    id: crypto.randomUUID(),
    staffProfileId: 's1',
    staffName: 'Ana',
    workDate: '2026-09-05',
    timeIn: '2026-09-05T01:00:00.000Z',
    timeOut: '2026-09-05T09:00:00.000Z',
    note: null,
    isOvertime: false,
    overtimeAmount: '0',
    ...over,
  };
}

const ALL: AttendanceFilters = { from: null, to: null, staffIds: null, status: 'all' };

describe('quickRange + addDays (shop timezone)', () => {
  const now = new Date('2026-09-06T02:00:00Z'); // 10:00 AM Manila on the 6th
  it('today is a single shop day', () => {
    expect(quickRange('today', now)).toEqual({ from: '2026-09-06', to: '2026-09-06' });
  });
  it('7d spans six days back through today', () => {
    expect(quickRange('7d', now)).toEqual({ from: '2026-08-31', to: '2026-09-06' });
  });
  it('month starts on the 1st', () => {
    expect(quickRange('month', now)).toEqual({ from: '2026-09-01', to: '2026-09-06' });
  });
  it('addDays crosses month boundaries', () => {
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });
});

describe('shopDayBounds', () => {
  it('brackets a Manila day in +08:00', () => {
    expect(shopDayBounds('2026-09-05', '2026-09-05')).toEqual({
      fromTs: '2026-09-05T00:00:00.000+08:00',
      toTs: '2026-09-05T23:59:59.999+08:00',
    });
  });
  it('is null when unbounded', () => {
    expect(shopDayBounds(null, null)).toEqual({ fromTs: null, toTs: null });
  });
});

describe('rowMatchesFilters', () => {
  it('status open/completed', () => {
    const open = row({ timeOut: null });
    const done = row({ timeOut: '2026-09-05T09:00:00Z' });
    expect(rowMatchesFilters(open, { ...ALL, status: 'open' })).toBe(true);
    expect(rowMatchesFilters(done, { ...ALL, status: 'open' })).toBe(false);
    expect(rowMatchesFilters(done, { ...ALL, status: 'completed' })).toBe(true);
    expect(rowMatchesFilters(open, { ...ALL, status: 'completed' })).toBe(false);
  });
  it('staff filter', () => {
    const r = row({ staffProfileId: 's2' });
    expect(rowMatchesFilters(r, { ...ALL, staffIds: ['s2'] })).toBe(true);
    expect(rowMatchesFilters(r, { ...ALL, staffIds: ['s1'] })).toBe(false);
  });
  it('date range filters on the clock-in time, in Manila bounds', () => {
    // 2026-09-05 00:12 Manila = 2026-09-04T16:12Z — inside a "2026-09-05" range.
    const early = row({ timeIn: '2026-09-04T16:12:00Z', workDate: '2026-09-04' });
    expect(
      rowMatchesFilters(early, { ...ALL, from: '2026-09-05', to: '2026-09-05' }),
    ).toBe(true);
    // A session that started 2026-09-06 09:00 Manila is outside that same range.
    const later = row({ timeIn: '2026-09-06T01:00:00Z' });
    expect(
      rowMatchesFilters(later, { ...ALL, from: '2026-09-05', to: '2026-09-05' }),
    ).toBe(false);
  });
});

describe('assembleDayPage', () => {
  it('renders one day whole even when a session sits in the completion set', () => {
    const s1 = row({
      id: 'a',
      timeIn: '2026-09-05T01:00:00Z',
      timeOut: '2026-09-05T09:00:00Z',
    });
    const s2 = row({
      id: 'b',
      timeIn: '2026-09-05T11:00:00Z',
      timeOut: '2026-09-05T13:00:00Z',
    });
    // Only the newer session is on the page; the older one arrives via completion.
    const days = assembleDayPage([s2], [s1], ALL);
    expect(days).toHaveLength(1);
    expect(days[0]!.sessionCount).toBe(2);
    expect(days[0]!.totalHours).toBe(10); // 8h + 2h, the gap excluded
  });

  it('shows a day exactly once — on the page holding its newest filtered session', () => {
    const s1 = row({
      id: 'a',
      timeIn: '2026-09-05T01:00:00Z',
      timeOut: '2026-09-05T09:00:00Z',
    });
    const s2 = row({
      id: 'b',
      timeIn: '2026-09-05T11:00:00Z',
      timeOut: '2026-09-05T13:00:00Z',
    });
    // The page that holds only the OLDER session must NOT render the day (its anchor is newer).
    expect(assembleDayPage([s1], [s2], ALL)).toHaveLength(0);
    // The page that holds the NEWER session renders it.
    expect(assembleDayPage([s2], [s1], ALL)).toHaveLength(1);
  });

  it('drops a day whose only sessions on this page fail the status filter', () => {
    const done = row({ id: 'a', timeOut: '2026-09-05T09:00:00Z' });
    expect(assembleDayPage([done], [], { ...ALL, status: 'open' })).toHaveLength(0);
  });
});

describe('summarizeAttendanceToday', () => {
  it('counts present, clocked-in-now, and completed today', () => {
    const today = [
      { staffProfileId: 's1' },
      { staffProfileId: 's2' },
      { staffProfileId: 's1' },
    ];
    const open = { s2: '2026-09-06T01:00:00Z' };
    expect(summarizeAttendanceToday(today, open)).toEqual({
      presentToday: 2,
      clockedInNow: 1,
      completedToday: 1, // s1 present and not open; s2 still open
    });
  });
});

describe('matchStaffIds + pageCount', () => {
  const roster = [
    { id: 's1', fullName: 'Lalyn Penaranda' },
    { id: 's2', fullName: 'Grace Villanueva' },
  ];
  it('returns null for empty search (no staff filter)', () => {
    expect(matchStaffIds(roster, '  ')).toBeNull();
  });
  it('matches case-insensitively; no match → [] (an explicit empty result)', () => {
    expect(matchStaffIds(roster, 'lal')).toEqual(['s1']);
    expect(matchStaffIds(roster, 'zzz')).toEqual([]);
  });
  it('pageCount is at least 1', () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});
