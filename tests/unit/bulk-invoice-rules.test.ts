import { describe, expect, it } from 'vitest';

import {
  claimSkipReason,
  invoiceEligibility,
  invoiceSendState,
  matchesInvoiceFilter,
  reminderEligibility,
  type InvoiceRowFacts,
} from '@/lib/orders/bulk-invoice-rules';

/** Orders → For Invoice → Send Invoices: the rules the list, the send and the tests share. */

const facts = (over: Partial<InvoiceRowFacts> = {}): InvoiceRowFacts => ({
  orderStatus: 'invoiced',
  sendState: 'not_sent',
  chat: 'order',
  sameNameCount: 0,
  missing: [],
  itemCount: 1,
  reminderCount: 0,
  paidInFull: false,
  ...over,
});

describe('send state from the order message', () => {
  const now = Date.parse('2026-09-25T02:00:00Z');
  it('maps the stored statuses', () => {
    expect(invoiceSendState(null, null, now)).toBe('not_sent');
    expect(invoiceSendState('ready_to_copy_or_send', null, now)).toBe('not_sent');
    expect(invoiceSendState('direct_sent', null, now)).toBe('sent');
    expect(invoiceSendState('manually_sent', null, now)).toBe('sent');
    expect(invoiceSendState('direct_send_failed', null, now)).toBe('failed');
  });
  it('a claim is "sending" for 2 minutes, then "unconfirmed" (never re-sent automatically)', () => {
    expect(invoiceSendState('direct_send_pending', '2026-09-25T01:59:00Z', now)).toBe('sending');
    expect(invoiceSendState('direct_send_pending', '2026-09-25T01:57:00Z', now)).toBe('unconfirmed');
  });
});

describe('invoice eligibility = what the individual Send Invoice would send', () => {
  it('ready: For Invoice, stored chat, confirmed item, grams + price complete', () => {
    expect(invoiceEligibility(facts())).toEqual({ eligible: true, reason: null });
    expect(invoiceEligibility(facts({ sendState: 'failed' })).eligible).toBe(true); // retry is fine
  });
  it('never selectable: sent, sending, unconfirmed, no link, For Reminder', () => {
    expect(invoiceEligibility(facts({ sendState: 'sent' })).reason).toBe('Already sent');
    expect(invoiceEligibility(facts({ sendState: 'sending' })).eligible).toBe(false);
    expect(invoiceEligibility(facts({ sendState: 'unconfirmed' })).eligible).toBe(false);
    expect(invoiceEligibility(facts({ chat: null })).reason).toBe('No Facebook link');
    expect(invoiceEligibility(facts({ orderStatus: 'awaiting_required_payment' })).eligible).toBe(false);
  });
  it('incomplete invoice: waiting for confirmed item / grams + price', () => {
    expect(invoiceEligibility(facts({ itemCount: 0 })).reason).toBe('Waiting for confirmed item');
    expect(invoiceEligibility(facts({ missing: ['{price_per_gram}'] })).reason).toBe(
      'Waiting for Grams and Price Per Gram',
    );
    expect(invoiceEligibility(facts({ missing: null })).eligible).toBe(false);
  });
  it('ambiguous customer: a customer-default link with a same-name customer must be confirmed first', () => {
    expect(invoiceEligibility(facts({ chat: 'customer', sameNameCount: 1 })).eligible).toBe(false);
    expect(invoiceEligibility(facts({ chat: 'customer', sameNameCount: null })).eligible).toBe(false);
    expect(invoiceEligibility(facts({ chat: 'customer', sameNameCount: 0 })).eligible).toBe(true);
    // The ORDER's own confirmed chat is authoritative.
    expect(invoiceEligibility(facts({ chat: 'order', sameNameCount: 3 })).eligible).toBe(true);
  });
});

describe('reminder eligibility mirrors record_order_reminder', () => {
  it('sent + linked + unpaid → the next number', () => {
    expect(reminderEligibility(facts({ sendState: 'sent' }))).toEqual({
      eligible: true,
      reason: null,
      nextNumber: 1,
    });
    expect(reminderEligibility(facts({ sendState: 'sent', reminderCount: 2 })).nextNumber).toBe(3);
    expect(reminderEligibility(facts({ orderStatus: 'awaiting_required_payment' })).eligible).toBe(true);
  });
  it('refused: invoice not sent, no link, paid in full, unknown balance, all 3 sent', () => {
    expect(reminderEligibility(facts()).reason).toBe('Send the invoice first');
    expect(reminderEligibility(facts({ sendState: 'sent', chat: null })).eligible).toBe(false);
    expect(reminderEligibility(facts({ sendState: 'sent', paidInFull: true })).reason).toBe('Paid in full');
    expect(reminderEligibility(facts({ sendState: 'sent', paidInFull: null })).eligible).toBe(false);
    expect(reminderEligibility(facts({ sendState: 'sent', reminderCount: 3 })).eligible).toBe(false);
  });
});

describe('filter chips', () => {
  it('Not Sent (default) = unsent + linked; No Facebook Link = unsent + unlinked; Sent; All', () => {
    const unsentLinked = facts();
    const unsentUnlinked = facts({ chat: null });
    const sent = facts({ sendState: 'sent' });
    const reminderStage = facts({ orderStatus: 'awaiting_required_payment', chat: null });
    const inFilter = (f: InvoiceRowFacts) =>
      (['not_sent', 'sent', 'no_link', 'all'] as const).filter((k) => matchesInvoiceFilter(f, k));
    expect(inFilter(unsentLinked)).toEqual(['not_sent', 'all']);
    expect(inFilter(unsentUnlinked)).toEqual(['no_link', 'all']);
    expect(inFilter(sent)).toEqual(['sent', 'all']);
    expect(inFilter(reminderStage)).toEqual(['sent', 'all']);
  });
  it('claim answers read as plain reasons', () => {
    expect(claimSkipReason('already_sent')).toBe('Already sent');
    expect(claimSkipReason('in_progress')).toBe('Already being sent');
    expect(claimSkipReason('weird')).toBe('Could not start the send');
  });
});
