import { describe, expect, it } from 'vitest';

import { formatGrams } from '@/lib/inventory/grams-format';

/**
 * Owner 2026-08-28 — Total Grams card format: thousands-separated, ALWAYS 2 decimals, a
 * "g" suffix (e.g. 3,842.56 g). Zero → "0.00 g". A null/unknown total → "—" (never a false
 * 0.00 g). No float artifacts in the displayed string.
 */
describe('formatGrams — Inventory Total Grams card display', () => {
  it('thousands separators, exactly 2 decimals, g suffix', () => {
    expect(formatGrams(3842.56)).toBe('3,842.56 g');
    expect(formatGrams(13729.15)).toBe('13,729.15 g');
    expect(formatGrams(128791.14)).toBe('128,791.14 g');
  });

  it('zero total renders 0.00 g (the empty state), not a dash', () => {
    expect(formatGrams(0)).toBe('0.00 g');
  });

  it('pads whole numbers to two decimals', () => {
    expect(formatGrams(5)).toBe('5.00 g');
    expect(formatGrams(1000)).toBe('1,000.00 g');
  });

  it('rounds to two decimals cleanly (no 13,721.0600000001 float noise)', () => {
    expect(formatGrams(4.769)).toBe('4.77 g');
    expect(formatGrams(2.841)).toBe('2.84 g');
    expect(formatGrams(1234.5)).toBe('1,234.50 g');
  });

  it('null / undefined / NaN show a neutral dash — never a false 0.00 g', () => {
    expect(formatGrams(null)).toBe('—');
    expect(formatGrams(undefined)).toBe('—');
    expect(formatGrams(Number.NaN)).toBe('—');
  });
});
