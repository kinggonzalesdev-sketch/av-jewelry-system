import 'server-only';

/**
 * Shop-level message settings for the invoice message (Bible §15, §26).
 *
 * The downpayment / payment details that go into the customer's invoice message
 * are business-specific (GCash number, bank, downpayment rule), so they are NOT
 * hard-coded — they come from server env `SHOP_PAYMENT_DETAILS`. Until the Owner
 * sets it, the message stays HONEST: it asks the customer to message for details
 * rather than printing a fake number.
 */
export function shopPaymentDetails(): string {
  const configured = process.env.SHOP_PAYMENT_DETAILS?.trim();
  return configured && configured.length > 0
    ? configured
    : 'Please message us here for your downpayment details.';
}
