import type { AttendanceRow } from '@/lib/hr/attendance';
import { groupAttendanceDays, type AttendanceDay } from '@/lib/hr/sessions';

/**
 * Attendance records — paging, filtering and display helpers (Owner 2026-09-06).
 *
 * PURE and client-safe: no Supabase, no server-only imports. The server reader
 * (`listAttendancePage`) applies the same filters in SQL; these helpers mirror them so a
 * page of SESSION rows can be shown as complete DAYS, and so the pieces are unit-testable.
 * Nothing here changes a stored value or a total — `groupAttendanceDays` remains the single
 * source of the daily total.
 */

export const ATTENDANCE_PAGE_SIZES = [25, 50, 100] as const;
export type AttendancePageSize = (typeof ATTENDANCE_PAGE_SIZES)[number];
export const DEFAULT_ATTENDANCE_PAGE_SIZE: AttendancePageSize = 25;

export type AttendanceStatusFilter = 'all' | 'open' | 'completed';
export type AttendanceQuickRange = 'today' | '7d' | 'month' | 'custom';

/** The filters the records toolbar can set. `staffIds: null` means "all staff". */
export type AttendanceFilters = {
  /** Inclusive shop-date bounds (YYYY-MM-DD, Asia/Manila) applied to the clock-in time. */
  from: string | null;
  to: string | null;
  staffIds: string[] | null;
  status: AttendanceStatusFilter;
};

/** What the server returns for one page of SESSION rows (newest clock-in first). */
export type AttendancePage = {
  rows: AttendanceRow[];
  /** Every session of every (staff, day) touched by `rows` — for whole-day rendering. */
  completion: AttendanceRow[];
  /** Total SESSION rows matching the filters (drives the page count). */
  total: number;
  page: number;
  pageSize: AttendancePageSize;
};

export const SHOP_TZ = 'Asia/Manila';
/** Manila has no daylight saving, so a fixed offset is exact. */
const SHOP_UTC_OFFSET = '+08:00';

/** Today's date (YYYY-MM-DD) in the shop timezone. */
export function shopToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: SHOP_TZ });
}

/** Calendar arithmetic on a YYYY-MM-DD string — timezone-free. */
export function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The date bounds of a quick filter, relative to the shop's "today". */
export function quickRange(
  kind: Exclude<AttendanceQuickRange, 'custom'>,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = shopToday(now);
  if (kind === 'today') return { from: today, to: today };
  if (kind === '7d') return { from: addDays(today, -6), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * Inclusive timestamptz bounds for a shop-date range, for filtering the CLOCK-IN time.
 * Filtering on `time_in` (not the stored `work_date`) means "Today" always shows the
 * sessions that actually started today in Manila.
 */
export function shopDayBounds(
  from: string | null,
  to: string | null,
): { fromTs: string | null; toTs: string | null } {
  return {
    fromTs: from ? `${from}T00:00:00.000${SHOP_UTC_OFFSET}` : null,
    toTs: to ? `${to}T23:59:59.999${SHOP_UTC_OFFSET}` : null,
  };
}

/** Whether a session row satisfies the filters — the same rules the server query applies. */
export function rowMatchesFilters(row: AttendanceRow, f: AttendanceFilters): boolean {
  if (f.status === 'open' && row.timeOut !== null) return false;
  if (f.status === 'completed' && row.timeOut === null) return false;
  if (f.staffIds && !f.staffIds.includes(row.staffProfileId)) return false;
  const { fromTs, toTs } = shopDayBounds(f.from, f.to);
  const t = new Date(row.timeIn).getTime();
  if (fromTs && t < new Date(fromTs).getTime()) return false;
  if (toTs && t > new Date(toTs).getTime()) return false;
  return true;
}

/** The (staff, day) key `groupAttendanceDays` uses. */
export const dayKey = (r: Pick<AttendanceRow, 'staffProfileId' | 'workDate'>): string =>
  `${r.staffProfileId}__${r.workDate}`;

/**
 * Turn one server page of SESSION rows into complete DAYS.
 *
 * `completion` carries every session of every (staff, day) the page touches, so a day whose
 * sessions straddle a page boundary is still rendered whole with the right total. A day is
 * shown on the page that holds its newest FILTERED session (its anchor) — so across pages
 * every day appears exactly once, and totals never depend on where the page break fell.
 */
export function assembleDayPage(
  pageRows: AttendanceRow[],
  completion: AttendanceRow[],
  f: AttendanceFilters,
): AttendanceDay[] {
  const pageIds = new Set(pageRows.map((r) => r.id));
  const keys = new Set(pageRows.map(dayKey));
  const byId = new Map<string, AttendanceRow>();
  for (const r of [...pageRows, ...completion]) byId.set(r.id, r);
  const rows = [...byId.values()].filter((r) => keys.has(dayKey(r)));

  return groupAttendanceDays(rows).filter((day) => {
    const filtered = day.sessions
      .map((s) => s.row)
      .filter((r) => rowMatchesFilters(r, f));
    if (filtered.length === 0) return false;
    const anchor = filtered.reduce((a, b) => (a.timeIn > b.timeIn ? a : b));
    return pageIds.has(anchor.id);
  });
}

export type AttendanceTodaySummary = {
  /** Distinct team members with a session that started today (shop time). */
  presentToday: number;
  /** Distinct team members with an open session right now (any date). */
  clockedInNow: number;
  /** Present today AND not currently clocked in. */
  completedToday: number;
};

/**
 * Compact team summary from data the page already reads. "Needs attention" is deliberately
 * absent: no review/flag state is written to attendance records today, so there is no
 * authoritative definition to count.
 */
export function summarizeAttendanceToday(
  todayRows: ReadonlyArray<Pick<AttendanceRow, 'staffProfileId'>>,
  openSessions: Record<string, string>,
): AttendanceTodaySummary {
  const present = new Set(todayRows.map((r) => r.staffProfileId));
  const open = new Set(Object.keys(openSessions));
  let completedToday = 0;
  for (const id of present) if (!open.has(id)) completedToday += 1;
  return { presentToday: present.size, clockedInNow: open.size, completedToday };
}

/**
 * Roster ids whose name contains the search text (case-insensitive). Empty text → null (no
 * staff filter). No match → [] (the caller shows an empty result without querying).
 */
export function matchStaffIds(
  roster: ReadonlyArray<{ id: string; fullName: string }>,
  query: string,
): string[] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return roster.filter((m) => m.fullName.toLowerCase().includes(q)).map((m) => m.id);
}

/** "Sep 5, 2026" for a YYYY-MM-DD, without any timezone shift. */
export function formatWorkDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "9:04 AM" — the viewer's locale and timezone, as the tables always used. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Hours elapsed since an ISO time — an OPEN session's "Current: 2h 14m". Display only. */
export function elapsedHours(sinceIso: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(sinceIso).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.round((ms / 3_600_000) * 100) / 100 : 0;
}

/** Page arithmetic shared by the toolbar and the pagination footer. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
