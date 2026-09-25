import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server side of the price snapshot (Owner 2026-09-26): the new all-in-one database functions are
 * used when they exist; before migration 20260926090000 is applied the code falls back to the
 * unchanged functions — but ONLY for "function does not exist", never for a business error.
 */

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>();
const selectCalls: string[] = [];
let selectResults: Array<{
  data: unknown;
  error: { code?: string; message: string } | null;
}> = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: () =>
    Promise.resolve({
      rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
      from: () => ({
        select: (s: string) => {
          selectCalls.push(s);
          const result = selectResults.shift() ?? { data: [], error: null };
          return { eq: () => Promise.resolve(result), in: () => Promise.resolve(result) };
        },
      }),
    }),
}));
vi.mock('@/lib/customers/create', () => ({ createCustomer: vi.fn() }));
vi.mock('@/lib/authz/admin-name', () => ({
  resolveAdminName: () => Promise.resolve('staff-1'),
}));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: vi.fn(() => Promise.resolve()) }));
const requireOwner = vi.fn(() => Promise.resolve());
vi.mock('@/lib/authz/guard', () => ({
  requireOwner: () => requireOwner(),
  AuthorizationError: class AuthorizationError extends Error {},
}));

const missing = {
  code: 'PGRST202',
  message: 'Could not find the function public.x in the schema cache',
};
const perGram = { mode: 'per_gram' as const, price_per_gram: '6800.00', grams: '1.120' };

beforeEach(() => {
  rpc.mockReset();
  requireOwner.mockClear();
  selectCalls.length = 0;
  selectResults = [];
});

