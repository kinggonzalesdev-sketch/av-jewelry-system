import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Web → native print delivery for NEW ORDER stickers (Owner 2026-09-07, SAFE STAGED CUTOVER).
 * The New Order Print ADDITIONALLY enqueues a typed ORDER_STICKER job the MineFlow Capture app
 * claims and prints — the browser fallback stays intact. These cover the enqueue contract: one
 * job per sticker, a STABLE idempotency key (double-click / refresh can't double-enqueue), a
 * FRESH key for a deliberate reprint, the authoritative pre-rendered lines in the payload,
 * offline-safety, and error surfacing. The atomic single-device claim + terminal printed guard
 * live in SQL (claim_next_print_job / mark_print_job_printed).
 */

const rpc =
  vi.fn<
    (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  >();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => Promise.resolve({ rpc }),
}));
vi.mock('@/lib/authz/guard', () => ({
  requireActiveStaff: vi.fn(() => Promise.resolve({ id: 's1', roleKey: 'staff' })),
}));

import {
  enqueueOrderStickersAction,
  type OrderStickerPayload,
} from '@/lib/print/order-print-queue';

function sticker(over: Partial<OrderStickerPayload> = {}): OrderStickerPayload {
  return {
    customerName: 'Ana Cruz',
    itemName: 'Ring',
    grams: '2.5',
    quantity: 1,
    unitPrice: '1500.00',
    pricePerGram: null,
    date: '2026-09-07',
    lines: [
      { text: 'Ana Cruz', kind: 'name' },
      { text: '2.5g • ₱600/g', kind: 'pricePerGram' },
      { text: 'September 7, 2026', kind: 'date' },
    ],
    ...over,
  };
}

/** The params object passed on the i-th enqueue RPC call. */
function paramsOf(i: number): Record<string, unknown> {
  return rpc.mock.calls[i]![1];
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: { enqueued: true, duplicate: false, print_job_id: 'job' },
    error: null,
  });
});

describe('enqueueOrderStickersAction (staged native ORDER_STICKER queue)', () => {
  it('enqueues one native job per sticker with a stable per-index key + pre-rendered lines', async () => {
    const res = await enqueueOrderStickersAction('ord1', [
      sticker(),
      sticker({ itemName: 'Bracelet' }),
    ]);
    expect(res).toEqual(expect.objectContaining({ ok: true, queued: 2, duplicates: 0 }));
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]![0]).toBe('enqueue_order_print_job');
    expect(paramsOf(0).p_idempotency_key).toBe('order:ord1:0');
    expect(paramsOf(1).p_idempotency_key).toBe('order:ord1:1');
    // The authoritative pre-rendered lines ride along in the sticker payload → the native app
    // reproduces the exact web Order sticker without recomputing.
    const sent = paramsOf(0).p_sticker as { lines?: unknown };
    expect(Array.isArray(sent.lines)).toBe(true);
    expect((sent.lines as unknown[]).length).toBe(3);
  });

  it('re-submitting the same order+sticker reuses the SAME key (double-click safe)', async () => {
    await enqueueOrderStickersAction('ord1', [sticker()]);
    await enqueueOrderStickersAction('ord1', [sticker()]);
    expect(paramsOf(0).p_idempotency_key).toBe('order:ord1:0');
    expect(paramsOf(1).p_idempotency_key).toBe('order:ord1:0');
  });

  it('reports a duplicate submit instead of counting a second job', async () => {
    rpc.mockResolvedValueOnce({
      data: { enqueued: false, duplicate: true, print_job_id: 'job' },
      error: null,
    });
    const res = await enqueueOrderStickersAction('ord1', [sticker()]);
    expect(res).toEqual(expect.objectContaining({ ok: true, queued: 0, duplicates: 1 }));
  });

  it('mints a FRESH key for a deliberate reprint (a new, intended job)', async () => {
    await enqueueOrderStickersAction('ord1', [sticker()], {
      reprint: true,
      reprintNonce: 'n1',
    });
    expect(paramsOf(0).p_idempotency_key).toBe('order:ord1:0:reprint:n1');
  });

  it('returns immediately without a printer — the web never blocks on Bluetooth', async () => {
    expect((await enqueueOrderStickersAction('ord1', [sticker()])).ok).toBe(true);
  });

  it('surfaces an enqueue error (prefix stripped)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'ERROR: boom' } });
    expect(await enqueueOrderStickersAction('ord1', [sticker()])).toEqual({
      ok: false,
      error: 'boom',
    });
  });

  it('rejects an empty sticker list and a missing order', async () => {
    expect((await enqueueOrderStickersAction('ord1', [])).ok).toBe(false);
    expect((await enqueueOrderStickersAction('', [sticker()])).ok).toBe(false);
  });
});
