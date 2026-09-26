import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  inventoryCodeCanonical,
  inventoryCodeNumber,
  rankInventoryCode,
  sortByCodeRank,
} from '@/lib/inventory/code-number';

/**
 * Numeric code extraction + code-first search ranking (migration 20260915120000).
 *
 * The number is extracted for SEARCH RANKING only. Its 2026-09-15 uniqueness rule (one number
 * across every prefix) was retired on 2026-09-26 by migration 20260926110000 — only the same
 * complete code is a duplicate now (see inventory-full-code-uniqueness.test.ts). These tests pin
 * the TypeScript behaviour and, by reading the 0915 migration, that the SQL extraction and ranking
 * tiers match it.
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260915120000_unique_code_numbers_and_ranked_search.sql',
  ),
  'utf8',
);

describe('migration privileges — the index expression stays executable by writers', () => {
  // inventory_code_number is the expression of inventory_items_code_number_idx. Postgres checks
  // EXECUTE on an index expression as the role WRITING the row, and the apps write inventory_items
  // as `authenticated` (RLS) and as service_role. Revoking PUBLIC without this grant made every new
  // or re-coded item fail with "permission denied for function inventory_code_number".
  const GRANT =
    'grant execute on function app_private.inventory_code_number(text) to authenticated, service_role;';
  const REVOKE = 'revoke all on function app_private.inventory_code_number(text) from public, anon;';

  it('grants EXECUTE to authenticated and service_role after revoking PUBLIC/anon', () => {
    expect(MIGRATION).toContain(REVOKE);
    expect(MIGRATION).toContain(GRANT);
    expect(MIGRATION.indexOf(GRANT)).toBeGreaterThan(MIGRATION.indexOf(REVOKE));
  });

  it('never revokes it from authenticated or service_role afterwards', () => {
    const after = MIGRATION.slice(MIGRATION.indexOf(GRANT) + GRANT.length).toLowerCase();
    for (const line of after.split('\n')) {
      if (line.includes('revoke') && line.includes('inventory_code_number')) {
        expect(line).not.toMatch(/authenticated|service_role/);
      }
    }
  });
});

describe('inventoryCodeNumber — the sequence number (search ranking)', () => {
  it('extracts the sequence from a canonical code, with or without grams/size', () => {
    expect(inventoryCodeNumber('SBA-E-8413')).toBe('8413');
    expect(inventoryCodeNumber('SBA-E-8413 1.30g')).toBe('8413');
    expect(inventoryCodeNumber('SBA-P-8413 2.07g')).toBe('8413');
    expect(inventoryCodeNumber('BNA-N-2683 1.80g 16"')).toBe('2683');
    expect(inventoryCodeNumber('  sba-e-8413  ')).toBe('8413');
  });

  it('reads non-canonical prefixes too — K18-8413 and EF-8413 carry 8413', () => {
    expect(inventoryCodeNumber('K18-8413')).toBe('8413');
    expect(inventoryCodeNumber('EF-8413')).toBe('8413');
    expect(inventoryCodeNumber('EF-8413 2.07g')).toBe('8413');
  });

  it('never reads grams, sizes, or karat marks as the number', () => {
    // "1.30g" digits touch a dot/letter; '7"' touches a quote; K18's digits touch the K.
    expect(inventoryCodeNumber('K18 1.30g')).toBeNull();
    expect(inventoryCodeNumber('GOLD NECKLACE 18K')).toBeNull();
  });

  it('gives NO number to HK ITEM, PL- auto codes, or plain text', () => {
    expect(inventoryCodeNumber('HK ITEM')).toBeNull();
    expect(inventoryCodeNumber('PL-1757900000000')).toBeNull();
    expect(inventoryCodeNumber('PL-1757900000000-1234')).toBeNull(); // retry suffix stays exempt
    expect(inventoryCodeNumber('')).toBeNull();
    expect(inventoryCodeNumber(null)).toBeNull();
  });

  it('ignores stray numbers shorter than 3 or longer than 6 digits outside a parsed code', () => {
    expect(inventoryCodeNumber('BN 12')).toBeNull();
    expect(inventoryCodeNumber('LOT 1234567')).toBeNull();
  });
});

describe('rankInventoryCode — code-first, no fuzz', () => {
  it('tier 0: exact full code, raw or canonical, case-insensitive, trimmed', () => {
    expect(rankInventoryCode('SBA-E-8413', 'SBA-E-8413')).toBe(0);
    expect(rankInventoryCode('sba-e-8413', 'SBA-E-8413 1.30g')).toBe(0); // canonical form
    expect(rankInventoryCode('  SBA-E-8413 1.30g  ', 'SBA-E-8413 1.30g')).toBe(0);
  });

  it('tier 1: exact NUMERIC code — "8413" hits any code whose sequence is 8413', () => {
    expect(rankInventoryCode('8413', 'SBA-E-8413 1.30g')).toBe(1);
    expect(rankInventoryCode('8413', 'SBA-P-8413')).toBe(1);
  });

  it('tier 2/3: prefix beats contains', () => {
    expect(rankInventoryCode('SBA-E', 'SBA-E-8413')).toBe(2);
    expect(rankInventoryCode('E-8413', 'SBA-E-8413')).toBe(3);
  });

  it('tier 3 not 1: a code merely CONTAINING the digits never outranks the exact number', () => {
    // The regression that motivated the rule: searching 8413 must surface SBA-E-8413
    // above SBA-E-84135, which only contains the digits.
    expect(rankInventoryCode('8413', 'SBA-E-84135')).toBe(3);
  });

  it('tier 4: no code match (other searchable fields only), and empty queries', () => {
    expect(rankInventoryCode('necklace', 'SBA-E-8413')).toBe(4);
    expect(rankInventoryCode('', 'SBA-E-8413')).toBe(4);
    expect(rankInventoryCode('   ', 'SBA-E-8413')).toBe(4);
  });

  it('NO fuzzy matching: one wrong digit is NOT a code match', () => {
    expect(rankInventoryCode('8414', 'SBA-E-8413')).toBe(4);
  });

  it('sortByCodeRank puts the exact numeric hit first', () => {
    const rows = [
      { code: 'SBA-E-84135' }, // contains 8413 (its own number is 84135)
      { code: 'SBA-N-2001' }, // unrelated
      { code: 'SBA-E-8413 1.30g' }, // THE item
      { code: '84139-X' }, // starts with the digits (its own number is 84139)
    ];
    const sorted = sortByCodeRank(rows, '8413', (r) => r.code);
    expect(sorted[0]!.code).toBe('SBA-E-8413 1.30g'); // exact number (1)
    expect(sorted[1]!.code).toBe('84139-X'); // prefix (2)
    expect(sorted[2]!.code).toBe('SBA-E-84135'); // contains (3)
    expect(sorted[3]!.code).toBe('SBA-N-2001'); // no code match (4)
  });

  it('inventoryCodeCanonical uppercases the prefix form', () => {
    expect(inventoryCodeCanonical('sba-e-8413 1.30g')).toBe('SBA-E-8413');
    expect(inventoryCodeCanonical('HK ITEM')).toBeNull();
  });
});

describe('SQL ↔ TypeScript parity — the migration must carry the same rules', () => {
  it('extracts the number with the same canonical regex and the same loose fallback', () => {
    // CODE_RE mirror (src/lib/inventory/code-parser.ts).
    expect(MIGRATION).toContain(String.raw`'^([A-Za-z]{2})([A-Za-z])[\s-]+([A-Za-z]+)[\s-]+(\d+)'`);
    // LOOSE_SEQUENCE_RE mirror (bounded 3–6 digit run) + the PL- exemption.
    expect(MIGRATION).toContain(String.raw`'(?:^|[\s-])(\d{3,6})(?=[\s-]|$)'`);
    expect(MIGRATION).toContain(`like 'PL-%' then null`);
  });

  it('ranks search with the same 0–4 tiers in BOTH paginated RPCs', () => {
    const rankCase = /when v_q ~ '\^\\d\+\$' and app_private\.inventory_code_number\((item_code|"itemCode")\) = v_q then 1/g;
    expect(MIGRATION.match(rankCase)?.length).toBe(2); // active + completed
    expect(MIGRATION.match(/order by code_rank/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('indexes the number for search WITHOUT making it unique', () => {
    expect(MIGRATION).toContain('inventory_items_code_number_idx');
    expect(MIGRATION).not.toMatch(/create unique index[^\n]*code_number/);
  });
});
