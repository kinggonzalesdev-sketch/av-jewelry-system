import { describe, expect, it } from 'vitest';

import { parseInventoryCode } from '@/lib/inventory/code-parser';

/**
 * Owner 2026-08-28 — GRAMS SOURCE OF TRUTH for the Total Grams cards.
 *
 * `inventory_items.grams_per_piece` is empty for essentially every item; the real per-piece
 * grams lives INSIDE `item_code` and the Inventory table derives it with `parseInventoryCode`
 * (GRAMS_RE = /(\d*\.?\d+)\s*g\b/i — the FIRST number followed by "g"). The `inventory_grams_totals`
 * RPC replicates this exact regex in SQL, so each card equals the SUM of the table's Grams
 * column ROW-FOR-ROW.
 *
 * These cases pin the per-row values the card totals — including the malformed codes the Owner
 * chose to include LITERALLY (matching the table) rather than guard. The listed malformed codes
 * are the ones to correct at the source; fixing a code corrects the table AND the card together.
 */
describe('Total Grams source — parseInventoryCode grams (mirrored by the SQL aggregate)', () => {
  it('well-formed codes: grams parsed from the code text', () => {
    expect(parseInventoryCode('ASB-E-3147 4.76g').grams).toBe('4.76');
    expect(parseInventoryCode('21K SBA-N-3674 22.80g 23"').grams).toBe('22.80');
    expect(parseInventoryCode('SBA-N-2683 1.80g 16"').grams).toBe('1.80');
    // leading-dot / leading-zero grams both parse
    expect(parseInventoryCode('BNA-R-2297 .98g "6"').grams).toBe('.98');
    expect(parseInventoryCode('SBA-P-3215 0.69g').grams).toBe('0.69');
  });

  it('codes with NO gram figure → null (they correctly contribute 0)', () => {
    expect(parseInventoryCode('BNA-B-2566').grams).toBeNull();
    expect(parseInventoryCode('BNA-B-3564 HK').grams).toBeNull();
    expect(parseInventoryCode('BNA-B-2533 K18 HK ITEM 37,500 "7"').grams).toBeNull();
  });

  it('malformed codes are summed LITERALLY — card matches the table row-for-row (Owner choice)', () => {
    // Stray "g" on the sequence number → the FIRST "Ng" match wins (real weight is 0.51g).
    expect(parseInventoryCode('BNA-P-2544g 0.51g EF').grams).toBe('2544');
    // Missing space mashes sequence into grams.
    expect(parseInventoryCode('ASB-P-2176.94g').grams).toBe('2176.94');
    // Space-for-dot typo → the "99g" fragment wins (real weight is 25.99g).
    expect(parseInventoryCode('SBA-N-2672 25 99g 24"22K').grams).toBe('99');
  });

  it('a genuinely heavy piece is NOT malformed — normal large weights still parse', () => {
    expect(parseInventoryCode('SBA-N-5409 98.72g 20" K18 JAPAN').grams).toBe('98.72');
  });
});
