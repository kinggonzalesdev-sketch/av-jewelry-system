import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Orders → For Invoice → Send Invoices, server side (Owner 2026-09-25): the batched list and the
 * per-row send / reminder around the UNCHANGED individual Send Invoice (sendOrderInvoice) and
 * sendOrderReminder. The database is a small in-memory stand-in; the claim RPCs are scripted.
 */
vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const H = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>,
    fromCalls: [] as string[],
    rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    claim: 'claimed' as unknown,
    claimError: null as null | { code: string; message: string },
    items: new Map<string, Array<{ itemCode: string | null; unitPrice: string | null; quantity: number }>>(),
    paid: new Set<string>(),
    sendResult: {
      ok: true,
      pancake: { attempted: true, delivered: true, error: null as string | null, reason: null as string | null },
    } as unknown,
    reminderResult: { ok: true, pancake: { attempted: true, delivered: true, error: null } } as unknown,
  };
  return state;
});

/** A cell as text (strings as-is, anything else as JSON). */
const txt = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

function table(name: string) {
  H.fromCalls.push(name);
  let rows = [...(H.tables[name] ?? [])];
  let cap = Infinity;
  const b: Record<string, unknown> = {};
  const get = (r: Row, path: string) => r[path.split('.').pop() as string];
  Object.assign(b, {
    select: () => b,
    eq: (c: string, v: unknown) => ((rows = rows.filter((r) => get(r, c) === v)), b),
    is: (c: string, v: unknown) => ((rows = rows.filter((r) => (get(r, c) ?? null) === v)), b),
    in: (c: string, vs: unknown[]) => ((rows = rows.filter((r) => vs.includes(get(r, c)))), b),
    ilike: (c: string, p: string) => {
      const needle = p.split('%').join('').toLowerCase();
      rows = rows.filter((r) => txt(get(r, c)).toLowerCase().includes(needle));
      return b;
    },
    or: (expr: string) => {
      // display_name.ilike."NAME",… → case-insensitive exact match on any name
      const names = [...expr.matchAll(/"([^"]*)"/g)].map((m) => (m[1] ?? '').toLowerCase());
      rows = rows.filter((r) => names.includes(txt(r.display_name).toLowerCase()));
      return b;
    },
    order: (c: string, o: { ascending: boolean }) => {
      rows.sort((a, z) => (o.ascending ? 1 : -1) * txt(a[c]).localeCompare(txt(z[c])));
      return b;
    },
    limit: (n: number) => ((cap = n), b),
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows.slice(0, cap), error: null }).then(ok),
  });
  return b;
}

vi.mock('@/lib/authz/guard', () => ({ requirePermission: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: (t: string) => table(t),
      rpc: (fn: string, args: Record<string, unknown>) => {
        H.rpcCalls.push({ fn, args });
        if (fn === 'claim_order_invoice_send') {
          return Promise.resolve(
            H.claimError ? { data: null, error: H.claimError } : { data: H.claim, error: null },
          );
        }
        return Promise.resolve({ data: 'ok', error: null });
      },
    }),
  ),
}));
vi.mock('@/lib/integrations/pancake', () => ({
  getActivePancakePageId: () => Promise.resolve('PAGE'),
  conversationBelongsToPage: (id: string | null | undefined, page: string) =>
    Boolean((id ?? '').trim()) && (id ?? '').startsWith(`${page}_`),
}));
vi.mock('@/lib/messaging/templates', () => ({
  getTemplateBody: () => Promise.resolve('Grams: {grams}\nPrice Per gram: {price_per_gram}'),
  // The real rule: a grams order needs one rate; a fixed-price order needs nothing.
  invoiceMissingTokens: (_b: string, gp: { hasGrams: boolean; pricePerGram: number | null; mixedRates: boolean }) =>
    gp.hasGrams && gp.pricePerGram == null && !gp.mixedRates ? ['{price_per_gram}'] : [],
  renderOrderMessage: vi.fn(() => Promise.resolve({ ok: true, message: 'Reminder text', missing: [] })),
}));
vi.mock('@/lib/orders/service', () => ({
  getOrderLineItemsByOrder: (ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, H.items.get(id) ?? []]))),
}));
vi.mock('@/lib/payments/balances', () => ({
  getOrderBalances: (ids: string[]) =>
    Promise.resolve(new Map(ids.map((id) => [id, { ok: true, balance: { paidInFull: H.paid.has(id) } }]))),
}));
vi.mock('@/lib/orders/for-invoice', () => ({
  sendOrderInvoice: vi.fn(() => Promise.resolve(H.sendResult)),
  sendOrderReminder: vi.fn(() => Promise.resolve(H.reminderResult)),
}));

