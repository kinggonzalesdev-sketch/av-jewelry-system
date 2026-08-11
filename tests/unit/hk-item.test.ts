import { describe, expect, it } from 'vitest';

import { hkFixedPrice, isHKItem } from '@/lib/inventory/hk-item';

describe('isHKItem — the one shared HK ITEM rule', () => {
  it('detects "HK ITEM" case-insensitively, with optional spacing, in code or name', () => {
    expect(isHKItem('BNA-B-2533 K18 HK ITEM')).toBe(true);
    expect(isHKItem('Hk Item')).toBe(true);
    expect(isHKItem('hk item')).toBe(true);
    expect(isHKItem('HKITEM')).toBe(true);
    expect(isHKItem({ itemCode: 'X-1', itemName: 'Gold HK Item necklace' })).toBe(true);
    expect(isHKItem({ code: 'RING HK ITEM', name: null })).toBe(true);
  });

  it('returns false for non-HK items and empty input', () => {
    expect(isHKItem('BNA-B-2533 K18')).toBe(false);
    expect(isHKItem('Bangle 10.1g')).toBe(false);
    expect(isHKItem({ itemCode: null, itemName: null })).toBe(false);
    expect(isHKItem('')).toBe(false);
    expect(isHKItem(null)).toBe(false);
    expect(isHKItem(undefined)).toBe(false);
  });
});

describe('hkFixedPrice — the price written after "HK ITEM"', () => {
  it('reads the number after "HK ITEM", ignoring the quoted size', () => {
    expect(hkFixedPrice('BNA-B-2536 K18 HK ITEM 9,600 "16"')).toBe('9600');
    expect(hkFixedPrice('X HK ITEM 37,500')).toBe('37500');
    expect(hkFixedPrice('X HK ITEM 1200.50 "6-7"')).toBe('1200.50');
    expect(hkFixedPrice({ itemCode: 'A HK ITEM 12,000 "18"', itemName: null })).toBe(
      '12000',
    );
  });

  it('ignores a grams token when locating the price', () => {
    expect(hkFixedPrice('HK ITEM 5.5g 9,600 "16"')).toBe('9600');
  });

  it('returns null with no price written, or for a non-HK item', () => {
    expect(hkFixedPrice('BNA-B-2533 K18 HK ITEM')).toBeNull();
    expect(hkFixedPrice('BNA-B-2533 K18')).toBeNull();
    expect(hkFixedPrice(null)).toBeNull();
  });
});
