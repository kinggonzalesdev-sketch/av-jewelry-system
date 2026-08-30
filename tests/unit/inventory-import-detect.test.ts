import { describe, expect, it } from 'vitest';

import {
  cleanGrams,
  cleanPrice,
  detectInventory,
  extractHkPrice,
  isHkText,
  type SheetInput,
} from '@/lib/inventory/import-detect';

describe('HK Item detection + Fixed Price extraction', () => {
  it('detects HK ITEM across casings/variations', () => {
    expect(isHkText('BNA-E-2481 K18 HK ITEM 12,500')).toBe(true);
    expect(isHkText('hk-item 12500')).toBe(true);
    expect(isHkText('K18 HK ITEMS PHP 8,500.50')).toBe(true);
    expect(isHkText('SBA-N-1630 6.81g 24"')).toBe(false);
  });

  it('extracts the HK Fixed Price from the description', () => {
    expect(extractHkPrice('BNA-E-2481 K18 HK ITEM 12,500')).toBe('12500');
    expect(extractHkPrice('HK ITEM ₱19,909')).toBe('19909');
    expect(extractHkPrice('K18 HK ITEMS PHP 8,500.50')).toBe('8500.50');
    expect(extractHkPrice('HK-ITEM 12500')).toBe('12500');
  });

  it('cleans currency/commas and rejects non-prices', () => {
    expect(cleanPrice('₱12,500')).toBe('12500');
    expect(cleanPrice('PHP 8,500.50')).toBe('8500.50');
    expect(cleanPrice('16')).toBeNull(); // a ring size, not a price
    expect(cleanPrice('1.57')).toBeNull(); // grams, not a price
  });

  it('reads grams but not size/price', () => {
    expect(cleanGrams('1.57g')).toBe('1.57');
    expect(cleanGrams('4.67 grams')).toBe('4.67');
    expect(cleanGrams('14.95 G')).toBe('14.95');
  });
});

describe('detectInventory — headers, blocks, HK, duplicates', () => {
  const sheet = (name: string, rows: string[][]): SheetInput => ({ name, rows });

  it('parses a CODE/GRAMS/DESCRIPTION block and an HK fixed-price row', () => {
    const sheets = [
      sheet('APRIL', [
        ['CODE', 'GRAMS', 'DESCRIPTION'],
        ['BNR-E-353', '1.57', 'BNR-E-353 1.57g'],
        ['BNA-E-2481', '', 'BNA-E-2481 K18 HK ITEM 12,500'],
        ['', '', ''],
      ]),
    ];
    const { candidates, summary } = detectInventory(sheets, []);
    expect(summary.worksheets).toBe(1);
    expect(summary.blocks).toBeGreaterThanOrEqual(1);

    const hk = candidates.find((c) => c.isHkItem);
    expect(hk).toBeTruthy();
    expect(hk?.pricingType).toBe('fixed');
    expect(hk?.fixedPrice).toBe('12500');
    expect(hk?.inventoryCode).toBe('BNA-E-2481');
    expect(hk?.validation).toBe('valid');

    const plain = candidates.find((c) => c.inventoryCode === 'BNR-E-353');
    expect(plain?.grams).toBe('1.57');
  });

  it('flags an HK item with no identifiable price as needs-review (still Fixed)', () => {
    const sheets = [sheet('JHEN', [['ITEM'], ['BNA-B-900 K18 HK ITEM']])];
    const { candidates } = detectInventory(sheets, []);
    const hk = candidates.find((c) => c.isHkItem);
    expect(hk?.pricingType).toBe('fixed');
    expect(hk?.fixedPrice).toBeNull();
    expect(hk?.validation).toBe('needs_review');
    expect(hk?.issues.join(' ')).toContain('Fixed Price could not be identified');
  });

  it('flags a corrupt code (fused sequence+grams / broken decimal) as needs-review; clean stays valid', () => {
    const sheets = [
      sheet('CORRUPT', [
        ['CODE', 'GRAMS', 'DESCRIPTION'],
        ['SBA-B-62814.13g', '', 'SBA-B-62814.13g 7.5"'], // sequence fused with the grams
        ['SBA-E-7721 0 87g', '', 'SBA-E-7721 0 87g'], // broken decimal (space for dot)
        ['SBA-N-1630 6.81g', '', 'SBA-N-1630 6.81g 24"'], // clean → valid
      ]),
    ];
    const { candidates } = detectInventory(sheets, []);
    const merged = candidates.find((c) => c.inventoryCode === 'SBA-B-62814');
    expect(merged?.validation).toBe('needs_review');
    expect(merged?.issues.join(' ')).toMatch(/high|digits/i);

    const broken = candidates.find((c) => c.inventoryCode === 'SBA-E-7721');
    expect(broken?.validation).toBe('needs_review');
    expect(broken?.issues.join(' ')).toMatch(/space|decimal/i);

    const clean = candidates.find((c) => c.inventoryCode === 'SBA-N-1630');
    expect(clean?.validation).toBe('valid');
    expect(clean?.issues).toEqual([]);
  });

  it('does NOT flag an HK item for the comma price inside its code (guard is non-HK only)', () => {
    const sheets = [sheet('HK', [['CODE'], ['BNA-B-2533 K18 HK ITEM 37,500 "7"']])];
    const { candidates } = detectInventory(sheets, []);
    const hk = candidates.find((c) => c.isHkItem);
    expect(hk?.validation).toBe('valid'); // comma is a legit HK price, not a code corruption
  });

  it('flags EVERY occurrence of a repeated code across sheets (not just the 2nd)', () => {
    const sheets = [
      sheet('APRIL', [
        ['CODE', 'FIXED PRICE'],
        ['BNA-E-2512', '22,400'],
      ]),
      sheet('ROBERT', [
        ['CODE', 'FIXED PRICE'],
        ['BNA-E 2512', '12,800'],
      ]),
    ];
    const { candidates, summary } = detectInventory(sheets, []);
    const dups = candidates.filter((c) => c.inventoryCode === 'BNA-E-2512');
    expect(dups).toHaveLength(2);
    // BOTH occurrences are duplicates (the first is not left "valid").
    expect(dups.every((c) => c.validation === 'duplicate')).toBe(true);
    // Conflicting Fixed Price is called out.
    expect(dups[0]?.issues.join(' ')).toContain('conflicting details');
    expect(dups[0]?.issues.join(' ')).toContain('Fixed Price');
    expect(summary.duplicate).toBe(2);
    expect(summary.valid).toBe(0);
  });

  it('marks a duplicate inventory code', () => {
    const sheets = [
      sheet('WILMAR', [
        ['CODE', 'GRAMS'],
        ['SBA-N-1630', '6.81'],
      ]),
    ];
    const { candidates } = detectInventory(sheets, ['SBA-N-1630']);
    expect(candidates[0]?.validation).toBe('duplicate');
    expect(candidates[0]?.duplicate).toBe(true);
  });
});
