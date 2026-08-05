import { describe, expect, it } from 'vitest';

import { inventoryGroup } from '@/lib/inventory/group';

describe('inventoryGroup (§16)', () => {
  it('groups by the known condition prefix', () => {
    expect(inventoryGroup('BN-A-1001')).toBe('BN');
    expect(inventoryGroup('SB-A-1001')).toBe('SB');
    expect(inventoryGroup('SBA-N-2683')).toBe('SB');
    expect(inventoryGroup('BNA-B-2279')).toBe('BN');
  });

  it('groups an HK ITEM regardless of its prefix', () => {
    expect(inventoryGroup('BNA-B-2533 K18 HK ITEM 9,600')).toBe('HK ITEM');
    expect(inventoryGroup('X-1', 'Gold hk item necklace')).toBe('HK ITEM');
  });

  it('falls back to Other for an unknown prefix or empty code', () => {
    expect(inventoryGroup('XY-123')).toBe('Other');
    expect(inventoryGroup('')).toBe('Other');
    expect(inventoryGroup(null)).toBe('Other');
  });

  it('moves an item to the new group when the code changes (BN → SB)', () => {
    expect(inventoryGroup('BN-A-1001')).toBe('BN');
    expect(inventoryGroup('SB-A-1001')).toBe('SB');
  });
});
