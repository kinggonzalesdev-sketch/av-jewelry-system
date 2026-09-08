import { DEFAULT_CONDITIONS } from '@/lib/inventory/code-parser';
import { isHKItem } from '@/lib/inventory/hk-item';

/**
 * The inventory GROUP an item belongs to (§16). Pure + shared so the table, counts,
 * filter, and any future dropdown all group the same way:
 *   - code/name contains "HK ITEM"          → "HK ITEM"
 *   - starts with a known condition prefix   → that prefix (BN, SB, EF, …)
 *   - anything else                          → "Other"
 * A new/edited item lands in the right group automatically once its code changes
 * (e.g. BN-A-1001 → SB-A-1001 moves from BN to SB).
 */
const KNOWN_PREFIXES = new Set(Object.keys(DEFAULT_CONDITIONS));

export function inventoryGroup(
  itemCode: string | null | undefined,
  itemName?: string | null,
): string {
  const code = (itemCode ?? '').trim();
  if (isHKItem({ code, name: itemName ?? null })) return 'HK ITEM';
  const prefix = code
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 2)
    .toUpperCase();
  return KNOWN_PREFIXES.has(prefix) ? prefix : 'Other';
}

/**
 * Map an EXACT free-text search to a canonical inventory group (Owner 2026-09-08).
 *
 * Group counts, the group dropdown, and the group filter all classify with {@link inventoryGroup};
 * free-text search, by contrast, is a broad substring match on code+name. So typing "hk" used to
 * return every row whose code or name merely CONTAINS the letters "hk" (245) rather than the
 * HK ITEM group (226) — the 19-row mismatch. This resolves a query that, once normalized, IS a
 * recognized group name/alias to that canonical group, so "hk" means "the HK ITEM group". Only an
 * EXACT match resolves: a longer query (an item code, a size, "HK ITEM 7", "2533") is NOT an alias
 * and stays ordinary substring search, so real code searches are unaffected.
 *
 * Recognized: "hk" / "hk item" / "hkitem" → HK ITEM; "other" → Other; and any KNOWN condition
 * prefix typed on its own (bn, sb, ef, …) → that group. A non-prefix like "bm" is NOT a group and
 * returns null (normal search) — BN and BM are never treated as interchangeable.
 *
 * Returns the canonical group, or null when the query is not an exact group term.
 */
export function groupSearchAlias(query: string | null | undefined): string | null {
  const n = (query ?? '').trim().toLowerCase();
  if (!n) return null;
  if (n === 'hk' || n === 'hk item' || n === 'hkitem') return 'HK ITEM';
  if (n === 'other') return 'Other';
  // A known condition prefix on its own (BN / SB / EF …) means that group — and ONLY a real prefix,
  // so "bm" (not a known condition) falls through to normal search.
  const upper = n.toUpperCase();
  return KNOWN_PREFIXES.has(upper) ? upper : null;
}
