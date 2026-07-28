import { describe, expect, it } from 'vitest';

import { durationHours, formatDuration, normalizeHourlyRate } from '@/lib/hr/format';

describe('durationHours', () => {
  it('computes fractional hours between two timestamps', () => {
    expect(durationHours('2026-07-18T09:00:00.000Z', '2026-07-18T17:30:00.000Z')).toBe(
      8.5,
    );
  });

  it('returns null for an open session (no clock-out)', () => {
    expect(durationHours('2026-07-18T09:00:00.000Z', null)).toBeNull();
  });

  it('returns null for a negative span rather than a wrong number', () => {
    expect(
      durationHours('2026-07-18T17:00:00.000Z', '2026-07-18T09:00:00.000Z'),
    ).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats whole and fractional hours', () => {
    expect(formatDuration(8)).toBe('8h');
    expect(formatDuration(8.5)).toBe('8h 30m');
    expect(formatDuration(0)).toBe('0h');
  });

  it('shows an em dash for an open/unknown duration', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('normalizeHourlyRate', () => {
  it('keeps a valid rate as a string (never a float)', () => {
    expect(normalizeHourlyRate('85')).toEqual({ rate: '85' });
    expect(normalizeHourlyRate('85.50')).toEqual({ rate: '85.50' });
    expect(normalizeHourlyRate('  100.5 ')).toEqual({ rate: '100.5' });
    expect(normalizeHourlyRate('0')).toEqual({ rate: '0' });
  });

  it('treats an empty input as clearing the rate', () => {
    expect(normalizeHourlyRate('')).toEqual({ rate: null });
    expect(normalizeHourlyRate('   ')).toEqual({ rate: null });
    expect(normalizeHourlyRate(null)).toEqual({ rate: null });
  });

  it('refuses negatives, letters, and more than two decimals', () => {
    expect(normalizeHourlyRate('-1')).toHaveProperty('error');
    expect(normalizeHourlyRate('abc')).toHaveProperty('error');
    expect(normalizeHourlyRate('85.555')).toHaveProperty('error');
    expect(normalizeHourlyRate('1,000')).toHaveProperty('error');
  });
});
