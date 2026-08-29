import { describe, expect, it } from 'vitest';

import {
  detectInventoryCodeIssues,
  normalizeInventoryCode,
  parseInventoryCode,
} from '@/lib/inventory/code-parser';

/**
 * Inventory code parser (UI/UX spec §4–§8). Every example from the spec is pinned
 * here, plus the variation rules: case-insensitivity, missing size, decimal grams,
 * size ranges, K18 attribute, unknown prefixes → needs review, and that the
 * original string is never discarded.
 */

describe('parseInventoryCode — the canonical example', () => {
  it('parses SBA-N-2683 1.80g 16" into all fields', () => {
    const p = parseInventoryCode('SBA-N-2683 1.80g 16"');
    expect(p.inventoryCode).toBe('SBA-N-2683');
    expect(p.conditionCode).toBe('SB');
    expect(p.condition).toBe('Subasta');
    expect(p.supplierInitial).toBe('A');
    expect(p.itemTypeCode).toBe('N');
    expect(p.itemType).toBe('Necklace');
    expect(p.sequence).toBe('2683');
    expect(p.grams).toBe('1.80');
    expect(p.size).toBe('16"');
    expect(p.status).toBe('ok');
    expect(p.raw).toBe('SBA-N-2683 1.80g 16"');
  });
});

describe('parseInventoryCode — the other spec examples', () => {
  it('SBA-E-2679 2.24g — no size is fine', () => {
    const p = parseInventoryCode('SBA-E-2679 2.24g');
    expect(p.inventoryCode).toBe('SBA-E-2679');
    expect(p.itemType).toBe('Earrings');
    expect(p.grams).toBe('2.24');
    expect(p.size).toBeNull();
    expect(p.status).toBe('ok');
  });

  it('BNA-B-2689 1.17g 6-7" — Brand New, Bracelet/Anklet, size range', () => {
    const p = parseInventoryCode('BNA-B-2689 1.17g 6-7"');
    expect(p.condition).toBe('Brand New');
    expect(p.supplierInitial).toBe('A');
    expect(p.itemType).toBe('Bracelet / Anklet');
    expect(p.grams).toBe('1.17');
    expect(p.size).toBe('6-7"');
    expect(p.status).toBe('ok');
  });

  it('BNR-N-420 3.35g 18" — supplier initial R', () => {
    const p = parseInventoryCode('BNR-N-420 3.35g 18"');
    expect(p.conditionCode).toBe('BN');
    expect(p.supplierInitial).toBe('R');
    expect(p.itemType).toBe('Necklace');
    expect(p.sequence).toBe('420');
    expect(p.size).toBe('18"');
  });

  it('SBA-B-2716 10.18g 7" K18 — captures the K18 attribute, size stays 7"', () => {
    const p = parseInventoryCode('SBA-B-2716 10.18g 7" K18');
    expect(p.inventoryCode).toBe('SBA-B-2716');
    expect(p.grams).toBe('10.18');
    expect(p.size).toBe('7"');
    expect(p.attributes).toContain('K18');
    expect(p.status).toBe('ok');
  });

  it('SBA-R-1671 4.40g 7" — Ring', () => {
    const p = parseInventoryCode('SBA-R-1671 4.40g 7"');
    expect(p.itemType).toBe('Ring');
    expect(p.grams).toBe('4.40');
    expect(p.size).toBe('7"');
  });
});

describe('parseInventoryCode — variations (§8)', () => {
  it('is case-insensitive but stores uppercase codes', () => {
    const p = parseInventoryCode('sba-n-2683 1.80G 16"');
    expect(p.conditionCode).toBe('SB');
    expect(p.condition).toBe('Subasta');
    expect(p.itemTypeCode).toBe('N');
    expect(p.grams).toBe('1.80'); // lowercase/uppercase g both work
  });

  it('tolerates extra whitespace and keeps the raw string', () => {
    const raw = '  SBA-N-2683    1.80g   16"  ';
    const p = parseInventoryCode(raw);
    expect(p.inventoryCode).toBe('SBA-N-2683');
    expect(p.raw).toBe(raw); // original never discarded
  });
});

