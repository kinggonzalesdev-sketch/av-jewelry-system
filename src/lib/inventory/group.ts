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
