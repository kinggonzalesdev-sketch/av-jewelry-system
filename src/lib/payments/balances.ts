import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Order money (Bible §16, §17 — see docs/PHASE-6-APPROVED-DECISIONS.md).
 *
 * ⚠️  THIS MODULE COMPUTES NOTHING. Every figure comes from the database
 *     functions, which are the single implementation of the approved formulas.
 *     A second copy in TypeScript could drift from the SQL, and drift here
 *     decides whether a customer is told they still owe money.
 *
 * Money crosses the wire as a STRING and is kept as a string. Postgres numeric
 * is exact; JavaScript `number` is a float, and 0.1 + 0.2 !== 0.3. Parsing a
 * peso amount into a float to render it is how rounding errors reach an invoice.
 */

export type OrderBalance = {
  /** Item total + approved layaway fee + approved charges − approved discounts. */
  totalAmountPayable: string;
  /** Verified payments only. Never evidence, rejected, voided, reversed, or under correction. */
  verifiedNetPayments: string;
  /** max(payable − verified, 0). Never negative. */
  outstandingBalance: string;
  /** The verified excess, when payments exceed the payable amount. */
  overpaymentCredit: string;
  paidInFull: boolean;
  layawayAmountPayable: string;
  requiredDownPayment: string;
};

/**
 * The outcome of a balance read.
 *
 * ⚠️  THERE IS NO "ZERO ON FAILURE" HERE, DELIBERATELY.
 *
 * This type used to be `OrderBalance | null`, and every caller mapped the null
 * to '0.00'. A denied read therefore rendered as ₱0.00 — indistinguishable from
 * an order that is genuinely paid off. That is the worst possible failure mode
 * for money: it does not look like an error, it looks like an ANSWER, and the
 * answer it gives is "this customer owes nothing".
 *
 * It shipped exactly that way. A missing SELECT privilege on
 * official_order_charges made order_balance() throw for every Staff caller, and
 * the UI showed ₱0.00 against orders worth thousands (fixed in migration
 * 20260716210000). The null was silent; the zero was confident.
 *
 * So the failure is now explicit and callers must handle it. A balance that
 * cannot be read is UNAVAILABLE — never zero.
 */
export type OrderBalanceResult =
  { ok: true; balance: OrderBalance } | { ok: false; reason: string };

/**
 * Reads the approved balance figures for one Official Order.
 *
 * Every figure comes from the database function, which is SECURITY INVOKER —
 * so a caller can only read money for an order they are already allowed to see.
 * This module computes nothing.
 */
export async function getOrderBalance(
  officialOrderId: string,
): Promise<OrderBalanceResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('order_balance', { p_order_id: officialOrderId });

  if (response.error) {
    // Surfaces the database's own refusal rather than replacing it with a
    // generic message — a denial and an outage are different facts.
    return { ok: false, reason: response.error.message };
  }

  if (response.data === null || response.data === undefined) {
    return { ok: false, reason: 'That order has no balance record.' };
  }

  const raw = response.data as Record<string, unknown>;

  // A present row with a missing figure is still a failed read. Returning
  // String(undefined) === 'undefined' into a peso field, or silently coercing
  // it to zero, would reintroduce the exact defect this type exists to prevent.
  for (const field of [
    'total_amount_payable',
    'verified_net_payments',
    'outstanding_balance',
    'overpayment_credit',
  ] as const) {
    const value = raw[field];
    if (typeof value !== 'string' && typeof value !== 'number') {
      return { ok: false, reason: `The balance is incomplete (${field} is missing).` };
    }
  }

  return {
    ok: true,
    balance: {
      totalAmountPayable: String(raw.total_amount_payable),
      verifiedNetPayments: String(raw.verified_net_payments),
      outstandingBalance: String(raw.outstanding_balance),
      overpaymentCredit: String(raw.overpayment_credit),
      paidInFull: raw.paid_in_full === true,
      layawayAmountPayable: String(raw.layaway_amount_payable),
      requiredDownPayment: String(raw.required_down_payment),
    },
  };
}

/**
 * Duplicate transaction/reference numbers awaiting review.
 *
 * Flagged, never auto-rejected (approved decision §3): rejecting the second
 * payment outright would hide the collision instead of surfacing it.
 */
export async function listDuplicateReferences(): Promise<
  Array<{ referenceNumber: string; paymentCount: number }>
> {
  const supabase = await createClient();
  const response = await supabase.rpc('duplicate_payment_references');

  const error = response.error;
  const data: unknown = response.data;

  if (error || !data) return [];

  return (data as Array<{ reference_number: string; payment_count: number }>).map(
    (row) => ({
      referenceNumber: row.reference_number,
      paymentCount: Number(row.payment_count),
    }),
  );
}