describe('captureManualOrder (New Order / Use → Save)', () => {
  const input = {
    customerId: 'c1',
    customerName: null,
    items: [
      { inventoryItemId: 'i1', unitPrice: '7616.00', quantity: 1, pricing: perGram },
    ],
  };
  const ok = {
    data: {
      official_order_id: 'o1',
      order_number: null,
      invoice_number: null,
      item_count: 1,
    },
    error: null,
  };

  it('saves the order and the snapshot in ONE call to create_new_order_multi_priced', async () => {
    const { captureManualOrder } = await import('@/lib/orders/manual-order');
    rpc.mockResolvedValueOnce(ok);
    const res = await captureManualOrder(input);
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe('create_new_order_multi_priced');
    expect(rpc.mock.calls[0]?.[1].p_items).toEqual([
      { id: 'i1', price: '7616.00', qty: 1, pricing: perGram },
    ]);
  });

  it('before the migration, saves exactly as before through create_new_order_multi', async () => {
    const { captureManualOrder } = await import('@/lib/orders/manual-order');
    rpc.mockResolvedValueOnce({ data: null, error: missing }).mockResolvedValueOnce(ok);
    const res = await captureManualOrder(input);
    expect(res.ok).toBe(true);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'create_new_order_multi_priced',
      'create_new_order_multi',
    ]);
  });

  it('a business error is reported, never retried through the old function', async () => {
    const { captureManualOrder } = await import('@/lib/orders/manual-order');
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'An item is no longer available (SBA-R-1).' },
    });
    const res = await captureManualOrder(input);
    expect(res).toEqual({
      ok: false,
      error: 'An item is no longer available (SBA-R-1).',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('refuses a snapshot that does not match the price, before touching the database', async () => {
    const { captureManualOrder } = await import('@/lib/orders/manual-order');
    const res = await captureManualOrder({
      ...input,
      items: [{ ...input.items[0]!, unitPrice: '7600.00' }],
    });
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('addOrderItems (Edit → Add Item, For Invoice included)', () => {
  const rows = [
    { itemId: 'i1', price: '7616.00', quantity: 1, pricing: perGram },
    {
      itemId: 'i2',
      price: '6248.00',
      quantity: 1,
      pricing: { mode: 'per_gram' as const, price_per_gram: '7100.00', grams: '0.880' },
    },
  ];

  it('adds every row in ONE all-or-nothing call, Owner-gated', async () => {
    const { addOrderItems } = await import('@/lib/orders/edit-items');
    rpc.mockResolvedValueOnce({ data: { total: '13864.00' }, error: null });
    const res = await addOrderItems('o1', rows);
    expect(requireOwner).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, total: '13864.00' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe('add_order_items_priced');
    expect(rpc.mock.calls[0]?.[1]).toEqual({
      p_order_id: 'o1',
      p_items: [
        { id: 'i1', price: '7616.00', qty: 1, pricing: perGram },
        { id: 'i2', price: '6248.00', qty: 1, pricing: rows[1]!.pricing },
      ],
    });
  });

  it('TEST 11: the same item twice is refused before the database', async () => {
    const { addOrderItems } = await import('@/lib/orders/edit-items');
    const res = await addOrderItems('o1', [rows[0]!, rows[0]!]);
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('TEST 12: a piece another tab already took is refused, and nothing is added', async () => {
    const { addOrderItems } = await import('@/lib/orders/edit-items');
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'That item is not available to add (SBA-R-1).' },
    });
    const res = await addOrderItems('o1', rows);
    expect(res).toEqual({
      ok: false,
      error: 'That item is not available to add (SBA-R-1).',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('before the migration, adds the items one by one exactly as before', async () => {
    const { addOrderItems } = await import('@/lib/orders/edit-items');
    rpc
      .mockResolvedValueOnce({ data: null, error: missing })
      .mockResolvedValueOnce({ data: { total: '7616.00' }, error: null })
      .mockResolvedValueOnce({ data: { total: '13864.00' }, error: null });
    const res = await addOrderItems('o1', rows);
    expect(res).toEqual({ ok: true, total: '13864.00' });
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'add_order_items_priced',
      'add_order_item',
      'add_order_item',
    ]);
  });

  it('before the migration, a failure part-way says how many WERE added', async () => {
    const { addOrderItems } = await import('@/lib/orders/edit-items');
    rpc
      .mockResolvedValueOnce({ data: null, error: missing })
      .mockResolvedValueOnce({ data: { total: '7616.00' }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: 'P0001', message: 'That item is not available to add (SBA-R-2).' },
      });
    const res = await addOrderItems('o1', rows);
    expect(res).toEqual({
      ok: false,
      addedCount: 1,
      error:
        'Added 1 of 2 items, then one failed: That item is not available to add (SBA-R-2).',
    });
  });

  it('a 42883 raised inside the new function is an error, never a silent switch to the old path', async () => {
    const { addOrderItems } = await import('@/lib/orders/edit-items');
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42883', message: 'function app_private.x(uuid) does not exist' },
    });
    const res = await addOrderItems('o1', rows);
    expect(res.ok).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('getOrderLineItems', () => {
  it('reads each line’s snapshot', async () => {
    const { getOrderLineItems } = await import('@/lib/orders/service');
    selectResults = [
      {
        data: [
          {
            claim_id: 'cl1',
            added_at: '2026-09-26T03:00:00Z',
            claims: {
              quantity: 1,
              claim_reference: 'CLM-1',
              pricing_mode: 'per_gram',
              price_per_gram: 6800,
              grams_snapshot: 1.12,
              inventory_items: {
                item_name: 'Ring',
                item_code: 'SBA-R-6301 1.12g',
                grams_per_piece: null,
                total_price_per_piece: 7616,
              },
            },
          },
        ],
        error: null,
      },
    ];
    const [line] = await getOrderLineItems('o1');
    expect(line).toMatchObject({
      pricingMode: 'per_gram',
      pricePerGramSnapshot: '6800',
      gramsSnapshot: '1.12',
      addedAt: '2026-09-26T03:00:00Z',
      unitPrice: '7616',
    });
  });

  it('before the migration (no snapshot columns), reads exactly as before', async () => {
    const { getOrderLineItems } = await import('@/lib/orders/service');
    selectResults = [
      {
        data: null,
        error: { code: '42703', message: 'column claims_1.pricing_mode does not exist' },
      },
      {
        data: [
          {
            claim_id: 'cl1',
            added_at: null,
            claims: {
              quantity: 1,
              claim_reference: 'CLM-1',
              inventory_items: {
                item_name: 'Ring',
                item_code: 'SBA-R-6301 1.12g',
                grams_per_piece: null,
                total_price_per_piece: 7616,
              },
            },
          },
        ],
        error: null,
      },
    ];
    const lines = await getOrderLineItems('o1');
    expect(selectCalls).toHaveLength(2);
    expect(selectCalls[1]).not.toMatch(/pricing_mode/);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.pricingMode).toBeNull();
  });
});