import { renderOrderMessage } from '@/lib/messaging/templates';
import { listInvoiceSendRows, sendInvoiceInBulk, sendReminderInBulk } from '@/lib/orders/bulk-invoice';
import { sendOrderInvoice, sendOrderReminder } from '@/lib/orders/for-invoice';

let seq = 0;
function order(opts: {
  id: string;
  name?: string;
  status?: string;
  orderChat?: string | null;
  customerChat?: string | null;
  customerId?: string;
  ready?: boolean;
}) {
  const customerId = opts.customerId ?? `cust-${opts.id}`;
  const name = opts.name ?? `Customer ${opts.id}`;
  (H.tables.official_orders ??= []).push({
    id: opts.id,
    status: opts.status ?? 'invoiced',
    customer_id: customerId,
    fulfillment_destination: null,
    fb_pancake_conversation_id: opts.orderChat === undefined ? `PAGE_${opts.id}` : opts.orderChat,
    created_at: `2026-09-2${(seq += 1) % 10}T00:00:${String(seq).padStart(2, '0')}Z`,
    customers: { display_name: name, pancake_conversation_id: opts.customerChat ?? null },
  });
  (H.tables.customers ??= []).push({ id: customerId, display_name: name, is_active: true });
  H.items.set(opts.id, [
    opts.ready === false
      ? { itemCode: 'GLD 1.5g', unitPrice: null, quantity: 1 } // grams but no price → incomplete
      : { itemCode: 'GLD 1.5g', unitPrice: '9000', quantity: 1 },
  ]);
}
function message(orderId: string, status: string, extra: Row = {}) {
  (H.tables.customer_messages ??= []).push({
    official_order_id: orderId,
    status,
    updated_at: new Date().toISOString(),
    created_at: '2026-09-24T00:00:00Z',
    auto_sent_at: status === 'direct_sent' ? '2026-09-24T14:20:00Z' : null,
    manually_sent_at: null,
    body: '',
    ...extra,
  });
}

beforeEach(() => {
  H.tables = { official_orders: [], customers: [], customer_messages: [], order_reminders: [] };
  H.fromCalls = [];
  H.rpcCalls = [];
  H.claim = 'claimed';
  H.claimError = null;
  H.items = new Map();
  H.paid = new Set();
  H.sendResult = { ok: true, pancake: { attempted: true, delivered: true, error: null, reason: null } };
  H.reminderResult = { ok: true, pancake: { attempted: true, delivered: true, error: null } };
  vi.mocked(sendOrderInvoice).mockClear();
  vi.mocked(sendOrderReminder).mockClear();
  seq = 0;
});

