import { describe, expect, it } from 'vitest';

import { isHKItem } from '@/lib/inventory/hk-item';

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
