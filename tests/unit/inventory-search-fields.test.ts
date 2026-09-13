import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONDITIONS, DEFAULT_ITEM_TYPES } from '@/lib/inventory/code-parser';
import {
  ACTIVE_SEARCH_FIELDS,
  COMPLETED_SEARCH_FIELDS,
  type CompletedSearchRow,
  explainMatch,
  inventoryCodeLabels,
} from '@/lib/inventory/search-fields';

/**
 * Inventory search must be VISIBLE AND EXPLAINABLE (Owner 2026-09-13).
 *
 * Regression guard for a real production bug: a Completed Items search for "1124" returned
 * SBA-E-6486 and SBA-E-6490 because the query also matched the order's retired Order Number
 * ORD-2026-001124 — a value the user can never see. These tests pin the rule that every match must
 * be explainable by a field the user can inspect, and that the SQL and TypeScript sides agree.
 */

const MIGRATION = readFileSync(
  join(
    __dirname,
    '..',
    '..',
    'supabase',
    'migrations',
    '20260913120000_inventory_search_visible_fields_only.sql',
  ),
  'utf8',
);

/** The exact production row behind the bug report (values read from the live database). */
const RUSELL_EARRING: CompletedSearchRow = {
  itemCode: "SBA-E-6486 0.83g'",
  itemName: null,
  availabilityStatus: 'committed',
  customerName: 'RUSELL GAID SANTOS',
  courier: null,
  trackingNumber: null,
  completionType: 'Released',
  currentStage: 'Ship Confirm',
  currentHolder: 'A.V. Jewelry',
  currentLocation: null,
};
// Deliberately NOT on the row type, because search must not be able to see them:
//   order_number   = 'ORD-2026-001124'   (the retired field that caused the false match)
//   invoice_number = 'INV-2026-143128'   (retired)

describe('the reported bug — search must match only what the user can see', () => {
  it('TEST 1: "1124" explains to nothing, so the row must not appear', () => {
    // It only ever lived in the order number, which is not in the allowlist.
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, '1124')).toBeNull();
  });

  it('TEST 2: "6486" is explained by the visible Inventory Code', () => {
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, '6486')).toBe('Inventory Code');
  });

  it('TEST 3: "Rusell" is explained by the Customer', () => {
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, 'Rusell')).toBe('Customer');
  });

  it('TEST 4: "Earrings" matches even though the word is not in the code', () => {
    // "SBA-E-6486 0.83g'" contains no "Earrings" — the parser turns the E segment into it.
    expect(RUSELL_EARRING.itemCode.toLowerCase()).not.toContain('earrings');
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, 'Earrings')).toBe(
      'Condition / Item Type',
    );
  });

  it('TEST 5: the retired invoice number INV-2026-143128 matches nothing', () => {
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, 'INV-2026-143128')).toBeNull();
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, '143128')).toBeNull();
  });

  it('TEST 8: the retired order number matches nothing either', () => {
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, 'ORD-2026-001124')).toBeNull();
  });

  it('a multi-word visible value matches as a phrase', () => {
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, 'Ship Confirm')).toBe(
      'Current Stage',
    );
  });

  it('is case-insensitive, like the SQL ilike', () => {
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, RUSELL_EARRING, 'rusell gaid')).toBe('Customer');
  });

  it('status matches exactly as it is rendered — underscores shown as spaces', () => {
    const row = { ...RUSELL_EARRING, availabilityStatus: 'sold_released' };
    expect(explainMatch(COMPLETED_SEARCH_FIELDS, row, 'sold released')).toBe('Status');
  });
});

describe('the allowlist never contains a hidden identifier', () => {
  const labels = [...COMPLETED_SEARCH_FIELDS, ...ACTIVE_SEARCH_FIELDS].map((f) =>
    f.label.toLowerCase(),
  );

  it.each(['order number', 'invoice', 'uuid', 'id'])('has no "%s" field', (hidden) => {
    expect(labels.some((l) => l === hidden || l.startsWith(`${hidden} `))).toBe(false);
  });
});

describe('the SQL predicate matches the canonical allowlist', () => {
  /** The search predicate of one RPC, from its `matches`/`filtered` block to the next CTE. */
  function predicate(fn: 'completed_inventory_page' | 'inventory_active_ids_page'): string {
    const body = MIGRATION.slice(MIGRATION.indexOf(`function public.${fn}(`));
    const start = body.indexOf(
      fn === 'completed_inventory_page' ? 'matches as (' : 'filtered as (',
    );
    return body.slice(start, body.indexOf('select jsonb_build_object', start));
  }

  it.each(['completed_inventory_page', 'inventory_active_ids_page'] as const)(
    '%s no longer searches the order or invoice number',
    (fn) => {
      const p = predicate(fn);
      expect(p).not.toMatch(/order_?number/i);
      expect(p).not.toMatch(/invoice_?number/i);
    },
  );

  it('completed_inventory_page no longer even selects the order or invoice number', () => {
    const body = MIGRATION.slice(MIGRATION.indexOf('function public.completed_inventory_page('));
    const code = body.slice(0, body.indexOf('$function$;')).replace(/--.*$/gm, '');
    expect(code).not.toMatch(/o\.order_number|o\.invoice_number/);
    expect(code).not.toMatch(/"orderNumber"|"invoiceNumber"/);
    expect(code).toMatch(/"hasOrder"/);
  });

  it('both RPCs search the derived condition / item-type labels', () => {
    expect(predicate('completed_inventory_page')).toMatch(/inventory_code_labels/);
    expect(predicate('inventory_active_ids_page')).toMatch(/inventory_code_labels/);
  });
});

describe('SQL label map stays in lock-step with the TypeScript parser', () => {
  // Two sources of truth for the same mapping is a drift risk. This fails the moment they disagree —
  // e.g. a new item type added to the parser but not to app_private.inventory_code_labels.
  const sql = MIGRATION.slice(
    MIGRATION.indexOf('function app_private.inventory_code_labels'),
    MIGRATION.indexOf('$function$;', MIGRATION.indexOf('function app_private.inventory_code_labels')),
  );

  it.each(Object.entries(DEFAULT_CONDITIONS))('condition %s -> %s is mapped in SQL', (code, label) => {
    expect(sql).toContain(`when '${code}' then '${label}'`);
  });

  it.each(Object.entries(DEFAULT_ITEM_TYPES))('item type %s -> %s is mapped in SQL', (code, label) => {
    expect(sql).toContain(`when '${code}' then '${label}'`);
  });

  it('uses the same code regex as the parser', () => {
    expect(sql).toContain(String.raw`'^([A-Za-z]{2})([A-Za-z])[\s-]+([A-Za-z]+)[\s-]+(\d+)'`);
  });

  it('derives the same labels the UI displays', () => {
    expect(inventoryCodeLabels("SBA-E-6486 0.83g'")).toBe('Subasta Earrings');
    expect(inventoryCodeLabels('BNA-B-2279 1.2g')).toBe('Brand New Bracelet / Anklet');
    expect(inventoryCodeLabels('SBA-P 2265 0.5g')).toBe('Subasta Pendant');
    expect(inventoryCodeLabels('not a code')).toBe('');
  });
});