describe('the Send Invoices list', () => {
  it('Test 1/2/3: 5 ready + 2 no-link + 1 sent + 1 For Reminder → chips 5 / 2 / 2 / 9; default Not Sent', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) order({ id });
    order({ id: 'f', orderChat: null });
    order({ id: 'g', orderChat: null });
    order({ id: 'h' });
    message('h', 'direct_sent');
    order({ id: 'i', status: 'awaiting_required_payment' });

    const list = await listInvoiceSendRows({});
    expect(list.counts).toEqual({ not_sent: 5, sent: 2, no_link: 2, all: 9 });
    expect(list.rows.map((r) => r.orderId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(list.rows.every((r) => r.invoice.eligible)).toBe(true);

    const noLink = await listInvoiceSendRows({ filter: 'no_link' });
    expect(noLink.rows.map((r) => [r.orderId, r.invoice.eligible, r.invoice.reason])).toEqual([
      ['f', false, 'No Facebook link'],
      ['g', false, 'No Facebook link'],
    ]);
    const sent = await listInvoiceSendRows({ filter: 'sent' });
    const h = sent.rows.find((r) => r.orderId === 'h');
    expect(h?.invoice).toEqual({ eligible: false, reason: 'Already sent' });
    expect(h?.sentAt).toBe('2026-09-24T14:20:00Z');
    expect(h?.reminder.eligible).toBe(true);
  });

  it('confirmed-item rule: an incomplete grams invoice is visible but not selectable', async () => {
    order({ id: 'a', ready: false });
    const list = await listInvoiceSendRows({});
    expect(list.rows[0]?.invoice).toEqual({
      eligible: false,
      reason: 'Waiting for Grams and Price Per Gram',
    });
  });

  it('ambiguous customer: a customer-default chat shared by a same-name customer is not selectable', async () => {
    order({ id: 'a', name: 'Jenny Bacani', orderChat: null, customerChat: 'PAGE_jenny' });
    (H.tables.customers ??= []).push({ id: 'other', display_name: 'JENNY BACANI', is_active: true });
    order({ id: 'b', name: 'Ann Gonzales', orderChat: null, customerChat: 'PAGE_ann' });
    const list = await listInvoiceSendRows({});
    const byId = Object.fromEntries(list.rows.map((r) => [r.orderId, r.invoice]));
    expect(byId.a?.eligible).toBe(false);
    expect(byId.a?.reason).toMatch(/Same name as another customer/);
    expect(byId.b?.eligible).toBe(true);
  });

  it('server pagination with a fixed number of queries per page (no N+1)', async () => {
    for (let i = 0; i < 30; i += 1) order({ id: `o${String(i).padStart(2, '0')}` });
    H.fromCalls = [];
    const p1 = await listInvoiceSendRows({});
    const callsFor30 = H.fromCalls.length;
    expect(p1.rows).toHaveLength(25);
    expect(p1.total).toBe(30);
    const p2 = await listInvoiceSendRows({ page: 2 });
    expect(p2.rows).toHaveLength(5);
    // The same handful of reads whether the page has 25 rows or 5.
    H.fromCalls = [];
    await listInvoiceSendRows({ page: 2 });
    expect(H.fromCalls.length).toBe(callsFor30);
    expect(callsFor30).toBeLessThanOrEqual(5);
  });

  it('search by customer name (case-insensitive)', async () => {
    order({ id: 'a', name: 'Jenny Bacani' });
    order({ id: 'b', name: 'Ann Gonzales' });
    H.tables.official_order_claims = [];
    const list = await listInvoiceSendRows({ search: 'jenny' });
    expect(list.rows.map((r) => r.orderId)).toEqual(['a']);
  });
});

