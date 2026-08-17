import { describe, expect, it } from 'vitest';

import {
  centavosToStr,
  effectiveGrams,
  priceCentavos,
  rowTotalCentavos,
  type GramsCarrier,
  type PricingRow,
} from '@/lib/orders/item-pricing';

/**
 * Canonical order-item money math — the ONE source of truth used by the New Order form,
 * the Add-items panel, saved orders, invoices, and reports. These lock the client-reported
 * production bug: 3.38g × ₱7,100 MUST be ₱23,998 (it was showing ₱45,227 from a stale grams
 * value carried over when the item was changed).
 */

const perGram = (grams: string, rate: string): PricingRow => ({
  priceMode: 'per_gram',
  price: '',
  perGram: rate,
  grams,
});
const fixed = (price: string): PricingRow => ({
  priceMode: 'fixed',
  price,
  perGram: '',
  grams: '',
});
const peso = (r: PricingRow, item: GramsCarrier = null): string =>
  centavosToStr(rowTotalCentavos(r, item));

describe('Price Per Gram — item_total = grams × price_per_gram (exact)', () => {
  it('3.38g × ₱7,100 = ₱23,998 (the reported bug — never ₱45,227)', () => {
    expect(peso(perGram('3.38', '7100'))).toBe('23998.00');
  });

  it('every required exact case', () => {
    expect(peso(perGram('1', '7100'))).toBe('7100.00');
    expect(peso(perGram('0.5', '7100'))).toBe('3550.00');
    expect(peso(perGram('10', '7100'))).toBe('71000.00');
    expect(peso(perGram('3.38', '7100'))).toBe('23998.00');
  });

  it('falls back to the item grams when the row override is blank', () => {
    expect(peso(perGram('', '7100'), { grams: '3.38' })).toBe('23998.00');
  });

  it('the row override wins over the item grams (no stale mixing)', () => {
    // A stale item carrying 6.37g must NOT drive the total when the row grams is 3.38.
    expect(peso(perGram('3.38', '7100'), { grams: '6.37' })).toBe('23998.00');
    // And a blank override with a stale 6.37 item is the (undesired) ₱45,227 — proving
    // exactly why the New Order form must RESET grams on item change, not inherit it.
    expect(peso(perGram('', '7100'), { grams: '6.37' })).toBe('45227.00');
  });
});

describe('Fixed Price — grams never multiply', () => {
  it('fixed price = the amount regardless of grams', () => {
    expect(peso(fixed('12500'))).toBe('12500.00');
    expect(peso({ ...fixed('12500'), grams: '3.38' }, { grams: '3.38' })).toBe(
      '12500.00',
    );
  });
});

describe('Multiple items — subtotal is the exact BigInt sum', () => {
  it('3.38g×₱7,100 + 2g×₱7,100 = ₱38,198', () => {
    const subtotal =
      rowTotalCentavos(perGram('3.38', '7100'), null) +
      rowTotalCentavos(perGram('2', '7100'), null);
    expect(centavosToStr(subtotal)).toBe('38198.00');
  });
});

describe('supporting helpers', () => {
  it('priceCentavos parses exact centavos', () => {
    expect(priceCentavos('7100')).toBe(710000n);
    expect(priceCentavos('12500.50')).toBe(1250050n);
    expect(priceCentavos('')).toBe(0n);
  });
  it('effectiveGrams prefers the override, else the item grams', () => {
    expect(effectiveGrams({ grams: '3.38' }, { grams: '6.37' })).toBe('3.38');
    expect(effectiveGrams({ grams: '' }, { grams: '6.37' })).toBe('6.37');
    expect(effectiveGrams({ grams: '' }, null)).toBe('');
  });
});
