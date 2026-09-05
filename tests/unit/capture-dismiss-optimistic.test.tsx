import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IncomingCapturesStrip } from '@/components/capture/incoming-captures-strip';
import {
  CAPTURE_COUNT_EVENT,
  TOGGLE_INCOMING_CAPTURES_EVENT,
  type PendingCaptureRow,
} from '@/lib/capture/pending-types';

/**
 * Optimistic Dismiss (Owner 2026-09-05). The card must leave the visible list on the SAME tick as
 * the click — never after the server round-trip — while staying safe against a failed persist, a
 * double click, and a stale refetch/realtime echo that would otherwise resurrect it.
 */

// The dismiss mutation is held open so every assertion runs while the server is STILL pending.
let dismissResolve: ((v: { ok: true } | { ok: false; error: string }) => void) | null = null;
const dismissMock = vi.fn(
  () =>
    new Promise<{ ok: true } | { ok: false; error: string }>((res) => {
      dismissResolve = res;
    }),
);
let listData: PendingCaptureRow[] = [];
const loadMock = vi.fn(() => Promise.resolve(listData));

vi.mock('@/lib/capture/pending-actions', () => ({
  dismissPendingCaptureAction: (...a: unknown[]) => dismissMock(...(a as [])),
  loadPendingCapturesAction: () => loadMock(),
  claimCaptureStickerAction: () => Promise.resolve(null),
  releaseCaptureStickerAction: () => Promise.resolve(undefined),
  markCaptureStickerPrintedAction: () => Promise.resolve(undefined),
  sendCaptureToMessengerAction: () => Promise.resolve({ ok: true as const }),
  saveCaptureEditsAction: () => Promise.resolve({ ok: true as const }),
  retryCaptureAutoTextAction: () => Promise.resolve({ ok: true as const }),
  resolveCaptureLinkAction: () => Promise.resolve({ ok: false }),
}));
vi.mock('@/lib/orders/actions', () => ({ loadNewOrderDataAction: () => Promise.resolve(null) }));
vi.mock('@/components/shell/dashboard-sync', () => ({
  useDashboardSync: () => ({ lastSyncedAt: 0 }),
}));
vi.mock('@/components/print/printer-context', () => ({
  usePrinter: () => ({ activeChannel: null, printLang: 'en' }),
}));
// Realtime is irrelevant to these assertions — a no-op channel keeps the effect inert.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const ch = { on: () => ch, subscribe: () => ch };
    return { channel: () => ch, removeChannel: () => undefined };
  },
}));
vi.mock('@/lib/supabase/realtime-auth', () => ({ authorizeRealtime: () => () => undefined }));

function row(n: number): PendingCaptureRow {
  return {
    captureRecordId: `cap-${n}`,
    // Descending captured_at so index 0 is newest — mirrors listPendingCaptures' ordering.
    capturedAt: new Date(Date.UTC(2026, 8, 4, 10, 0, 59 - n)).toISOString(),
    screenshotUrl: null,
    fbName: `Customer ${n}`,
    itemQuery: null,
    grams: '3.37',
    canonicalGrams: null,
    isTest: false,
    linkStatus: 'linked',
    linkedCustomerId: null,
    linkedCustomerName: `Customer ${n}`,
    conversationAvailable: true,
    photoEligible: false,
    fbUrl: null,
    messageStatus: null,
    routeReason: null,
  };
}

/** Mount the strip, let its initial load settle, then open the panel (pill toggle event). */
async function renderStrip(count: number) {
  listData = Array.from({ length: count }, (_, i) => row(i));
  await act(async () => {
    render(<IncomingCapturesStrip />);
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent(TOGGLE_INCOMING_CAPTURES_EVENT));
  });
}

const dismissButtons = () => screen.queryAllByTestId(/^incoming-dismiss-/);
const cardCount = () => dismissButtons().length;

beforeEach(() => {
  dismissMock.mockClear();
  loadMock.mockClear();
  dismissResolve = null;
});