describe('sending one row (the bulk queue calls this per order)', () => {
  it('eligible → claimed → the individual Send Invoice (fresh template) → finalized as Sent', async () => {
    order({ id: 'a' });
    const res = await sendInvoiceInBulk('a');
    expect(res).toEqual({ orderId: 'a', outcome: 'sent', reason: null });
    expect(sendOrderInvoice).toHaveBeenCalledWith('a', null);
    expect(H.rpcCalls.map((c) => c.fn)).toEqual([
      'claim_order_invoice_send',
      'finalize_order_invoice_send',
    ]);
    expect(H.rpcCalls[1]?.args).toMatchObject({ p_delivered: true });
  });

  it('an operator-prepared message (saved, never sent) is what gets sent', async () => {
    order({ id: 'a' });
    message('a', 'ready_to_copy_or_send', { body: 'Edited invoice' });
    await sendInvoiceInBulk('a');
    expect(sendOrderInvoice).toHaveBeenCalledWith('a', 'Edited invoice');
  });

  it('Test 5: the database claim refuses a second send → skipped, nothing sent', async () => {
    order({ id: 'a' });
    H.claim = 'in_progress';
    expect(await sendInvoiceInBulk('a')).toEqual({
      orderId: 'a',
      outcome: 'skipped',
      reason: 'Already being sent',
    });
    H.claim = 'already_sent';
    expect((await sendInvoiceInBulk('a')).reason).toBe('Already sent');
    expect(sendOrderInvoice).not.toHaveBeenCalled();
  });

  it('Test 3: an already-sent invoice is skipped before any claim', async () => {
    order({ id: 'a' });
    message('a', 'direct_sent');
    const res = await sendInvoiceInBulk('a');
    expect(res.outcome).toBe('skipped');
    expect(H.rpcCalls).toHaveLength(0);
    expect(sendOrderInvoice).not.toHaveBeenCalled();
  });

  it('nothing sent (incomplete / Test Session) → the claim is handed back', async () => {
    order({ id: 'a' });
    H.sendResult = { ok: false, error: 'Please complete Grams and Price Per Gram before sending the invoice.' };
    expect((await sendInvoiceInBulk('a')).outcome).toBe('skipped');
    expect(H.rpcCalls.at(-1)).toMatchObject({
      fn: 'release_order_invoice_send',
      args: { p_restore: 'message_draft' },
    });
    H.rpcCalls = [];
    H.sendResult = { ok: true, pancake: { attempted: false, delivered: false, error: null, reason: 'test_session' } };
    expect((await sendInvoiceInBulk('a')).reason).toBe('Test session active — not sent');
    expect(H.rpcCalls.at(-1)?.fn).toBe('release_order_invoice_send');
  });

  it('Test 4: Pancake rejected → Failed with a short reason (the batch goes on)', async () => {
    order({ id: 'a' });
    H.sendResult = { ok: true, pancake: { attempted: true, delivered: false, error: 'Pancake rejected the message.', reason: null } };
    expect(await sendInvoiceInBulk('a')).toEqual({
      orderId: 'a',
      outcome: 'failed',
      reason: 'Pancake rejected the message.',
    });
    expect(H.rpcCalls.at(-1)).toMatchObject({ fn: 'finalize_order_invoice_send', args: { p_delivered: false } });
  });

  it('before the database update: no claim function → nothing is sent unprotected', async () => {
    order({ id: 'a' });
    H.claimError = { code: 'PGRST202', message: 'Could not find the function' };
    expect((await sendInvoiceInBulk('a')).reason).toBe('Bulk sending needs the database update first');
    expect(sendOrderInvoice).not.toHaveBeenCalled();
  });
});

describe('reminders', () => {
  it('Test 7: sent + linked + unpaid → the Reminder template, reminder 1, once', async () => {
    order({ id: 'a' });
    message('a', 'direct_sent');
    expect(await sendReminderInBulk('a')).toEqual({ orderId: 'a', outcome: 'sent', reason: null });
    expect(renderOrderMessage).toHaveBeenCalledWith('a', 'reminder_1');
    expect(sendOrderReminder).toHaveBeenCalledWith('a', 1, 'Reminder text');
    // The database rejects a repeat (unique reminder number): reported, never re-delivered.
    H.reminderResult = { ok: false, error: 'Reminder 1 was already sent for this order.' };
    expect((await sendReminderInBulk('a')).outcome).toBe('skipped');
  });

  it('Test 8: paid in full / invoice not sent → Reminder refused, nothing sent', async () => {
    order({ id: 'a' });
    message('a', 'direct_sent');
    H.paid.add('a');
    expect((await sendReminderInBulk('a')).reason).toBe('Paid in full');
    order({ id: 'b' });
    expect((await sendReminderInBulk('b')).reason).toBe('Send the invoice first');
    expect(sendOrderReminder).not.toHaveBeenCalled();
  });

  it('the next number follows the reminders already sent', async () => {
    order({ id: 'a' });
    message('a', 'direct_sent');
    H.tables.order_reminders = [
      { official_order_id: 'a', reminder_number: 1, sent_at: '2026-09-24T01:00:00Z' },
    ];
    await sendReminderInBulk('a');
    expect(sendOrderReminder).toHaveBeenCalledWith('a', 2, 'Reminder text');
  });
});
