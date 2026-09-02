import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { isHKItem } from '@/lib/inventory/hk-item';

/**
 * Grams + price-per-gram for an order, derived from its LINE ITEMS — one shared source
 * for the Order Summary and the Send-Invoice message so the two can never drift.
 *
 * Why derive (Owner 2026-09-01): the schema has NO structured price-per-gram field, and
 * `inventory_items.grams_per_piece` is NULL for ~every historical item — the weight lives
 * inside the `item_code` text (e.g. `ASB-E-3147 4.76g`), which the rest of the app parses.
 * So grams come from the item_code (the source the whole app already trusts, never the
 * message text and never a blind Total÷Grams on the order), and the rate comes from each
 * line's own total ÷ its own grams. For a single-rate order that recovers the EXACT entered
 * rate (e.g. 7811 ÷ 1.07 = ₱7,300); when lines disagree we report `mixedRates` and never
 * fabricate one number. This is NOT source-of-truth persistence — persisting the typed rate
 * is a separate additive migration — but it is exact for the common single-rate case.
 */
export type OrderLineForPricing = {
  itemCode: string | null;
  gramsPerPiece?: string | null;
  unitPrice?: string | null;
  quantity?: number | null;
};

export type OrderGramsPricing = {
  /** Σ (per-piece grams × qty). 0 when no line carries a resolvable weight. */
  totalGrams: number;
  /** True when at least one line has a resolvable per-piece grams value (⇒ grams-based). */
  hasGrams: boolean;
  /** The single whole-peso rate shared by every grams line; null when there is no grams
   *  line, no resolvable rate, or the lines carry different rates (see `mixedRates`). */
  pricePerGram: number | null;
  /** True when grams lines carry two or more distinct rates — never invent a single one. */
  mixedRates: boolean;
};

/** Per-piece grams for a line: the structured column when present, else parsed from the
 *  `item_code` text (grams_per_piece is NULL for ~all historical items). 0 when neither
 *  yields a positive weight — which is how a genuine Fixed-Price line reads here. */
export function lineGramsPerPiece(line: OrderLineForPricing): number {
  // HK ITEM is fixed-price — grams NEVER apply (Owner 2026-09-02 BR2), even if a stray "…g" token
  // sits in the code text or a legacy grams_per_piece is populated. Returning 0 here makes the Order
  // Summary and the Send-Invoice message suppress BOTH "Grams" and "Price Per Gram" for it (no
  // fabricated Total÷Grams rate) through the same single chokepoint.
  if (isHKItem({ code: line.itemCode ?? '' })) return 0;
  const direct = Number(line.gramsPerPiece);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const parsed = line.itemCode ? Number(parseInventoryCode(line.itemCode).grams) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function computeOrderGramsPricing(items: OrderLineForPricing[]): OrderGramsPricing {
  let totalGramsMilli = 0;
  let hasGrams = false;
  const rates = new Set<number>();
  for (const line of items) {
    const g = lineGramsPerPiece(line);
    if (g <= 0) continue; // no weight ⇒ treated as fixed-price for this line
    const qty = line.quantity && line.quantity > 0 ? line.quantity : 1;
    hasGrams = true;
    totalGramsMilli += Math.round(g * 1000) * qty;
    const price = Number(line.unitPrice);
    if (Number.isFinite(price) && price > 0) rates.add(Math.round(price / g)); // whole-peso rate
  }
  const distinct = [...rates];
  return {
    totalGrams: totalGramsMilli / 1000,
    hasGrams,
    pricePerGram: distinct.length === 1 ? (distinct[0] ?? null) : null,
    mixedRates: distinct.length > 1,
  };
}

/** The Total-Grams display string: `1.07g`, or `—` when the order carries no weight. */
export function formatTotalGrams(p: OrderGramsPricing): string {
  return p.hasGrams ? `${Math.round(p.totalGrams * 1000) / 1000}g` : '—';
}

/** The numeric total grams as a plain string (`1.07`), or `''` when there is none —
 *  the `{grams}` token value (the message body supplies the trailing "g"). */
export function gramsTokenValue(p: OrderGramsPricing): string {
  return p.hasGrams ? String(Math.round(p.totalGrams * 1000) / 1000) : '';
}
