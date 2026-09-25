import {
  perGramTotalCentavos,
  priceCentavos,
  PRICE_RE,
  type LinePricing,
} from '@/lib/orders/item-pricing';

/**
 * Does a line's pricing snapshot agree with its price? (Owner 2026-09-26.) The database refuses a
 * mismatch too (app_private.apply_line_pricing); checking here first turns it into a clear message
 * instead of a failed save. Per-gram: the price must be EXACTLY grams × rate at the form's own
 * rounding (the nearest centavo). Fixed: any valid price.
 */
export function validLinePricing(p: LinePricing, unitPrice: string): boolean {
  if (!p || typeof p !== 'object') return false;
  if (p.mode === 'fixed') return true;
  if (p.mode !== 'per_gram') return false;
  // Text only (a JSON number from a non-UI caller is refused cleanly, never crashes the parser).
  if (typeof p.price_per_gram !== 'string' || typeof p.grams !== 'string') return false;
  if (!PRICE_RE.test(p.price_per_gram) || !/^\d{1,9}(\.\d{1,3})?$/.test(p.grams))
    return false;
  const total = perGramTotalCentavos(p.grams, p.price_per_gram);
  return total > 0n && total === priceCentavos(unitPrice);
}
