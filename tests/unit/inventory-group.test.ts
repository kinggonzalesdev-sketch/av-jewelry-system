import { describe, expect, it } from 'vitest';

import { inventoryGroup, groupSearchAlias } from '@/lib/inventory/group';

/**
 * Inventory group classification + exact group-alias search (Owner 2026-09-08).
 *
 * The bug: the group dropdown/filter classify with inventoryGroup (HK ITEM = the "hk item" phrase;
 * otherwise the first-two-letter condition prefix; else Other), but free-text search was a broad
 * substring match — so "hk" returned every row CONTAINING "hk" (245), not the HK ITEM group (226).
 * groupSearchAlias resolves an EXACT group term to its canonical group so search agrees with the
 * count, while leaving ordinary code searches untouched.
 */

describe('inventoryGroup — one canonical classifier (matches the SQL RPC verbatim)', () => {
  it('classifies the "hk item" phrase (code OR name, any spacing) as HK ITEM', () => {
    expect(inventoryGroup('BNA-B-2536 K18 HK ITEM 9600', null)).toBe('HK ITEM');
    expect(inventoryGroup('SBA-N-1001', 'Ring HK Item')).toBe('HK ITEM');
    expect(inventoryGroup('hkitem-1', null)).toBe('HK ITEM');
  });

  it('classifies by the known condition prefix (BN / SB / EF)', () => {
    expect(inventoryGroup('BNA-B-2279', null)).toBe('BN');
    expect(inventoryGroup('SBA-N-2683 1.80g', null)).toBe('SB');
    expect(inventoryGroup('EFA-R-2297', null)).toBe('EF');
  });

  it('classifies an unknown prefix as Other — NOT a made-up group', () => {
    // "HK" as a bare prefix (no "item") is NOT a known condition, so it is Other — this is exactly
    // the kind of row that made "hk" search over-count.
    expect(inventoryGroup('HKB-B-1234', null)).toBe('Other');
    // "BM" is not a known condition and must never be folded into BN.
    expect(inventoryGroup('BMA-B-1234', null)).toBe('Other');
    expect(inventoryGroup('ZZ-1', null)).toBe('Other');
  });

  it('assigns exactly one group and never leaves a row unclassified', () => {
    for (const code of ['BNA-B-1', 'SBA-N-2', 'EFA-R-3', 'HKB-B-4', 'BMA-B-5', '???', '']) {
      const g = inventoryGroup(code, null);
      expect(['BN', 'SB', 'EF', 'HK ITEM', 'Other']).toContain(g);
    }
  });
});

describe('groupSearchAlias — an exact group term becomes a group filter', () => {
  it('resolves the HK ITEM aliases (normalized, case/space-insensitive)', () => {
    for (const q of ['hk', 'HK', ' hk ', 'Hk', 'hk item', 'HK ITEM', 'hkitem']) {
      expect(groupSearchAlias(q)).toBe('HK ITEM');
    }
  });

  it('resolves a bare known condition prefix to its group', () => {
    expect(groupSearchAlias('bn')).toBe('BN');
    expect(groupSearchAlias('SB')).toBe('SB');
    expect(groupSearchAlias('ef')).toBe('EF');
    expect(groupSearchAlias('other')).toBe('Other');
    expect(groupSearchAlias('Other')).toBe('Other');
  });

  it('does NOT treat "bm" as a group — BN and BM are never interchangeable', () => {
    expect(groupSearchAlias('bm')).toBeNull();
  });

  it('leaves ordinary code / size / long searches as normal substring search (null)', () => {
    for (const q of [
      'BNA-B-2533 K18 HK ITEM 7', // a full code that happens to contain "HK ITEM"
      'BNA-B-2533',
      '2533',
      'K18',
      '17"',
      'hk item 7',
      'hkx',
      '',
      null,
      undefined,
    ]) {
      expect(groupSearchAlias(q)).toBeNull();
    }
  });
});

describe('HK regression — search "hk" now means the HK ITEM group', () => {
  // Simulate the server pager's routing (service.ts listInventoryActivePage): an exact alias, with
  // no group already selected, is sent to the RPC as a GROUP filter with an empty search.
  function route(search: string, group: string) {
    const raw = search.trim();
    const alias = group === 'all' ? groupSearchAlias(raw) : null;
    return { p_group: alias ?? group, p_search: alias ? '' : raw };
  }

  it('routes "hk" to the HK ITEM group (so total = the group count, not the substring count)', () => {
    expect(route('hk', 'all')).toEqual({ p_group: 'HK ITEM', p_search: '' });
  });

  it('keeps an explicit group + text search literal WITHIN that group', () => {
    // Group HK ITEM + "2533" → search 2533 inside HK ITEM, never re-read as an alias.
    expect(route('2533', 'HK ITEM')).toEqual({ p_group: 'HK ITEM', p_search: '2533' });
  });

  it('leaves a genuine long code search as a normal substring search', () => {
    expect(route('BNA-B-2533 K18 HK ITEM 7', 'all')).toEqual({
      p_group: 'all',
      p_search: 'BNA-B-2533 K18 HK ITEM 7',
    });
  });
});
