import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Delivery rules of the individual Send Invoice (unchanged) and of reminders (2026-09-25:
 * text only to the STORED chat, like Send Invoice — no photo, never a customer guessed by name).
 */
vi.mock('server-only', () => ({}));

const H = vi.hoisted(() => {
  const state: {
    orderConv: string | null;
    customerConv: string | null;
    rendered: unknown;
    sends: Array<{ conversationId: string; message: string; attachmentUrl: string | null }>;
    nameLookups: number;
    rpc: string[];
  } = {
    orderConv: 'PAGE_1',
    customerConv: null,
    rendered: { ok: true, message: 'Invoice text', missing: [] },
    sends: [],
    nameLookups: 0,
    rpc: [],
  };
  return state;
});

function builder(table: string) {
  const b: Record<string, unknown> = {};
  const data = (): unknown =>
    table === 'live_test_state'
      ? { active: false }
      : table === 'official_orders'
        ? {
            fb_pancake_conversation_id: H.orderConv,
            customer_id: 'cust-1',
            customers: { pancake_conversation_id: H.customerConv, display_name: 'Jenny Bacani' },
          }
        : table === 'capture_records'
          ? { screenshot_path: 'captures/item.jpg' } // the order HAS a photo: text-only must skip it
          : null;
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    not: () => b,
    order: () => b,
    limit: () => b,
    ilike: () => b,
    maybeSingle: () => Promise.resolve({ data: data(), error: null }),
    update: () => b,
    insert: () => Promise.resolve({ error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
  });
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      from: (t: string) => builder(t),
      rpc: (fn: string) => {
        H.rpc.push(fn);
        return Promise.resolve({ data: 'id', error: null });
      },
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://img' } }) }) },
    }),
}));
vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: class extends Error {},
  requireActiveStaff: () => Promise.resolve({ staffProfileId: 'staff-1' }),
  requireOwnerOrAdmin: () => Promise.resolve(),
}));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: () => Promise.resolve() }));
vi.mock('@/lib/messaging/templates', () => ({ renderOrderMessage: () => Promise.resolve(H.rendered) }));
vi.mock('@/lib/integrations/pancake', () => ({
  getActivePancakePageId: () => Promise.resolve('PAGE'),
  conversationBelongsToPage: (id: string | null | undefined, page: string) =>
    Boolean((id ?? '').trim()) && (id ?? '').startsWith(`${page}_`),
  resolveConversationForName: () => {
    H.nameLookups += 1;
    return Promise.resolve({ conversationId: 'PAGE_guessed', matchCount: 1 });
  },
  sendPancakeConversationMessage: (input: { conversationId: string; message: string; attachmentUrl: string | null }) => {
    H.sends.push(input);
    return Promise.resolve({ ok: true, pancakeMessageId: 'm1', message: 'ok' });
  },
}));

import { sendOrderInvoice, sendOrderReminder } from '@/lib/orders/for-invoice';

beforeEach(() => {
  H.orderConv = 'PAGE_1';
  H.customerConv = null;
  H.rendered = { ok: true, message: 'Invoice text', missing: [] };
  H.sends = [];
  H.nameLookups = 0;
  H.rpc = [];
});

describe('individual Send Invoice (unchanged)', () => {
  it('sends the rendered invoice as TEXT ONLY to the order’s stored chat', async () => {
    const res = await sendOrderInvoice('o1');
    expect(res).toMatchObject({ ok: true, pancake: { attempted: true, delivered: true } });
    expect(H.sends).toEqual([{ conversationId: 'PAGE_1', message: 'Invoice text', attachmentUrl: null }]);
  });
  it('blocks an invoice missing Grams / Price Per Gram', async () => {
    H.rendered = { ok: true, message: 'x', missing: ['{price_per_gram}'] };
    expect(await sendOrderInvoice('o1')).toEqual({
      ok: false,
      error: 'Please complete Grams and Price Per Gram before sending the invoice.',
    });
    expect(H.sends).toHaveLength(0);
  });
  it('no stored chat → nothing sent, never a name guess', async () => {
    H.orderConv = null;
    const res = await sendOrderInvoice('o1');
    expect(res.ok).toBe(false);
    expect(H.sends).toHaveLength(0);
    expect(H.nameLookups).toBe(0);
  });
});

describe('reminders (2026-09-25)', () => {
  it('recorded by the database first, then TEXT ONLY to the stored chat (no photo)', async () => {
    const res = await sendOrderReminder('o1', 1, 'Reminder text');
    expect(res).toMatchObject({ ok: true, pancake: { delivered: true } });
    expect(H.rpc).toEqual(['record_order_reminder']);
    expect(H.sends).toEqual([{ conversationId: 'PAGE_1', message: 'Reminder text', attachmentUrl: null }]);
  });
  it('no stored chat → not delivered, and never a customer guessed by Facebook name', async () => {
    H.orderConv = null;
    const res = await sendOrderReminder('o1', 1, 'Reminder text');
    expect(res).toMatchObject({ ok: true, pancake: { attempted: false, delivered: false } });
    expect(H.nameLookups).toBe(0);
    expect(H.sends).toHaveLength(0);
  });
});
