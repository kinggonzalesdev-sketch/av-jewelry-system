import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncomingCapturesStrip } from '@/components/capture/incoming-captures-strip';
import {
  CAPTURE_COUNT_EVENT,
  CAPTURE_COUNT_REQUEST_EVENT,
  TOGGLE_INCOMING_CAPTURES_EVENT,
  type PendingCaptureRow,
  type PendingCapturesCursor,
} from '@/lib/capture/pending-types';
import { comparePendingRows, sortPendingRows } from '@/lib/capture/pending-list';

/**
 * "Capture Pending = 70" but "Incoming Captures (50)" (Owner 2026-09-24). The strip is driven
 * against a stand-in server (keyset pages of 50 + the exact total) and a stand-in realtime
 * channel, so the pill count, the title and the reachable cards can be checked together.
 */

const BASE = Date.UTC(2026, 8, 24, 14, 0, 0);
function row(n: number): PendingCaptureRow {
  return {
    captureRecordId: `cap-${String(n + 1000)}`,
    capturedAt: new Date(BASE - n * 1000).toISOString(),
    screenshotUrl: null,
    fbName: `Buyer ${n}`,
    itemQuery: null,
    grams: '1.5',
    canonicalGrams: null,
    isTest: false,
    linkStatus: 'linked',
    linkedCustomerId: null,
    linkedCustomerName: `Buyer ${n}`,
    conversationAvailable: true,
    photoEligible: false,
    fbUrl: null,
    messageStatus: null,
    routeReason: null,
  };
}

const S = vi.hoisted(() => {
  const state: {
    pending: PendingCaptureRow[];
    pageCalls: Array<{ cursor: PendingCapturesCursor | null; excludeIds: string[] }>;
    handlers: Record<string, (payload: { new?: unknown; old?: unknown }) => void>;
    subscribe: null | ((status: string) => void);
  } = { pending: [], pageCalls: [], handlers: {}, subscribe: null };
  return state;
});

function page(opts: { cursor?: PendingCapturesCursor | null; excludeIds?: string[] } = {}) {
  S.pageCalls.push({ cursor: opts.cursor ?? null, excludeIds: opts.excludeIds ?? [] });
  const hidden = new Set(opts.excludeIds ?? []);
  const visible = sortPendingRows(S.pending.filter((r) => !hidden.has(r.captureRecordId)));
  const c = opts.cursor;
  const after = c
    ? visible.filter((r) => comparePendingRows(r, { ...r, capturedAt: c.capturedAt, captureRecordId: c.id }) > 0)
    : visible;
  return Promise.resolve({ rows: after.slice(0, 50), total: visible.length });
}

vi.mock('@/lib/capture/pending-actions', () => ({
  loadPendingCapturesPageAction: (o?: { cursor?: PendingCapturesCursor | null; excludeIds?: string[] }) =>
    page(o),
  stillPendingCaptureIdsAction: (ids: string[]) =>
    Promise.resolve(ids.filter((id) => S.pending.some((r) => r.captureRecordId === id))),
  dismissPendingCaptureAction: (id: string) => {
    S.pending = S.pending.filter((r) => r.captureRecordId !== id);
    return Promise.resolve({ ok: true as const });
  },
  claimCaptureStickerAction: () => Promise.resolve({ claimed: false }),
  releaseCaptureStickerAction: () => Promise.resolve(undefined),
  markCaptureStickerPrintedAction: () => Promise.resolve(undefined),
  sendCaptureToMessengerAction: () => Promise.resolve({ ok: true as const }),
  saveCaptureEditsAction: () => Promise.resolve({ ok: true as const }),
  retryCaptureAutoTextAction: () => Promise.resolve({ ok: true as const }),
  resolveCaptureLinkAction: () => Promise.resolve({ ok: false }),
}));
vi.mock('@/lib/orders/actions', () => ({ loadNewOrderDataAction: () => Promise.resolve(null) }));
vi.mock('@/components/shell/dashboard-sync', () => ({ useDashboardSync: () => ({ lastSyncedAt: 0 }) }));
vi.mock('@/components/print/printer-context', () => ({
  usePrinter: () => ({ activeChannel: null, printLang: 'en' }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const ch = {
      on: (_t: string, f: { event: string }, h: (p: { new?: unknown; old?: unknown }) => void) => {
        S.handlers[f.event] = h;
        return ch;
      },
      subscribe: (cb: (status: string) => void) => {
        S.subscribe = cb;
        return ch;
      },
    };
    return { channel: () => ch, removeChannel: () => undefined };
  },
}));
vi.mock('@/lib/supabase/realtime-auth', () => ({ authorizeRealtime: () => () => undefined }));

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}
const counts: number[] = [];
const onCount = (e: Event) => counts.push((e as CustomEvent<number>).detail);
const pill = () => counts.at(-1);
const title = () => screen.getByRole('dialog').querySelector('h2, [id$="title"]')?.textContent ?? '';
const cardIds = () =>
  screen.queryAllByTestId(/^incoming-dismiss-/).map((b) => b.getAttribute('data-testid')!.slice(17));

/** The server row as a realtime payload (the columns the strip reads). */
function payload(r: PendingCaptureRow, over: Record<string, unknown> = {}) {
  return {
    id: r.captureRecordId,
    source: 'floating',
    official_order_id: null,
    confirmed: null,
    captured_at: r.capturedAt,
    ocr: { fbName: r.fbName, grams: r.grams },
    is_test: false,
    link_status: 'linked',
    ...over,
  };
}

