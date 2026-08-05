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

function hkText(item: HKItemInput): string {
  if (!item) return '';
  return typeof item === 'string'
    ? item
    : [item.code, item.name, item.itemCode, item.itemName]
        .filter((v): v is string => Boolean(v))
        .join(' ');
}

export function isHKItem(item: HKItemInput): boolean {
  return HK_ITEM_RE.test(hkText(item));
}

/**
 * The fixed price of an HK ITEM, read from the text that follows "HK ITEM" in the
 * code/name. Whatever number is written there IS the price — e.g.
 *   BNA-B-2536 K18 HK ITEM 9,600 "16"  →  "9600"
 * The quoted number ("16") is the SIZE and the `Ng` token is grams; both are
 * stripped so they can never be mistaken for the price. Thousands commas are
 * removed. Returns null when no price is written (the caller then falls back to the
 * inventory catalogue price). Returns null for a non-HK item.
 */
export function hkFixedPrice(item: HKItemInput): string | null {
  if (!isHKItem(item)) return null;
  const m = HK_ITEM_RE.exec(hkText(item));
  if (!m) return null;
  const after = hkText(item)
    .slice(m.index + m[0].length)
    // Sizes are numbers tied to an inch mark: "16"  16"  6-7"  "6-7"
    .replace(/"?\d+(?:-\d+)?"/g, ' ')
    // Grams: 5.5g  .5 g
    .replace(/\d*\.?\d+\s*g\b/gi, ' ');
  const pm = /(\d[\d,]*(?:\.\d+)?)/.exec(after);
  if (!pm) return null;
  const price = (pm[1] ?? '').replace(/,/g, '');
  return /^\d{1,12}(\.\d{1,2})?$/.test(price) ? price : null;
}