describe('parseInventoryCode — inconsistent separators, leading-dot grams, EF flag', () => {
  it('parses a SPACE separator before the sequence: "SBA-P 2265 .73g"', () => {
    const p = parseInventoryCode('SBA-P 2265 .73g');
    expect(p.inventoryCode).toBe('SBA-P-2265'); // normalized to hyphens
    expect(p.itemType).toBe('Pendant');
    expect(p.grams).toBe('.73'); // leading-dot decimal
    expect(p.status).toBe('ok');
  });

  it('parses "SBA-E 2246 5.70g" (space separator, Earrings)', () => {
    const p = parseInventoryCode('SBA-E 2246 5.70g');
    expect(p.inventoryCode).toBe('SBA-E-2246');
    expect(p.itemType).toBe('Earrings');
    expect(p.grams).toBe('5.70');
    expect(p.status).toBe('ok');
  });

  it('parses a quoted size range: BNA-B-2279 3.80g "15-16"', () => {
    const p = parseInventoryCode('BNA-B-2279 3.80g "15-16"');
    expect(p.inventoryCode).toBe('BNA-B-2279');
    expect(p.size).toBe('15-16"');
    expect(p.status).toBe('ok');
  });

  it('flags Electro Form (EF) as a trailing token: BNA-R-2297 0.98g "6" EF', () => {
    const p = parseInventoryCode('BNA-R-2297 0.98g "6" EF');
    expect(p.inventoryCode).toBe('BNA-R-2297'); // EF is NOT part of the code
    expect(p.size).toBe('6"');
    expect(p.electroForm).toBe(true);
    expect(p.attributes).toContain('EF');
    expect(p.status).toBe('ok');
  });

  it('leaves electroForm false when no EF token is present', () => {
    expect(parseInventoryCode('SBA-N-2683 1.80g 16"').electroForm).toBe(false);
  });
});

describe('parseInventoryCode — needs review (§5, §6)', () => {
  it('flags an unknown condition prefix instead of guessing', () => {
    const p = parseInventoryCode('XYA-N-1 1.0g');
    expect(p.conditionCode).toBe('XY');
    expect(p.condition).toBeNull();
    expect(p.status).toBe('needs_review');
    expect(p.issues.join(' ')).toMatch(/condition/i);
  });

  it('flags an unknown item-type code', () => {
    const p = parseInventoryCode('SBA-Z-1 1.0g');
    expect(p.itemTypeCode).toBe('Z');
    expect(p.itemType).toBeNull();
    expect(p.status).toBe('needs_review');
  });

  it('flags an unrecognizable string but still preserves it', () => {
    const p = parseInventoryCode('just a plain name');
    expect(p.inventoryCode).toBeNull();
    expect(p.status).toBe('needs_review');
    expect(p.raw).toBe('just a plain name');
  });

  it('supports a configurable item-type map (§6)', () => {
    const p = parseInventoryCode('SBA-A-1 1.0g', {
      itemTypes: { A: 'Anklet' },
    });
    expect(p.itemType).toBe('Anklet');
    expect(p.status).toBe('ok');
  });
});

describe('normalizeInventoryCode', () => {
  it('returns the normalized code for matching, or null', () => {
    expect(normalizeInventoryCode('sba-n-2683 1.80g 16"')).toBe('SBA-N-2683');
    expect(normalizeInventoryCode('not a code')).toBeNull();
  });
});

/**
 * Save-time corruption guard (Owner 2026-08-29) — flags the real data-entry typo shapes found
 * inflating the Inventory Grams totals, and stays quiet on well-formed codes.
 */
describe('detectInventoryCodeIssues — save-time corruption guard', () => {
  it('passes clean codes with NO warnings', () => {
    for (const code of [
      'SBA-N-2683 1.80g 16"',
      'SBA-N-5409 98.72g 20" K18 JAPAN', // heavy but real (< 150g)
      'SBA-E-5517 0.06g',
      'SBA-P-2367 0.55g',
      'BNA-R-2297 0.98g "6" EF',
    ]) {
      expect(detectInventoryCodeIssues(code), code).toEqual([]);
    }
  });

  it('flags a sequence fused with the grams (implausible grams)', () => {
    expect(detectInventoryCodeIssues('SBA-B-62814.13g 7.5"').length).toBeGreaterThan(0);
    expect(detectInventoryCodeIssues('ASB-P-21751.80g').join(' ')).toMatch(/high|digits/i);
  });

  it('flags a stray "g" welded to the sequence number', () => {
    expect(detectInventoryCodeIssues('BNA-P-2544g 0.51g EF').join(' ')).toMatch(/stuck|two|high/i);
  });

  it('flags a broken decimal (space inside the grams)', () => {
    expect(detectInventoryCodeIssues('SBA-E-7721 0 87g').join(' ')).toMatch(/space|decimal/i);
    expect(detectInventoryCodeIssues('SBA-N-2672 25 99g 24"').length).toBeGreaterThan(0);
  });

  it('flags a duplicated whole code', () => {
    expect(
      detectInventoryCodeIssues("SBA-P-7646 1.33g' SBA-P-7646 1.33g'").join(' '),
    ).toMatch(/more than once|duplicated/i);
  });

  it('flags a comma price sitting inside the code', () => {
    expect(detectInventoryCodeIssues('BNA-P-949g 1,100 EF').join(' ')).toMatch(/comma|price/i);
  });

  it('flags a 5-digit sequence even when the grams parses fine', () => {
    const issues = detectInventoryCodeIssues('SBA-E-59780 0.30g');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join(' ')).toMatch(/digits/i);
  });

  it('returns nothing for an empty code', () => {
    expect(detectInventoryCodeIssues('')).toEqual([]);
    expect(detectInventoryCodeIssues('   ')).toEqual([]);
  });
});
