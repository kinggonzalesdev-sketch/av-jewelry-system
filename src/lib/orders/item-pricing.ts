/**
 * Shared exact-centavo pricing math for an order item row — the ONE implementation used
 * by BOTH the New-Order form (`new-order-workflow.tsx`) and the "Add items to this order"
 * panel (`order-item-edit.tsx`). Keeping a single copy guarantees the two forms compute
 * an item's price identically (money correctness), so a piece priced in one place can
 * never disagree with the other.
 *
 * All money is computed in integer centavos with BigInt — never a JS float — and grams
 * in integer milligrams, so grams × price-per-gram rounds to the nearest centavo
 * deterministically.
 */

/** A price string the forms accept: up to 12 whole digits + up to 2 decimals. */
export const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * The pricing-relevant fields of an item row. Both the New-Order `Row` and the Add-panel
 * `AddRow` are structural supertypes of this, so either can be passed directly.
 */
export type PricingRow = {
  priceMode: 'fixed' | 'per_gram';
  /** Fixed-price amount (raw). */
  price: string;
  /** Price-per-gram rate (raw); the total is grams × rate. */
  perGram: string;
  /** Grams override (raw). Empty = fall back to the item's own grams. */
  grams: string;
};

/** Anything carrying an item's own weight — a `PickItem`, or a normalized capture item. */
export type GramsCarrier = { grams: string | null } | null | undefined;

/** Raw price string → exact centavos (never a float). '' / invalid → 0. */
export function priceCentavos(raw: string): bigint {
  const s = (raw ?? '').trim();
  if (!PRICE_RE.test(s)) return 0n;
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w || '0') * 100n + BigInt(`${f}00`.slice(0, 2) || '0');
}

export function centavosToStr(c: bigint): string {
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}

/** Total from Price Per Gram × grams, in EXACT integer units: grams → milligrams
 *  (×1000), rate → centavos (×100), total centavos = rateCentavos × gramsMilli /
 *  1000, rounded to the nearest centavo. */
export function perGramTotalCentavos(grams: string, perGram: string): bigint {
  const g = (grams ?? '').trim();
  const pg = (perGram ?? '').trim();
  if (!/^\d*\.?\d*$/.test(g) || !PRICE_RE.test(pg)) return 0n;
  const [gw = '0', gf = ''] = g.split('.');
  const gramsMilli = BigInt(gw || '0') * 1000n + BigInt(`${gf}000`.slice(0, 3) || '0');
  const rateCentavos = priceCentavos(pg);
  if (gramsMilli === 0n || rateCentavos === 0n) return 0n;
  return (rateCentavos * gramsMilli + 500n) / 1000n;
}

/** The grams actually used for a row: the typed override when set, else the item's own
 *  grams. Fixed-price rows ignore grams entirely. */
export function effectiveGrams(r: Pick<PricingRow, 'grams'>, item: GramsCarrier): string {
  const override = (r.grams ?? '').trim();
  return override || item?.grams || '';
}

/** A row's total price (one unique item — no quantity): the Fixed Price, or the
 *  computed grams × price-per-gram. */
export function rowTotalCentavos(r: PricingRow, item: GramsCarrier): bigint {
  return r.priceMode === 'per_gram'
    ? perGramTotalCentavos(effectiveGrams(r, item), r.perGram)
    : priceCentavos(r.price);
}
