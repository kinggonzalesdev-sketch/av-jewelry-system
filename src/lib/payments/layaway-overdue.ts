/**
 * Layaway near-overdue monitoring (Owner 2026-08-29).
 *
 * AUTHORITATIVE business rule (Owner-confirmed): the overdue date is
 *   DATE PURCHASED + 3 CALENDAR MONTHS
 * — NEVER "+ 90 days", and NEVER the stored `next_due_date` (which the Owner corrected:
 * for 368 of 661 active accounts it does NOT equal purchase + 3 months). All arithmetic is
 * CALENDAR-DAY and timezone-safe: dates are handled date-only and anchored at UTC midnight,
 * so "27 days left" can never drift to "26" during the afternoon. Framework-free + pure so it
 * is unit-tested and shared by the table (per-row badge / row highlight / Overdue column). The
 * DB mirrors the SAME rule for the global "Near Overdue (30 Days)" count card
 * (see migration layaway_near_overdue_count) so the card and the highlighted rows always agree.
 *
 * The existing DB overdue business logic (layaway_is_overdue / the Overdue section filter /
 * forfeiture) is intentionally NOT changed by this module — this is visibility only.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Add `n` calendar months to a 'YYYY-MM-DD' date, clamping to the target month's last day
 * (Aug 31 + 3 months → Nov 30; Nov 30 + 3 months → Feb 28/29). Identical to Postgres
 * `date + interval 'N months'`, so the client badges and the SQL count agree exactly.
 */
export function addCalendarMonths(ymd: string, n: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? '').slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const monthIndex = mo - 1 + n; // 0-based, may exceed 11 / go negative
  const ty = y + Math.floor(monthIndex / 12);
  const tm = ((monthIndex % 12) + 12) % 12; // 0..11
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${ty}-${pad2(tm + 1)}-${pad2(day)}`;
}

/** Canonical Layaway overdue date = date purchased + 3 calendar months. null when no purchase date. */
export function layawayOverdueDate(
  datePurchased: string | null | undefined,
): string | null {
  if (!datePurchased) return null;
  return addCalendarMonths(datePurchased.slice(0, 10), 3);
}

/**
 * Whole calendar days from `today` to `target` (both 'YYYY-MM-DD'): +N = days remaining,
 * 0 = due today, -N = overdue. Both anchored at UTC midnight of the DATE ONLY, so the result
 * is exact calendar days regardless of the viewer's clock time or timezone.
 */
export function daysBetween(today: string, target: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(today ?? '');
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(target ?? '');
  if (!a || !b) return null;
  const ta = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const tb = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((tb - ta) / 86_400_000);
}

export type LayawayOverdueState = 'normal' | 'near' | 'due_today' | 'overdue';

export type LayawayCountdown = {
  /** date purchased + 3 months ('YYYY-MM-DD'); '' only for a derived-overdue row with no purchase date. */
  overdueDate: string;
  /** Signed calendar days: >0 remaining, 0 due today, <0 overdue. */
  daysLeft: number;
  state: LayawayOverdueState;
};

/** Closed accounts — never a live countdown (completed / forfeited / cancelled). */
const TERMINAL = new Set(['completed', 'forfeited', 'cancelled']);
/** Order-workflow statuses the DB already computed as past due (kept authoritative). */
const DERIVED_OVERDUE = new Set(['overdue', 'grace_period', 'forfeiture_eligible']);

/** True when the account still owes money (a paid-off active account is never "near overdue"). */
export function owesMoney(balance: string | null | undefined): boolean {
  if (balance === null || balance === undefined) return false;
  const n = Number(String(balance).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0.005; // more than half a centavo
}

/**
 * The per-row countdown, or null when NO countdown should show — a TERMINAL account
 * (completed / forfeited / cancelled), a fully-paid account, or a row with no purchase date.
 * `today` must be a 'YYYY-MM-DD' business date (Asia/Manila) so it matches the DB count card.
 */
export function layawayRowCountdown(
  row: { status: string; balance: string | null; datePurchased: string | null },
  today: string,
): LayawayCountdown | null {
  const status = (row.status ?? '').trim().toLowerCase();
  if (TERMINAL.has(status)) return null;
  if (!owesMoney(row.balance)) return null;

  const overdueDate = layawayOverdueDate(row.datePurchased);
  if (!overdueDate) {
    // A row the order workflow already flagged past due stays overdue even without a purchase date.
    return DERIVED_OVERDUE.has(status)
      ? { overdueDate: '', daysLeft: -1, state: 'overdue' }
      : null;
  }

  const days = daysBetween(today, overdueDate);
  if (days === null) return null;

  const state: LayawayOverdueState =
    days < 0 ? 'overdue' : days === 0 ? 'due_today' : days <= 30 ? 'near' : 'normal';
  return { overdueDate, daysLeft: days, state };
}

/**
 * The customer-name badge text: "27 days left", "1 day left", "Due today", "3 days overdue",
 * "1 day overdue". Returns '' for a normal (>30 days) row, which shows no badge.
 */
export function countdownBadgeLabel(cd: LayawayCountdown): string {
  switch (cd.state) {
    case 'normal':
      return '';
    case 'due_today':
      return 'Due today';
    case 'near':
      return `${cd.daysLeft} day${cd.daysLeft === 1 ? '' : 's'} left`;
    case 'overdue': {
      const over = Math.abs(cd.daysLeft);
      return `${over} day${over === 1 ? '' : 's'} overdue`;
    }
  }
}

/** Compact OVERDUE-column label: 'No' | 'Near Overdue' | 'Due Today' | 'Overdue' ('—' when no countdown). */
export function overdueColumnLabel(cd: LayawayCountdown | null): string {
  if (!cd) return '—';
  switch (cd.state) {
    case 'normal':
      return 'No';
    case 'near':
      return 'Near Overdue';
    case 'due_today':
      return 'Due Today';
    case 'overdue':
      return 'Overdue';
  }
}