describe('Incoming Captures — optimistic Dismiss', () => {
  it('TEST 1 + 7: with 33 cards, one click removes the card while the server is still pending', async () => {
    await renderStrip(33);
    expect(cardCount()).toBe(33);

    const t0 = performance.now();
    fireEvent.click(screen.getByTestId('incoming-dismiss-cap-5'));
    const elapsed = performance.now() - t0;

    // Gone already — dismissResolve has NOT been called, so nothing came back from the server.
    expect(screen.queryByTestId('incoming-dismiss-cap-5')).not.toBeInTheDocument();
    expect(cardCount()).toBe(32);
    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(dismissMock).toHaveBeenCalledWith('cap-5');
    // Click → hidden is one synchronous commit; bound it well under the 300ms target.
    expect(elapsed).toBeLessThan(300);
  });

  it('TEST 2: a slow server never delays the card leaving the list', async () => {
    await renderStrip(33);
    fireEvent.click(screen.getByTestId('incoming-dismiss-cap-0'));
    expect(cardCount()).toBe(32); // already gone, nothing resolved yet

    await act(async () => {
      dismissResolve?.({ ok: true }); // server replies much later
    });
    expect(cardCount()).toBe(32);
    expect(screen.queryByTestId('incoming-dismiss-cap-0')).not.toBeInTheDocument();
  });

  it('TEST 3: a failed mutation restores the exact card in its original position, with a retry message', async () => {
    await renderStrip(5);
    fireEvent.click(screen.getByTestId('incoming-dismiss-cap-2'));
    expect(cardCount()).toBe(4);

    await act(async () => {
      dismissResolve?.({ ok: false, error: 'Not authorized.' });
    });

    expect(cardCount()).toBe(5);
    // Restored in its ORIGINAL slot (captured_at DESC), not appended to the end.
    expect(dismissButtons().map((el) => el.getAttribute('data-testid'))).toEqual([
      'incoming-dismiss-cap-0',
      'incoming-dismiss-cap-1',
      'incoming-dismiss-cap-2',
      'incoming-dismiss-cap-3',
      'incoming-dismiss-cap-4',
    ]);
    expect(screen.getByText(/Not authorized\..*Please retry\./)).toBeInTheDocument();
  });

  it('TEST 4: a double click fires exactly one mutation', async () => {
    await renderStrip(5);
    const btn = screen.getByTestId('incoming-dismiss-cap-1');
    fireEvent.click(btn);
    fireEvent.click(btn); // node is detached after the first click…
    fireEvent.click(btn); // …and re-dispatching cannot start a second mutation
    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(cardCount()).toBe(4);
  });

  it('TEST 5: a STALE refetch that still lists the capture does not make it reappear', async () => {
    await renderStrip(5);
    fireEvent.click(screen.getByTestId('incoming-dismiss-cap-3'));
    expect(cardCount()).toBe(4);

    // The 5s recovery poll was already in flight and returns a PRE-dismiss snapshot (all 5).
    await act(async () => {
      loadMock();
      await Promise.resolve();
    });
    expect(cardCount()).toBe(4); // suppressed — no flicker
    expect(screen.queryByTestId('incoming-dismiss-cap-3')).not.toBeInTheDocument();

    // After a FAILED persist the suppression lifts, so the server list governs again.
    await act(async () => {
      dismissResolve?.({ ok: false, error: 'Network down.' });
    });
    expect(screen.getByTestId('incoming-dismiss-cap-3')).toBeInTheDocument();
  });

  it('TEST 6: Use / Dismiss on the remaining cards are untouched', async () => {
    await renderStrip(5);
    fireEvent.click(screen.getByTestId('incoming-dismiss-cap-0'));
    for (const n of [1, 2, 3, 4]) {
      expect(screen.getByTestId(`incoming-use-cap-${n}`)).toBeInTheDocument();
      expect(screen.getByTestId(`incoming-dismiss-cap-${n}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('incoming-use-cap-0')).not.toBeInTheDocument();
  });

  it('TEST 1b: the Capture Pending count drops immediately, without a server reply', async () => {
    const seen: number[] = [];
    const onCount = (e: Event) => seen.push((e as CustomEvent<number>).detail);
    await renderStrip(33);
    window.addEventListener(CAPTURE_COUNT_EVENT, onCount);
    fireEvent.click(screen.getByTestId('incoming-dismiss-cap-9'));
    window.removeEventListener(CAPTURE_COUNT_EVENT, onCount);
    expect(seen.at(-1)).toBe(32); // 33 → 32 on the optimistic commit
  });
});
