import { describe, expect, it } from 'vitest';

import {
  computeOrderGramsPricing,
  formatTotalGrams,
  gramsTokenValue,
  lineGramsPerPiece,
  type OrderLineForPricing,
} from '@/lib/orders/grams-pricing';

// Grams live inside item_code text (grams_per_piece is NULL for ~all items); a fixed/HK
// item carries a comma price and no "Ng" weight.
const line = (over: Partial<OrderLineForPricing>): OrderLineForPricing => ({
  itemCode: null,
  gramsPerPiece: null,
  unitPrice: null,
  quantity: 1,
  ...over,
});

describe('lineGramsPerPiece — grams source of truth', () => {
  it('prefers the structured column when present', () => {
    expect(lineGramsPerPiece(line({ gramsPerPiece: '2.3', itemCode: 'SBA-N-1 9.9g' }))).toBe(2.3);
  });
  it('falls back to parsing the item_code text', () => {
    expect(lineGramsPerPiece(line({ itemCode: 'SBA-N-1234 1.07g' }))).toBe(1.07);
  });
  it('is 0 for a fixed/HK item with no weight in the code', () => {
    expect(lineGramsPerPiece(line({ itemCode: 'BNA-E-2481 K18 HK ITEM 12,500' }))).toBe(0);
  });
});

// Owner 2026-09-02 BR2: an HK ITEM is ALWAYS fixed-price — grams never apply, even if a stray "…g"
// token sits in the code or a legacy grams_per_piece is populated. So the Order Summary + Send-Invoice
// suppress Grams + Price-Per-Gram for it (no fabricated Total÷Grams rate).
describe('HK ITEM grams suppression', () => {
  it('a stray grams token in an HK ITEM code still yields 0 grams', () => {
    expect(lineGramsPerPiece(line({ itemCode: 'BNA-N-5556 HK ITEM 9,600 5.5g' }))).toBe(0);
  });
  it('a legacy stored grams_per_piece on an HK ITEM still yields 0 grams', () => {
    expect(lineGramsPerPiece(line({ gramsPerPiece: '5.5', itemCode: 'BNA-E-2500 K18 HK ITEM' }))).toBe(0);
  });
  it('an HK order line contributes no grams and no rate', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'BNA-N-5556 HK ITEM 9,600 5.5g', unitPrice: '9600.00' }),
    ]);
    expect(p.hasGrams).toBe(false);
    expect(p.pricePerGram).toBeNull();
    expect(formatTotalGrams(p)).toBe('—');
    expect(gramsTokenValue(p)).toBe('');
  });
  it('a non-HK grams line in the SAME order is unaffected (only the HK line is dropped)', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'BNA-N-5556 HK ITEM 9,600 5.5g', unitPrice: '9600.00' }),
      line({ itemCode: 'SBA-N-1234 1.07g', unitPrice: '7811.00' }),
    ]);
    expect(p.hasGrams).toBe(true);
    expect(p.totalGrams).toBe(1.07);
    expect(p.pricePerGram).toBe(7300);
  });
});

describe('computeOrderGramsPricing', () => {
  // TEST 1 — standard grams invoice: 1.07g @ ₱7,300 ⇒ total 7811.
  it('single grams line derives exact rate (Glaiza: 1.07g → ₱7,300)', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'SBA-N-1234 1.07g', unitPrice: '7811.00' }),
    ]);
    expect(p.hasGrams).toBe(true);
    expect(p.totalGrams).toBe(1.07);
    expect(p.pricePerGram).toBe(7300);
    expect(p.mixedRates).toBe(false);
    expect(formatTotalGrams(p)).toBe('1.07g');
    expect(gramsTokenValue(p)).toBe('1.07');
  });

  // TEST 2 — decimal grams preserved (0.64, never 64): 0.64g @ ₱7,500 ⇒ total 4800.
  it('preserves 0.64 (does not become 64)', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'SBA-R-999 0.64g', unitPrice: '4800.00' }),
    ]);
    expect(p.totalGrams).toBe(0.64);
    expect(gramsTokenValue(p)).toBe('0.64');
    expect(p.pricePerGram).toBe(7500);
  });

  // TEST 4 — genuine Fixed Price: no grams in the code ⇒ no grams, no fabricated rate.
  it('fixed-price item yields no grams and no rate', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'BNA-E-2481 K18 HK ITEM 12,500', unitPrice: '12500.00' }),
    ]);
    expect(p.hasGrams).toBe(false);
    expect(p.pricePerGram).toBeNull();
    expect(p.mixedRates).toBe(false);
    expect(formatTotalGrams(p)).toBe('—');
    expect(gramsTokenValue(p)).toBe('');
  });

  // Missing rate on a grams line (unitPrice absent) ⇒ grams known, rate unresolved.
  it('grams line with no unit price leaves the rate null (blocks send upstream)', () => {
    const p = computeOrderGramsPricing([line({ itemCode: 'SBA-N-1 1.07g', unitPrice: null })]);
    expect(p.hasGrams).toBe(true);
    expect(p.pricePerGram).toBeNull();
    expect(p.mixedRates).toBe(false);
  });

  // MULTIPLE grams items, same rate ⇒ one rate, summed grams.
  it('multiple grams lines at one rate → that rate, summed grams', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'SBA-N-1 1.00g', unitPrice: '7300.00' }),
      line({ itemCode: 'SBA-R-2 2.00g', unitPrice: '14600.00' }),
    ]);
    expect(p.totalGrams).toBe(3);
    expect(p.pricePerGram).toBe(7300);
    expect(p.mixedRates).toBe(false);
  });

  // MULTIPLE grams items, different rates ⇒ Mixed Rates, never a fabricated single rate.
  it('multiple grams lines at different rates → mixedRates, null single rate', () => {
    const p = computeOrderGramsPricing([
      line({ itemCode: 'SBA-N-1 1.00g', unitPrice: '7300.00' }),
      line({ itemCode: 'SBA-R-2 1.00g', unitPrice: '7500.00' }),
    ]);
    expect(p.mixedRates).toBe(true);
    expect(p.pricePerGram).toBeNull();
    expect(p.totalGrams).toBe(2);
  });

  // Controls (Danica/Glaiza-style structured grams column) — no regression.
  it('reads the grams column when the invoice stored it (Danica 2.3 → ₱X)', () => {
    const p = computeOrderGramsPricing([
      line({ gramsPerPiece: '2.3', itemCode: 'SBA-N-7 2.3g', unitPrice: '16790.00' }),
    ]);
    expect(p.totalGrams).toBe(2.3);
    expect(p.pricePerGram).toBe(7300); // 16790 / 2.3 = 7300
  });

  it('empty order → no grams, no rate', () => {
    const p = computeOrderGramsPricing([]);
    expect(p.hasGrams).toBe(false);
    expect(formatTotalGrams(p)).toBe('—');
  });
});
