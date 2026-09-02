import { isCashMethod } from '@/lib/payments/methods';

/**
 * Walk-In CASH CHANGE (Owner 2026-09-02).
 *
 * CASH may be tendered ABOVE the sale balance — the excess is CHANGE returned to the customer
 * on the spot. Change is NEVER revenue, credit, overpayment, or an extra order payment. Non-cash
 * methods (GCash, Bank Transfer, Card, …) must NEVER overpay — only cash may exceed.
 *
 * This is the single source of truth for the split, used by BOTH the walk-in form's read-out and
 * its save payload so the displayed change and the persisted (applied) amount can never disagree:
 *   applied = min(tendered, total)     ← what is stored as payment / counted as revenue
 *   change  = max(0, tendered − total) ← cash returned; never persisted as a payment
 * The per-pay `applied` caps the CASH rows (filling the room left after non-cash) so the saved
 * payments sum to `appliedCentavos` — which also keeps the existing within-balance DB guard happy
 * without any schema change. All money is integer centavos (BigInt); nothing floats.
 */
export type WalkInPayLite = { method: string; amountCentavos: bigint };

export type WalkInCashSplit = {
  /** Sum of every entered payment (gross cash in the till + non-cash). Shown as "Total Paid". */
  tenderedCentavos: bigint;
  /** Sum of the non-cash payments (these may not exceed the total). */
  nonCashCentavos: bigint;
  /** min(tendered, total) — the amount actually applied to the sale (revenue). */
  appliedCentavos: bigint;
  /** max(0, tendered − total) — cash change returned to the customer (never revenue). */
  changeCentavos: bigint;
  /** Per-pay applied amount, index-aligned with the input: non-cash as-is, cash capped so the
   *  sum equals `appliedCentavos`. A pure-change cash row applies 0 and should not be persisted. */
  applied: bigint[];
  /** True when the non-cash payments alone exceed the total — the caller must BLOCK this
   *  (only cash may exceed). */
  nonCashOverpays: boolean;
};

export function walkInCashSplit(
  pays: readonly WalkInPayLite[],
  totalCentavos: bigint,
): WalkInCashSplit {
  const tendered = pays.reduce((c, p) => c + p.amountCentavos, 0n);
  const nonCash = pays.reduce(
    (c, p) => c + (isCashMethod(p.method) ? 0n : p.amountCentavos),
    0n,
  );
  const appliedCentavos = tendered > totalCentavos ? totalCentavos : tendered;
  const changeCentavos = tendered > totalCentavos ? tendered - totalCentavos : 0n;

  // Cash fills the room left after non-cash, in order; the overflow is change.
  let cashRoom = totalCentavos - nonCash;
  if (cashRoom < 0n) cashRoom = 0n;
  const applied = pays.map((p) => {
    if (!isCashMethod(p.method)) return p.amountCentavos;
    const use = p.amountCentavos <= cashRoom ? p.amountCentavos : cashRoom;
    cashRoom -= use;
    return use;
  });

  return {
    tenderedCentavos: tendered,
    nonCashCentavos: nonCash,
    appliedCentavos,
    changeCentavos,
    applied,
    nonCashOverpays: nonCash > totalCentavos,
  };
}
