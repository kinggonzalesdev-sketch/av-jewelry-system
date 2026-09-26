import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  duplicateInventoryCodeMessage,
  inventoryCodeKey,
  inventoryCodeKeyPattern,
  rankInventoryCode,
} from '@/lib/inventory/code-number';

/**
 * Only the same COMPLETE Inventory Code is a duplicate (Owner 2026-09-26). The number may repeat:
 * BNA-E-6158 2.48G and BNW-N-6158 2.55g 20" are different items. Migration 20260926110000 retires
 * the 2026-09-15 numeric rule and enforces the complete-code rule in the database.
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260926110000_inventory_full_code_uniqueness.sql',
  ),
  'utf8',
);

describe('inventoryCodeKey — what counts as the same complete code', () => {
  const same = (a: string, b: string) => inventoryCodeKey(a) === inventoryCodeKey(b);

  it('TEST 1: BNA-E-6158 2.48G is not BNW-N-6158 2.55g 20"', () => {
    expect(same('BNA-E-6158 2.48G', 'BNW-N-6158 2.55g 20"')).toBe(false);
  });

  it('TEST 2: a different prefix is a different code', () => {
    expect(same('BNA-E-6158 2.48G', 'BNW-E-6158 2.48G')).toBe(false);
  });

  it('TEST 3: a different size is a different code', () => {
    expect(same('BNA-E-6158 2.48G 18"', 'BNA-E-6158 2.48G 20"')).toBe(false);
  });

  it('same prefix, different grams is a different code', () => {
    expect(same('BNA-E-6158 2.48G', 'BNA-E-6158 2.55g')).toBe(false);
  });

  it('TEST 4: the identical code is the same code', () => {
    expect(same('BNA-E-6158 2.48G 20"', 'BNA-E-6158 2.48G 20"')).toBe(true);
  });

  it('TEST 5: case, G vs g, and extra spaces do not make a new code', () => {
    expect(same('BNA-E-6158 2.48G', ' bna-e-6158   2.48g')).toBe(true);
    expect(inventoryCodeKey(' bna-e-6158   2.48g ')).toBe('BNA-E-6158 2.48G');
  });

  it('typographic quotes and a no-break space equal their plain forms', () => {
    const curly = `BNA-E-6158 2.48G 20${String.fromCharCode(0x201d)}`;
    const prime = `BNA-E-6158 2.48G 20${String.fromCharCode(0x2033)}`;
    const nbsp = `BNA-E-6158${String.fromCharCode(0xa0)}2.48G 20"`;
    expect(same(curly, 'BNA-E-6158 2.48G 20"')).toBe(true);
    expect(same(prime, 'BNA-E-6158 2.48G 20"')).toBe(true);
    expect(same(nbsp, 'BNA-E-6158 2.48G 20"')).toBe(true);
    // A curly 18" is still not a 20".
    expect(
      same(`BNA-E-6158 2.48G 18${String.fromCharCode(0x201d)}`, 'BNA-E-6158 2.48G 20"'),
    ).toBe(false);
  });

  it('does not over-normalize: hyphens, dots and the space before grams stay meaningful', () => {
    expect(same('BNA-E-6158 2.48G', 'BNA E 6158 2.48G')).toBe(false);
    expect(same('BNA-E-6158 2.48G', 'BNA-E-6158 248G')).toBe(false);
    expect(same('BNA-E-6158 2.48G', 'BNA-E-6158 2.48 G')).toBe(false);
  });
});

describe('inventoryCodeKeyPattern — candidate fetch for the pre-check', () => {
  it('turns spaces and quotes into wildcards and escapes LIKE characters', () => {
    expect(inventoryCodeKeyPattern('BNA-E-6158 2.48G 20"')).toBe(
      '%BNA-E-6158%2.48G%20_%',
    );
    expect(inventoryCodeKeyPattern('A_B%C')).toBe('%A\\_B\\%C%');
  });
});

describe('TEST 6: numeric search still finds every item with the number', () => {
  it('ranks each 6158 item as an exact-number hit, whatever its prefix', () => {
    for (const code of ['BNA-E-6158 2.48G', 'BNW-N-6158 2.55g 20"', 'BNA-P-6158 1.80g']) {
      expect(rankInventoryCode('6158', code)).toBe(1);
    }
  });

  it('the migration leaves the search functions and the number index alone', () => {
    expect(MIGRATION).not.toMatch(/inventory_active_ids_page|completed_inventory_page/);
    expect(MIGRATION).not.toMatch(/drop index[^\n]*code_number_idx/i);
    expect(MIGRATION).not.toMatch(
      /create or replace function app_private\.inventory_code_number/,
    );
  });
});

describe('migration 20260926110000 — the database rule', () => {
  it('retires the numeric trigger (the function stays for a one-line rollback)', () => {
    expect(MIGRATION).toContain(
      'drop trigger if exists inventory_items_unique_code_number on public.inventory_items;',
    );
    expect(MIGRATION).not.toMatch(
      /drop function[^\n]*enforce_unique_inventory_code_number/,
    );
  });

  it('TEST 7: a UNIQUE index on the complete-code key guards simultaneous saves', () => {
    expect(MIGRATION).toMatch(
      /create unique index if not exists inventory_items_code_key_uidx\s+on public\.inventory_items \(\(app_private\.inventory_code_key\(item_code\)\)\)/,
    );
  });

  it('refuses an exact duplicate with the same message the web shows, as a unique_violation', () => {
    expect(MIGRATION).toContain(
      "'This exact Inventory Code already exists: %. Please review the existing item or use a different complete code.'",
    );
    expect(duplicateInventoryCodeMessage('BNA-E-6158 2.48G 20"')).toBe(
      'This exact Inventory Code already exists: BNA-E-6158 2.48G 20". Please review the existing item or use a different complete code.',
    );
    expect(MIGRATION).toContain("using errcode = 'unique_violation'");
    expect(MIGRATION).toContain(
      'before insert or update of item_code on public.inventory_items',
    );
  });

  it('TEST 8: re-saving an item under its own code is allowed', () => {
    expect(MIGRATION).toContain(
      "if tg_op = 'UPDATE' and app_private.inventory_code_key(old.item_code) = v_key then",
    );
  });

  it('keeps the key executable by the roles that write inventory (index expression)', () => {
    const revoke =
      'revoke all on function app_private.inventory_code_key(text) from public, anon;';
    const grant =
      'grant execute on function app_private.inventory_code_key(text) to authenticated, service_role;';
    expect(MIGRATION.indexOf(grant)).toBeGreaterThan(MIGRATION.indexOf(revoke));
    expect(MIGRATION).toContain(
      'revoke all on function app_private.enforce_unique_inventory_code_key() from public, anon;',
    );
  });

  it('mirrors inventoryCodeKey: the same characters, collapsed spaces, trim, upper case', () => {
    expect(MIGRATION).toContain(
      'chr(8220) || chr(8221) || chr(8222) || chr(8223) || chr(8243)',
    );
    expect(MIGRATION).toContain(
      '|| chr(8216) || chr(8217) || chr(8218) || chr(8219) || chr(8242)',
    );
    expect(MIGRATION).toContain('|| chr(160),');
    expect(MIGRATION).toContain('repeat(chr(34), 5) || repeat(chr(39), 5) || chr(32)');
    expect(MIGRATION).toContain("'\\s+', ' ', 'g'");
  });

  it('changes no inventory data', () => {
    expect(MIGRATION).not.toMatch(/\bupdate\s+public\.inventory_items\b/i);
    expect(MIGRATION).not.toMatch(/\bdelete\s+from\b/i);
    expect(MIGRATION).not.toMatch(/\balter\s+table\b/i);
  });
});

// ---------------------------------------------------------------------------
// The New Entry and code-correction server paths.
// ---------------------------------------------------------------------------

type Row = { item_code: string };
let stored: Row[] = [];
let insertResult: { data: unknown; error: { code?: string; message: string } | null } = {
  data: { id: 'new-1' },
  error: null,
};
const inserted: unknown[] = [];
const updated: unknown[] = [];

function likeToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      re += (pattern[i + 1] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    } else if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

vi.mock('server-only', () => ({}));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requirePermission: () => Promise.resolve({ staffProfileId: 'staff-1' }),
  requireOwner: () => Promise.resolve({ staffProfileId: 'staff-1' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: () => {
        let pattern: RegExp | null = null;
        let excludeCode: string | null = null;
        const q = {
          select: () => q,
          eq: () => q,
          neq: () => q,
          ilike: (_c: string, p: string) => {
            pattern = likeToRegExp(p);
            return q;
          },
          limit: () =>
            Promise.resolve({
              data: stored.filter(
                (r) =>
                  (!pattern || pattern.test(r.item_code)) && r.item_code !== excludeCode,
              ),
              error: null,
            }),
          single: () =>
            Promise.resolve({ data: { item_code: excludeCode ?? '' }, error: null }),
          insert: (row: unknown) => {
            inserted.push(row);
            return { select: () => ({ single: () => Promise.resolve(insertResult) }) };
          },
          update: (row: unknown) => {
            updated.push(row);
            return { eq: () => ({ eq: () => Promise.resolve({ error: null }) }) };
          },
          // The correction reads the item's current code first; tests set it here.
          _setCurrent: (code: string) => {
            excludeCode = code;
          },
        };
        if (currentCode !== null) q._setCurrent(currentCode);
        return q;
      },
    }),
}));
let currentCode: string | null = null;

beforeEach(() => {
  stored = [];
  inserted.length = 0;
  updated.length = 0;
  currentCode = null;
  insertResult = { data: { id: 'new-1' }, error: null };
});

describe('New Entry (createInventoryEntry)', () => {
  it('TEST 1: BNA-E-6158 2.48G saves while BNW-N-6158 2.55g 20" exists', async () => {
    const { createInventoryEntry } = await import('@/lib/inventory/create');
    stored = [{ item_code: 'BNW-N-6158 2.55g 20"' }];
    const res = await createInventoryEntry('BNA-E-6158 2.48G', null, null, true);
    expect(res).toEqual({ ok: true, inventoryItemId: 'new-1' });
    expect(inserted).toHaveLength(1);
  });

  it('TEST 2 / TEST 3: another prefix, or another size, saves', async () => {
    const { createInventoryEntry } = await import('@/lib/inventory/create');
    stored = [{ item_code: 'BNA-E-6158 2.48G' }, { item_code: 'BNA-E-6158 2.48G 18"' }];
    expect((await createInventoryEntry('BNW-E-6158 2.48G', null, null, true)).ok).toBe(
      true,
    );
    expect(
      (await createInventoryEntry('BNA-E-6158 2.48G 20"', null, null, true)).ok,
    ).toBe(true);
    expect((await createInventoryEntry('BNA-E-6158 2.55g', null, null, true)).ok).toBe(
      true,
    );
  });

  it('TEST 4: the exact same complete code is refused, naming the existing item', async () => {
    const { createInventoryEntry } = await import('@/lib/inventory/create');
    stored = [{ item_code: 'BNA-E-6158 2.48G 20"' }];
    const res = await createInventoryEntry('BNA-E-6158 2.48G 20"', null, null, true);
    expect(res).toEqual({
      ok: false,
      error: duplicateInventoryCodeMessage('BNA-E-6158 2.48G 20"'),
    });
    expect(inserted).toHaveLength(0);
  });

  it('TEST 5: a case/space variant of an existing code is refused', async () => {
    const { createInventoryEntry } = await import('@/lib/inventory/create');
    stored = [{ item_code: 'BNA-E-6158 2.48G' }];
    const res = await createInventoryEntry(' bna-e-6158   2.48g', null, null, true);
    expect(res).toEqual({
      ok: false,
      error: duplicateInventoryCodeMessage('BNA-E-6158 2.48G'),
    });
    expect(inserted).toHaveLength(0);
  });

  it('TEST 7: when a simultaneous save wins, the database refusal is shown, never a save', async () => {
    const { createInventoryEntry } = await import('@/lib/inventory/create');
    insertResult = {
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "inventory_items_code_key_uidx"',
      },
    };
    const res = await createInventoryEntry('BNA-E-6158 2.48G', null, null, true);
    expect(res).toEqual({
      ok: false,
      error: duplicateInventoryCodeMessage('BNA-E-6158 2.48G'),
    });
  });

  it('passes the trigger message through verbatim', async () => {
    const { createInventoryEntry } = await import('@/lib/inventory/create');
    const message = duplicateInventoryCodeMessage('BNA-E-6158 2.48G');
    insertResult = { data: null, error: { code: '23505', message } };
    const res = await createInventoryEntry('bna-e-6158 2.48g', null, null, true);
    expect(res).toEqual({ ok: false, error: message });
  });
});

describe('Super-Admin code correction (editInventoryItemDetails)', () => {
  const base = {
    inventoryItemId: 'item-1',
    itemName: 'Ring',
    grams: null,
    size: null,
    supplierName: null,
    facebookName: null,
    acknowledgeWarnings: true,
  };

  it('allows a correction to a number another prefix already uses', async () => {
    const { editInventoryItemDetails } = await import('@/lib/inventory/archive');
    currentCode = 'BNA-E-6185 2.48G';
    stored = [{ item_code: 'BNA-E-6185 2.48G' }, { item_code: 'BNW-N-6158 2.55g 20"' }];
    const res = await editInventoryItemDetails({ ...base, itemCode: 'BNA-E-6158 2.48G' });
    expect(res.ok).toBe(true);
    expect(updated[0]).toMatchObject({ item_code: 'BNA-E-6158 2.48G' });
  });

  it('refuses a correction to another item’s exact complete code', async () => {
    const { editInventoryItemDetails } = await import('@/lib/inventory/archive');
    currentCode = 'BNA-E-6185 2.48G';
    stored = [{ item_code: 'BNA-E-6185 2.48G' }, { item_code: 'BNA-E-6158 2.48G' }];
    const res = await editInventoryItemDetails({
      ...base,
      itemCode: 'bna-e-6158  2.48g',
    });
    expect(res).toEqual({
      ok: false,
      error: duplicateInventoryCodeMessage('BNA-E-6158 2.48G'),
    });
    expect(updated).toHaveLength(0);
  });

  it('TEST 8: fixing only the case or spacing of an item’s own code is allowed', async () => {
    const { editInventoryItemDetails } = await import('@/lib/inventory/archive');
    currentCode = 'bna-e-6158  2.48g';
    stored = [{ item_code: 'bna-e-6158  2.48g' }];
    const res = await editInventoryItemDetails({ ...base, itemCode: 'BNA-E-6158 2.48G' });
    expect(res.ok).toBe(true);
  });
});
