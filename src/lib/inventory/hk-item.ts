/**
 * "HK ITEM" detection — the one reusable rule shared by every pricing surface.
 *
 * An HK ITEM is a fixed-price catalogue piece: it must ALWAYS price at its saved
 * catalogue price (inventory_items.total_price_per_piece), never per-gram, and the
 * price written inside the item name is never the source of truth. Detection is
 * case-insensitive and tolerant of spacing ("HK ITEM", "Hk Item", "hkitem"), and
 * scans BOTH the item code and the item name.
 *
 * Pure and dependency-free so the client pricing UI and any server check use the
 * exact same rule.
 */

const HK_ITEM_RE = /hk\s*item/i;

/** Any inventory-item-ish shape the pricing UIs pass around, or a raw string. */
export type HKItemInput =
  | string
  | {
      code?: string | null;
      name?: string | null;
      itemCode?: string | null;
      itemName?: string | null;
    }
  | null
  | undefined;

export function isHKItem(item: HKItemInput): boolean {
  if (!item) return false;
  const text =
    typeof item === 'string'
      ? item
      : [item.code, item.name, item.itemCode, item.itemName]
          .filter((v): v is string => Boolean(v))
          .join(' ');
  return HK_ITEM_RE.test(text);
}
