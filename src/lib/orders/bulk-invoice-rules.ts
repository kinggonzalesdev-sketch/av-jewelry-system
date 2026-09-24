/**
 * The rules of Orders → For Invoice → "Send Invoices" (Owner 2026-09-25), as pure functions so
 * the list, the server re-check before each send, and the tests share ONE definition.
 *
 * Nothing here is a second definition of the invoice: a row is ready only when the individual
 * Send Invoice would send it — the order is in For Invoice, the invoice renders with no missing
 * Grams / Price Per Gram (invoiceMissingTokens, the same rule sendOrderInvoice blocks on), and
 * the order has a STORED chat on the active page (never a customer matched by name).
 */

/** Where a sent/unsent invoice stands, from the order's customer_messages row. */
export type InvoiceSendState = 'not_sent' | 'failed' | 'sending' | 'unconfirmed' | 'sent';

/** How long a claimed send may run before it is treated as unconfirmed (matches the database). */
export const INVOICE_SEND_LEASE_MS = 2 * 60 * 1000;

export function invoiceSendState(
  messageStatus: string | null,
  messageUpdatedAt: string | null,
  now: number,
): InvoiceSendState {
  switch (messageStatus) {
    case 'direct_sent':
    case 'manually_sent':
      return 'sent';
    case 'direct_send_failed':
      return 'failed';
    case 'direct_send_pending': {
      const at = messageUpdatedAt ? Date.parse(messageUpdatedAt) : NaN;
      return Number.isFinite(at) && now - at < INVOICE_SEND_LEASE_MS ? 'sending' : 'unconfirmed';
    }
    default:
      return 'not_sent';
  }
}

/** The facts one row is judged on (loaded in batches, never one query per row). */
export type InvoiceRowFacts = {
  /** official_orders.status: 'invoiced' (For Invoice) or 'awaiting_required_payment'
   *  (the retired For Reminder status, still shown under For Invoice). */
  orderStatus: string;
  sendState: InvoiceSendState;
  /** Which STORED on-page chat Send Invoice would use: the order's own, the customer's, none. */
  chat: 'order' | 'customer' | null;
  /** Other active customers with exactly this name (null = not checked). */
  sameNameCount: number | null;
  /** Missing invoice tokens (Grams / Price Per Gram); null = the invoice could not be checked. */
  missing: string[] | null;
  itemCount: number;
  reminderCount: number;
  /** From the database balance; null = the balance could not be read. */
  paidInFull: boolean | null;
};

export type Verdict = { eligible: boolean; reason: string | null };

/** May this invoice be selected for "Send Selected"? */
export function invoiceEligibility(f: InvoiceRowFacts): Verdict {
  if (f.orderStatus !== 'invoiced') {
    return { eligible: false, reason: 'Invoice already handled (For Reminder)' };
  }
  switch (f.sendState) {
    case 'sent':
      return { eligible: false, reason: 'Already sent' };
    case 'sending':
      return { eligible: false, reason: 'Sending now' };
    case 'unconfirmed':
      return { eligible: false, reason: 'Send not confirmed — check the chat, then use the order' };
    default:
      break;
  }
  if (!f.chat) return { eligible: false, reason: 'No Facebook link' };
  if (f.chat === 'customer' && f.sameNameCount !== 0) {
    return {
      eligible: false,
      reason:
        f.sameNameCount === null
          ? 'Confirm the customer from the order first'
          : 'Same name as another customer — confirm from the order first',
    };
  }
  if (f.itemCount === 0) return { eligible: false, reason: 'Waiting for confirmed item' };
  if (f.missing === null) return { eligible: false, reason: 'Invoice could not be checked' };
  if (f.missing.length > 0) {
    return { eligible: false, reason: 'Waiting for Grams and Price Per Gram' };
  }
  return { eligible: true, reason: null };
}

/** The most reminders an order can get (the database enforces the same 1..3). */
export const MAX_REMINDERS = 3;

/** May this order get its next reminder? Mirrors record_order_reminder's rules. */
export function reminderEligibility(f: InvoiceRowFacts): Verdict & { nextNumber: number | null } {
  const no = (reason: string) => ({ eligible: false, reason, nextNumber: null });
  const invoiceSent = f.orderStatus === 'awaiting_required_payment' || f.sendState === 'sent';
  if (!invoiceSent) return no('Send the invoice first');
  if (!f.chat) return no('No Facebook link');
  if (f.paidInFull === null) return no('Balance could not be read');
  if (f.paidInFull) return no('Paid in full');
  if (f.reminderCount >= MAX_REMINDERS) return no(`All ${MAX_REMINDERS} reminders sent`);
  return { eligible: true, reason: null, nextNumber: f.reminderCount + 1 };
}

export type InvoiceFilter = 'not_sent' | 'sent' | 'no_link' | 'all';

export const INVOICE_FILTERS: ReadonlyArray<{ key: InvoiceFilter; label: string }> = [
  { key: 'not_sent', label: 'Not Sent' },
  { key: 'sent', label: 'Sent' },
  { key: 'no_link', label: 'No Facebook Link' },
  { key: 'all', label: 'All' },
];

/** Which filter chips a row belongs to (All always). */
export function matchesInvoiceFilter(
  f: Pick<InvoiceRowFacts, 'orderStatus' | 'sendState' | 'chat'>,
  filter: InvoiceFilter,
): boolean {
  const sent = f.orderStatus === 'awaiting_required_payment' || f.sendState === 'sent';
  switch (filter) {
    case 'all':
      return true;
    case 'sent':
      return sent;
    case 'no_link':
      return !sent && !f.chat;
    case 'not_sent':
      return !sent && Boolean(f.chat);
  }
}

/** One row's outcome after a bulk send or reminder. */
export type BulkRowOutcome = {
  orderId: string;
  outcome: 'sent' | 'failed' | 'skipped';
  /** A short human reason (never a raw API error). */
  reason: string | null;
};

/** The claim answer → a skip reason the Owner understands. */
export function claimSkipReason(claim: string): string {
  switch (claim) {
    case 'already_sent':
      return 'Already sent';
    case 'in_progress':
      return 'Already being sent';
    case 'unconfirmed':
      return 'Earlier send not confirmed — check the chat';
    case 'not_for_invoice':
      return 'No longer in For Invoice';
    case 'not_found':
      return 'Order not found';
    default:
      return 'Could not start the send';
  }
}
