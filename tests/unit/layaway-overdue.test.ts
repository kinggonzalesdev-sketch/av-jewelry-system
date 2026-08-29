import { describe, expect, it } from 'vitest';

import {
  addCalendarMonths,
  countdownBadgeLabel,
  daysBetween,
  layawayOverdueDate,
  layawayRowCountdown,
  overdueColumnLabel,
  owesMoney,
} from '@/lib/payments/layaway-overdue';

/**
 * Owner 2026-08-29 — Layaway near-overdue monitoring. Canonical overdue date = DATE PURCHASED +
 * 3 CALENDAR MONTHS (never +90 days, never the stored next_due_date). Day math must be calendar-day
 * and timezone-safe (no afternoon "27 → 26" drift). Completed/Forfeited show NO active countdown.
 */
describe('addCalendarMonths / layawayOverdueDate — +3 calendar months, end-of-month safe', () => {
  it('Owner examples: purchase + 3 months', () => {
    expect(layawayOverdueDate('2026-08-10')).toBe('2026-11-10'); // Aug 10 → Nov 10
    expect(layawayOverdueDate('2026-07-25')).toBe('2026-10-25'); // Jul 25 → Oct 25
  });

  it('clamps to the end of a shorter target month (never rolls into the next month)', () => {
    expect(addCalendarMonths('2026-08-31', 3)).toBe('2026-11-30'); // Nov has 30 days
    expect(addCalendarMonths('2025-11-30', 3)).toBe('2026-02-28'); // Feb 2026 (non-leap)
    expect(addCalendarMonths('2028-11-30', 3)).toBe('2029-02-28');
  });

  it('crosses the year boundary correctly', () => {
    expect(addCalendarMonths('2026-12-10', 3)).toBe('2027-03-10');
    expect(addCalendarMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('tolerates an ISO timestamp and rejects junk', () => {
    expect(layawayOverdueDate('2026-08-10T09:30:00.000Z')).toBe('2026-11-10');
    expect(layawayOverdueDate(null)).toBeNull();
    expect(layawayOverdueDate('')).toBeNull();
    expect(addCalendarMonths('not-a-date', 3)).toBeNull();
  });
});

describe('daysBetween — exact calendar days (UTC-midnight anchored, no tz drift)', () => {
  it('counts whole calendar days regardless of time-of-day', () => {
    expect(daysBetween('2026-08-29', '2026-09-25')).toBe(27);
    expect(daysBetween('2026-08-15', '2026-08-15')).toBe(0);
    expect(daysBetween('2026-08-16', '2026-08-15')).toBe(-1);
    expect(daysBetween('2026-08-01', '2026-08-15')).toBe(14);
    expect(daysBetween('2026-07-15', '2026-08-15')).toBe(31);
  });
});

describe('owesMoney', () => {
  it('true only when a positive balance remains', () => {
    expect(owesMoney('12345.00')).toBe(true);
    expect(owesMoney('0.00')).toBe(false);
    expect(owesMoney('0')).toBe(false);
    expect(owesMoney(null)).toBe(false);
    expect(owesMoney('1,250.50')).toBe(true);
  });
});

// overdueDate = 2026-08-15 for every case (purchase 2026-05-15 + 3 months).
const ACTIVE = { status: 'active', balance: '5000.00', datePurchased: '2026-05-15' };
const countdownOn = (today: string) => layawayRowCountdown(ACTIVE, today);

describe('layawayRowCountdown — near-overdue business rule', () => {
  it('31 days remaining → NORMAL (no warning)', () => {
    const cd = countdownOn('2026-07-15');
    expect(cd?.state).toBe('normal');
    expect(countdownBadgeLabel(cd!)).toBe(''); // no badge
    expect(overdueColumnLabel(cd)).toBe('No');
  });

  it('30 days remaining → NEAR OVERDUE "30 days left"', () => {
    const cd = countdownOn('2026-07-16');
    expect(cd?.state).toBe('near');
    expect(cd?.daysLeft).toBe(30);
    expect(countdownBadgeLabel(cd!)).toBe('30 days left');
    expect(overdueColumnLabel(cd)).toBe('Near Overdue');
  });

  it('27 / 14 days remaining → NEAR OVERDUE', () => {
    expect(countdownBadgeLabel(countdownOn('2026-07-19')!)).toBe('27 days left');
    expect(countdownBadgeLabel(countdownOn('2026-08-01')!)).toBe('14 days left');
  });

  it('1 day remaining → NEAR OVERDUE "1 day left" (singular)', () => {
    const cd = countdownOn('2026-08-14');
    expect(cd?.state).toBe('near');
    expect(countdownBadgeLabel(cd!)).toBe('1 day left');
  });

  it('0 days remaining → DUE TODAY (never mis-read as overdue)', () => {
    const cd = countdownOn('2026-08-15');
    expect(cd?.state).toBe('due_today');
    expect(countdownBadgeLabel(cd!)).toBe('Due today');
    expect(overdueColumnLabel(cd)).toBe('Due Today');
  });

  it('1 / 3 days past → OVERDUE', () => {
    const one = countdownOn('2026-08-16');
    expect(one?.state).toBe('overdue');
    expect(countdownBadgeLabel(one!)).toBe('1 day overdue');
    expect(overdueColumnLabel(one)).toBe('Overdue');
    expect(countdownBadgeLabel(countdownOn('2026-08-18')!)).toBe('3 days overdue');
  });
});

describe('layawayRowCountdown — completed / forfeited / paid never show a live countdown', () => {
  const today = '2026-08-14'; // would be "1 day left" if the account were active + owing
  it('completed → null', () => {
    expect(layawayRowCountdown({ ...ACTIVE, status: 'completed' }, today)).toBeNull();
  });
  it('forfeited → null', () => {
    expect(layawayRowCountdown({ ...ACTIVE, status: 'forfeited' }, today)).toBeNull();
  });
  it('cancelled → null', () => {
    expect(layawayRowCountdown({ ...ACTIVE, status: 'cancelled' }, today)).toBeNull();
  });
  it('fully paid (balance 0) → null', () => {
    expect(layawayRowCountdown({ ...ACTIVE, balance: '0.00' }, today)).toBeNull();
  });
  it('no purchase date → null', () => {
    expect(layawayRowCountdown({ ...ACTIVE, datePurchased: null }, today)).toBeNull();
  });
});

describe('overdueColumnLabel — compact states', () => {
  it('— when there is no countdown', () => {
    expect(overdueColumnLabel(null)).toBe('—');
  });
});
