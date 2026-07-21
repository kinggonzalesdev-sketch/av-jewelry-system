import { describe, expect, it } from 'vitest';

import { durationHours, formatDuration } from '@/lib/hr/format';

describe('durationHours', () => {
  it('computes fractional hours between two timestamps', () => {
    expect(
      durationHours('2026-07-18T09:00:00.000Z', '2026-07-18T17:30:00.000Z'),
    ).toBe(8.5);
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
