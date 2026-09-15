import { describe, expect, it } from 'vitest';

import { addDays, shopToday } from '@/lib/hr/attendance-paging';
import { manilaAddDays, manilaMonthStart, manilaToday } from '@/lib/format/manila-date';

// 23:30 UTC on Sep 15 is 07:30 on Sep 16 in Manila (UTC+8).
const LATE_UTC_15TH = new Date('2026-09-15T23:30:00Z');
// 20:00 UTC on Sep 30 is 04:00 on Oct 1 in Manila, so a new month has already started.
const LATE_UTC_MONTH_END = new Date('2026-09-30T20:00:00Z');

describe('manilaToday', () => {
  it('is the Manila date, not the UTC date, between 00:00 and 08:00 Manila', () => {
    // The derivation this replaces still says the 15th.
    expect(LATE_UTC_15TH.toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(manilaToday(LATE_UTC_15TH)).toBe('2026-09-16');

    expect(LATE_UTC_MONTH_END.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(manilaToday(LATE_UTC_MONTH_END)).toBe('2026-10-01');
  });

  it('rolls over exactly at Manila midnight (16:00 UTC)', () => {
    expect(manilaToday(new Date('2026-09-15T08:00:00Z'))).toBe('2026-09-15');
    expect(manilaToday(new Date('2026-09-15T15:59:59.999Z'))).toBe('2026-09-15');
    expect(manilaToday(new Date('2026-09-15T16:00:00Z'))).toBe('2026-09-16');
  });

  it('matches the attendance shopToday for the same instant', () => {
    for (const now of [
      LATE_UTC_15TH,
      LATE_UTC_MONTH_END,
      new Date('2026-01-01T00:00:00Z'),
    ]) {
      expect(manilaToday(now)).toBe(shopToday(now));
    }
  });

  it('defaults to the current instant', () => {
    expect(manilaToday()).toBe(shopToday(new Date()));
    expect(manilaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('manilaMonthStart', () => {
  it('is the 1st of the Manila month', () => {
    expect(manilaMonthStart(LATE_UTC_15TH)).toBe('2026-09-01');
    // Already October in Manila, although UTC is still in September.
    expect(manilaMonthStart(LATE_UTC_MONTH_END)).toBe('2026-10-01');
    // New Year's Day in Manila while UTC is still Dec 31.
    expect(manilaMonthStart(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });

  it("never lands on the previous month's last day", () => {
    for (const iso of [
      '2026-09-01T00:00:00+08:00',
      '2026-09-15T12:00:00+08:00',
      '2026-09-30T23:59:59+08:00',
    ]) {
      expect(manilaMonthStart(new Date(iso))).toBe('2026-09-01');
    }
  });
});

describe('manilaAddDays', () => {
  it('does calendar arithmetic across month, year and leap-day boundaries', () => {
    expect(manilaAddDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(manilaAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(manilaAddDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(manilaAddDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(manilaAddDays('2026-09-16', -6)).toBe('2026-09-10');
    expect(manilaAddDays('2026-09-16', 0)).toBe('2026-09-16');
  });

  it('matches the attendance addDays', () => {
    for (const [ymd, n] of [
      ['2026-10-01', -29],
      ['2026-09-16', -13],
      ['2027-01-01', -1],
    ] as const) {
      expect(manilaAddDays(ymd, n)).toBe(addDays(ymd, n));
    }
  });
});
