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

/** Reads the approved balance figures for one Official Order. */
export async function getOrderBalance(
  officialOrderId: string,
): Promise<OrderBalance | null> {
  const supabase = await createClient();
  const response = await supabase.rpc('order_balance', { p_order_id: officialOrderId });

  if (response.error || response.data === null) return null;

  const raw = response.data as Record<string, unknown>;

  return {
    totalAmountPayable: String(raw.total_amount_payable),
    verifiedNetPayments: String(raw.verified_net_payments),
    outstandingBalance: String(raw.outstanding_balance),
    overpaymentCredit: String(raw.overpayment_credit),
    paidInFull: raw.paid_in_full === true,
    layawayAmountPayable: String(raw.layaway_amount_payable),
    requiredDownPayment: String(raw.required_down_payment),
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
