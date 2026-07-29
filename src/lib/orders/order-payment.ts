import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';

/**
 * Add a real received payment against an official order.
 * The guarded DB function `add_order_payment` is the authority: it recomputes the
 * remaining balance from SQL, blocks a zero/over-balance amount, records the payment
 * as verified + attributed (received_by, date, time), and returns the updated
 * figures. It NEVER changes the order's workflow status and NEVER auto-completes the
 * order — "Paid in Full" is a derived payment status only. Money crosses as strings.
 */
export type AddOrderPaymentInput = {
  orderId: string;
  amount: string;
  paymentDate: string | null;
  method: string | null;
  reference: string | null;
  notes: string | null;
  /** Legacy Down Payment / Deposit flag. The UI no longer offers a second button
   *  (Owner request, §4), so this stays optional and defaults to false; it is kept
   *  only so historical deposit rows keep their meaning. */
  isDeposit?: boolean;
};

export type AddOrderPaymentResult =
  | {
      ok: true;
      verifiedPaid: string;
      remaining: string;
      paidInFull: boolean;
      total: string;
    }
  | { ok: false; error: string };

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

function toStr(v: unknown): string {
  return typeof v === 'number' || typeof v === 'string' ? String(v) : '0';
}

export async function addOrderPayment(
  input: AddOrderPaymentInput,
): Promise<AddOrderPaymentResult> {
  if (!input.orderId) return { ok: false, error: 'An order is required.' };
  const amount = (input.amount ?? '').trim();
  if (!PRICE_RE.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: 'Enter a payment amount greater than zero.' };
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('add_order_payment', {
    p_order_id: input.orderId,
    p_amount: amount,
    p_payment_date: input.paymentDate,
    p_method: input.method,
    p_reference: input.reference,
    p_notes: input.notes,
    p_is_deposit: input.isDeposit === true,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};

  await recordAuditEvent({
    action: input.isDeposit === true ? 'order.add_deposit' : 'order.add_payment',
    entityType: 'official_order',
    entityId: input.orderId,
    context: { amount, paid_in_full: d.paid_in_full === true },
  });

  return {
    ok: true,
    verifiedPaid: toStr(d.verified_paid),
    remaining: toStr(d.remaining),
    paidInFull: d.paid_in_full === true,
    total: toStr(d.total),
  };
}
