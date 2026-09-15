/**
 * Business-date helpers for the shop's day (Asia/Manila, UTC+8, no daylight saving).
 *
 * The shop's records are bucketed by the MANILA calendar day. Deriving "today" with
 * `new Date().toISOString().slice(0, 10)` gives the UTC date instead, which is still
 * YESTERDAY between 00:00 and 08:00 in Manila; and `toISOString()` of a local-midnight
 * Date (`new Date(y, m, 1)`) on a Manila device lands on the previous UTC day, so a
 * "first of the month" came out as the last day of the previous month.
 *
 * PURE and client-safe (no server-only imports), so pages, server actions and client
 * components share one definition. Same technique as `shopToday` / `addDays` in
 * `lib/hr/attendance-paging.ts` (Intl with the `en-CA` locale, which formats as
 * YYYY-MM-DD, plus timezone-free UTC calendar arithmetic).
 */

export const MANILA_TZ = 'Asia/Manila';

/** Today's date in Manila, as YYYY-MM-DD. */
export function manilaToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
}

/** The first day of the current Manila month, as YYYY-MM-DD. */
export function manilaMonthStart(now: Date = new Date()): string {
  return `${manilaToday(now).slice(0, 7)}-01`;
}

/** Calendar arithmetic on a YYYY-MM-DD string (timezone-free); `n` may be negative. */
export function manilaAddDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
