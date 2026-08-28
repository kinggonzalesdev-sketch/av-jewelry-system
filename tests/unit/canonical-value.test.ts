import { describe, expect, it } from 'vitest';

import { canonicalLeadingDecimalGrams } from '@/lib/capture/canonical-value';

/**
 * Owner 2026-08-28 — value-only Pancake canonical safety net (leading-decimal grams). Corrects ONLY
 * the proven lost-leading-decimal case with STRICT digit agreement; never a blind integer→decimal.
 */
describe('canonicalLeadingDecimalGrams', () => {
  it('SAFE CORRECTION: OCR integer + exact comment leading decimal (same digits)', () => {
    expect(canonicalLeadingDecimalGrams('11', 'mine .11')).toBe('0.11');
    expect(canonicalLeadingDecimalGrams('33', 'mine .33')).toBe('0.33');
    expect(canonicalLeadingDecimalGrams('44', 'mine .44')).toBe('0.44');
    expect(canonicalLeadingDecimalGrams('55', 'mine .55')).toBe('0.55');
    expect(canonicalLeadingDecimalGrams('99', 'mine .99')).toBe('0.99');
    expect(canonicalLeadingDecimalGrams('5', '.5 mine')).toBe('0.5');
    // "0.33" form and HTML-wrapped comment text both work.
    expect(canonicalLeadingDecimalGrams('33', 'mine 0.33')).toBe('0.33');
    expect(canonicalLeadingDecimalGrams('33', '<div>mine .33</div>')).toBe('0.33');
    // Trailing-zero normalization: ".30" → 0.3.
    expect(canonicalLeadingDecimalGrams('30', 'mine .30')).toBe('0.3');
    // Several numbers in the comment — use the leading decimal whose digits match the OCR integer.
    expect(canonicalLeadingDecimalGrams('33', 'size .5 mine .33')).toBe('0.33');
  });

  it('REAL WHOLE GRAMS: comment carries the same integer (no leading dot) → preserved (null)', () => {
    expect(canonicalLeadingDecimalGrams('11', 'mine 11')).toBeNull();
    expect(canonicalLeadingDecimalGrams('33', 'mine 33')).toBeNull();
    expect(canonicalLeadingDecimalGrams('44', 'mine 44')).toBeNull();
    expect(canonicalLeadingDecimalGrams('55', 'mine 55')).toBeNull();
  });

  it('MISMATCH: OCR "33" but comment ".44" → NO correction (never silently changed)', () => {
    expect(canonicalLeadingDecimalGrams('33', 'mine .44')).toBeNull();
    expect(canonicalLeadingDecimalGrams('5', '.55 mine')).toBeNull(); // digit disagreement
    expect(canonicalLeadingDecimalGrams('33', 'mine .330')).toBeNull(); // "330" ≠ "33"
  });

  it('NORMAL DECIMALS / non-leading forms are left unchanged (null)', () => {
    // OCR already a decimal → not a lost-leading-decimal shape.
    expect(canonicalLeadingDecimalGrams('1.16', 'mine 1.16')).toBeNull();
    expect(canonicalLeadingDecimalGrams('5.43', 'mine 5.43')).toBeNull();
    expect(canonicalLeadingDecimalGrams('13.5', 'mine 13.5')).toBeNull();
    // A normal MID-number decimal in the comment ("3.36") is not a LEADING decimal.
    expect(canonicalLeadingDecimalGrams('336', 'mine 3.36')).toBeNull();
  });

  it('FIXED PRICE / large integers are never canonicalized (grams-range integers only)', () => {
    expect(canonicalLeadingDecimalGrams('15000', 'mine .15000')).toBeNull(); // 5-digit → not grams shape
    expect(canonicalLeadingDecimalGrams('15k', 'mine .15')).toBeNull(); // "15k" is not a bare integer
  });

  it('empty / null inputs → null', () => {
    expect(canonicalLeadingDecimalGrams(null, 'mine .33')).toBeNull();
    expect(canonicalLeadingDecimalGrams('33', null)).toBeNull();
    expect(canonicalLeadingDecimalGrams('33', '')).toBeNull();
    expect(canonicalLeadingDecimalGrams('', 'mine .33')).toBeNull();
  });
});
