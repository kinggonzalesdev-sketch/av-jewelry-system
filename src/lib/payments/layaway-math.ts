/**
 * Layaway money math — the ONE shared formula (Owner rule). Interest is per-gram,
 * per-MONTH, charged for the whole term:
 *
 *   monthlyInterest = totalGrams × ₱150         (unchanged rule)
 *   totalInterest   = monthlyInterest × term    (1, 2 or 3 months)
 *   grandTotal      = itemTotal + totalInterest
 *   balance         = grandTotal − payment
 *
 * Every amount is exact integer CENTAVOS (bigint) — money is never a JS float. The
 * Set-Up-Layaway modal and the create_layaway_from_order database function both apply
 * this same formula, so the on-screen preview and the saved record always agree.
 */

export type LayawaySetupFigures = {
  monthlyInterest: bigint;
  totalInterest: bigint;
  grandTotal: bigint;
  balance: bigint;
};

/** A term is 1, 2 or 3 months; anything else falls back to 1 (a single month). */
export function normalizeLayawayTerm(term: number): number {
  return term === 2 || term === 3 ? term : 1;
}

export function layawaySetupFigures(input: {
  /** Item total in centavos (the order amount placed on layaway). */
  itemCentavos: bigint;
  /** Monthly interest in centavos (grams × ₱150), already computed / 0 for no-interest. */
  monthlyInterestCentavos: bigint;
  /** Selected term in months. */
  term: number;
  /** Payment / down-payment in centavos. */
  paymentCentavos: bigint;
}): LayawaySetupFigures {
  const term = normalizeLayawayTerm(input.term);
  const totalInterest = input.monthlyInterestCentavos * BigInt(term);
  const grandTotal = input.itemCentavos + totalInterest;
  return {
    monthlyInterest: input.monthlyInterestCentavos,
    totalInterest,
    grandTotal,
    balance: grandTotal - input.paymentCentavos,
  };
}
