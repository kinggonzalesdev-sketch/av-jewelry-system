import { describe, expect, it } from 'vitest';

import { rowGramsDisplay, FIXED_PRICE_LABEL } from '@/lib/inventory/grams-display';

// Owner 2026-09-02 BR3: the Inventory Grams column shows "Fixed Price" for an HK ITEM (a display
// label only — the underlying grams stays NULL). Every other item is unchanged.
describe('rowGramsDisplay — HK ITEM "Fixed Price" label', () => {
  it('shows "Fixed Price" for an HK ITEM code', () => {
    expect(rowGramsDisplay('BNA-E-2481 K18 HK ITEM 12,500')).toBe(FIXED_PRICE_LABEL);
    expect(FIXED_PRICE_LABEL).toBe('Fixed Price');
  });

  it('shows "Fixed Price" even if the HK ITEM code carries a stray grams token', () => {
    expect(rowGramsDisplay('BNA-N-5556 HK ITEM 9,600 5.5g')).toBe('Fixed Price');
  });

  it('detects HK ITEM from the item NAME too (not only the code)', () => {
    expect(rowGramsDisplay('BNA-B-1', null, 'HK ITEM bangle')).toBe('Fixed Price');
  });

  it('prefers the stored grams_per_piece for a normal item', () => {
    expect(rowGramsDisplay('SBA-N-1234 1.07g', '2.3')).toBe('2.3');
  });

  it('parses grams from the code when there is no stored value', () => {
    expect(rowGramsDisplay('SBA-N-1234 1.07g')).toBe('1.07');
  });

  it('em dash when a normal item has no grams anywhere', () => {
    expect(rowGramsDisplay('BNA-P-949 1,100 EF')).toBe('—');
  });

  it('is NOT fooled by "hk" inside an unrelated word — a "Japan Style HK" piece is grams-based', () => {
    // These are the rows deliberately EXCLUDED from the HK rename (real per-gram items); grams show.
    expect(rowGramsDisplay('SBA-N-627 10.29g 16" Japan Style HK Necklace')).toBe('10.29');
  });
});