async function openWith(n: number) {
  S.pending = Array.from({ length: n }, (_, i) => row(i));
  await act(async () => {
    render(<IncomingCapturesStrip />);
    await settle();
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent(TOGGLE_INCOMING_CAPTURES_EVENT));
    await settle();
  });
}
async function loadMore() {
  await act(async () => {
    fireEvent.click(screen.getByTestId('incoming-load-more-button'));
    await settle();
  });
}

beforeEach(() => {
  S.pageCalls = [];
  S.handlers = {};
  counts.length = 0;
  window.addEventListener(CAPTURE_COUNT_EVENT, onCount);
  return () => window.removeEventListener(CAPTURE_COUNT_EVENT, onCount);
});

describe('Pending count = Incoming Captures title, every capture reachable', () => {
  it('TEST 1 + 2: 70 pending → pill 70 AND title 70, while only the first 50 are loaded', async () => {
    await openWith(70);
    expect(pill()).toBe(70);
    expect(title()).toContain('Incoming Captures (70)');
    expect(cardIds()).toHaveLength(50);
    expect(screen.getByTestId('incoming-load-more')).toHaveTextContent('Showing 50 of 70');
    // Only the first page was read (no cursor): nothing fetched the whole list.
    expect(S.pageCalls.every((c) => c.cursor === null)).toBe(true);
  });

  it('TEST 3: Load more reaches all 70 — no duplicates, no skips, newest first', async () => {
    await openWith(70);
    await loadMore();
    const got = cardIds();
    expect(got).toHaveLength(70);
    expect(new Set(got).size).toBe(70);
    expect(got).toEqual(sortPendingRows(S.pending).map((r) => r.captureRecordId));
    expect(screen.queryByTestId('incoming-load-more')).not.toBeInTheDocument();
    expect(S.pageCalls.at(-1)?.cursor?.id).toBe('cap-1049'); // right after the oldest loaded
    expect(title()).toContain('(70)');
  });

  it('TEST 4 + 7: a realtime capture → both 71; a duplicate echo and a reconnect do not double-count', async () => {
    await openWith(70);
    const fresh = row(-1);
    S.pending.push(fresh);
    await act(async () => {
      S.handlers.INSERT?.({ new: payload(fresh) });
      S.handlers.INSERT?.({ new: payload(fresh) }); // duplicate echo
      S.handlers.UPDATE?.({ new: payload(fresh) });
      await settle();
    });
    expect(pill()).toBe(71);
    expect(title()).toContain('(71)');
    expect(cardIds()[0]).toBe(fresh.captureRecordId);
    await act(async () => {
      S.subscribe?.('SUBSCRIBED'); // reconnect → authoritative refetch
      await settle();
    });
    expect(pill()).toBe(71);
    expect(title()).toContain('(71)');
  });

  it('TEST 5: Dismiss one → both 69 at once, and still 69 after the server refresh', async () => {
    await openWith(70);
    act(() => {
      fireEvent.click(screen.getByTestId('incoming-dismiss-cap-1003'));
    });
    expect(pill()).toBe(69);
    expect(title()).toContain('(69)');
    await act(async () => {
      await settle();
    });
    expect(pill()).toBe(69);
    expect(title()).toContain('(69)');
    expect(cardIds()).not.toContain('cap-1003');
  });

  it('TEST 6: Use (realtime: the capture now has an order) → both decrement exactly once', async () => {
    await openWith(70);
    const used = S.pending[4]!;
    S.pending = S.pending.filter((r) => r !== used);
    await act(async () => {
      S.handlers.UPDATE?.({ new: payload(used, { official_order_id: 'order-1' }) });
      S.handlers.UPDATE?.({ new: payload(used, { official_order_id: 'order-1' }) });
      await settle();
    });
    expect(pill()).toBe(69);
    expect(title()).toContain('(69)');
    await act(async () => {
      S.subscribe?.('SUBSCRIBED');
      await settle();
    });
    expect(pill()).toBe(69);
  });

  it('TEST 8: 120 pending → every capture reachable in pages of 50', async () => {
    await openWith(120);
    expect(title()).toContain('(120)');
    await loadMore();
    await loadMore();
    const got = cardIds();
    expect(got).toHaveLength(120);
    expect(new Set(got).size).toBe(120);
    expect(S.pageCalls.filter((c) => c.cursor !== null)).toHaveLength(2);
  });

  it('a refresh after loading older pages keeps them, and drops one Used elsewhere (missed event)', async () => {
    await openWith(70);
    await loadMore();
    S.pending = S.pending.filter((r) => r.captureRecordId !== 'cap-1060');
    await act(async () => {
      S.subscribe?.('SUBSCRIBED');
      await settle();
    });
    expect(cardIds()).toHaveLength(69);
    expect(cardIds()).not.toContain('cap-1060');
    expect(title()).toContain('(69)');
    expect(pill()).toBe(69);
  });

  it('the pill can ask for the count when it mounts after the station (it lives app-wide)', async () => {
    await openWith(70);
    counts.length = 0;
    act(() => {
      window.dispatchEvent(new CustomEvent(CAPTURE_COUNT_REQUEST_EVENT));
    });
    expect(pill()).toBe(70);
  });
});
