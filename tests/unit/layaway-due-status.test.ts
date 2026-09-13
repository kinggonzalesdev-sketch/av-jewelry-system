import { describe, expect, it } from 'vitest';

import {
  countdownBadgeLabel,
  layawayOverdueDate,
  layawayRowCountdown,
  overdueColumnLabel,
} from '@/lib/payments/layaway-overdue';

/**
 * Workflow status and DUE status are separate concepts (Owner 2026-09-13).
 *
 * The Owner reported that "Financer" accounts lost their due-state display. There is no Financer
 * STATUS in this system — the financer lives in Remarks / Financer, a text column the due rule never
 * reads — so these tests pin the property that actually matters: an account's due state depends
 * only on {status, balance, date purchased}. A financer name, in whatever spelling, changes nothing.
 *
 * Canonical rule (unchanged): Due Date = Date Purchased + 3 CALENDAR MONTHS. Near Due = 1–30 days.
 */

const TODAY = '2026-10-10';

/** A live-shaped active ledger row with a financer in Remarks — exactly the kind that was reported. */
function financerRow(datePurchased: string, balance = '12500.00') {
  return { status: 'active', balance, datePurchased, remarks: 'NEZ' };
}

describe('Financer accounts run through the same due calculation', () => {
  it('TEST 1: Financer + far from due → On Track', () => {
    // Purchased Sep 1 → due Dec 1; 52 days away on Oct 10.
    const cd = layawayRowCountdown(financerRow('2026-09-01'), TODAY);
    expect(cd).toMatchObject({ overdueDate: '2026-12-01', state: 'normal', daysLeft: 52 });
    expect(overdueColumnLabel(cd)).toBe('No');
  });

  it('TEST 2: Financer + Near Due → Near Due, 5 days remaining (the spec example)', () => {
    // due_date = 2026-10-15, today = 2026-10-10 → "Financer · Near Due · 5 days left"
    const cd = layawayRowCountdown(financerRow('2026-07-15'), TODAY);
    expect(cd).toMatchObject({ overdueDate: '2026-10-15', state: 'near', daysLeft: 5 });
    expect(overdueColumnLabel(cd)).toBe('Near Overdue');
    expect(countdownBadgeLabel(cd!)).toBe('5 days left');
  });

  it('TEST 3: Financer + Due Today → Due Today', () => {
    const cd = layawayRowCountdown(financerRow('2026-07-10'), TODAY);
    expect(cd).toMatchObject({ overdueDate: '2026-10-10', state: 'due_today', daysLeft: 0 });
    expect(overdueColumnLabel(cd)).toBe('Due Today');
    expect(countdownBadgeLabel(cd!)).toBe('Due today');
  });

  it('TEST 4: Financer + Overdue → Overdue, 3 days overdue (the spec example)', () => {
    // due_date = 2026-10-15, today = 2026-10-18 → "Financer · Overdue · 3 days overdue"
    const cd = layawayRowCountdown(financerRow('2026-07-15'), '2026-10-18');
    expect(cd).toMatchObject({ overdueDate: '2026-10-15', state: 'overdue', daysLeft: -3 });
    expect(overdueColumnLabel(cd)).toBe('Overdue');
    expect(countdownBadgeLabel(cd!)).toBe('3 days overdue');
  });

  it('the financer name is irrelevant to the result — only status, balance and date count', () => {
    const base = { status: 'active', balance: '500.00', datePurchased: '2026-07-15' };
    const spellings = ['NEZ', 'Nez', 'TESS', 'MANUEL', 'JULIE ANN', 'OK', '', null];
    const results = spellings.map((remarks) =>
      layawayRowCountdown({ ...base, ...(remarks === null ? {} : { remarks }) }, TODAY),
    );
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]?.state).toBe('near');
  });
});

describe('TEST 5: terminal / settled accounts show no due warning', () => {
  it.each(['completed', 'cancelled', 'forfeited'])('%s → no countdown', (status) => {
    // Even with a balance and a due date in the past, a closed account is closed.
    expect(
      layawayRowCountdown({ status, balance: '9999.00', datePurchased: '2025-01-01' }, TODAY),
    ).toBeNull();
  });

  it('a fully paid active account owes nothing → no countdown', () => {
    expect(layawayRowCountdown(financerRow('2025-01-01', '0.00'), TODAY)).toBeNull();
    expect(layawayRowCountdown(financerRow('2025-01-01', '0.004'), TODAY)).toBeNull();
  });

  it('an account still owing money but with no purchase date has no date to judge by', () => {
    expect(
      layawayRowCountdown({ status: 'active', balance: '100.00', datePurchased: null }, TODAY),
    ).toBeNull();
  });
});

describe('canonical due date is + 3 CALENDAR MONTHS, never + 90 days', () => {
  it('adds months and clamps to month end', () => {
    expect(layawayOverdueDate('2026-08-31')).toBe('2026-11-30'); // +90 days would be 2026-11-29
    expect(layawayOverdueDate('2026-11-30')).toBe('2027-02-28');
    expect(layawayOverdueDate('2026-01-15')).toBe('2026-04-15'); // +90 days would be 2026-04-15 too — coincidence
    expect(layawayOverdueDate('2026-03-01')).toBe('2026-06-01'); // +90 days would be 2026-05-30
  });
});

describe('near-due threshold is 30 days, at the boundary', () => {
  it('30 days out is near; 31 days out is on track', () => {
    // Due 2026-11-09 → 30 days from 2026-10-10.
    expect(layawayRowCountdown(financerRow('2026-08-09'), TODAY)?.state).toBe('near');
    // Due 2026-11-10 → 31 days.
    expect(layawayRowCountdown(financerRow('2026-08-10'), TODAY)?.state).toBe('normal');
  });
});
