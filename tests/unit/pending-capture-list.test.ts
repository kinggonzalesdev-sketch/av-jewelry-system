import { describe, expect, it } from 'vitest';

import {
  appendOlderPage,
  comparePendingRows,
  cursorOf,
  displayedPendingTotal,
  fitsLoadedWindow,
  hasMorePending,
  mergeFirstPage,
  sortPendingRows,
  type PendingSnapshot,
} from '@/lib/capture/pending-list';
import type { PendingCaptureRow } from '@/lib/capture/pending-types';

/** The pure rules behind "Capture Pending 70 = Incoming Captures (70)" (Owner 2026-09-24). */

const BASE = Date.UTC(2026, 8, 24, 14, 0, 0);
function row(n: number, capturedAt?: string): PendingCaptureRow {
  return {
    captureRecordId: `cap-${String(n).padStart(3, '0')}`,
    capturedAt: capturedAt ?? new Date(BASE - n * 1000).toISOString(),
    screenshotUrl: null,
    fbName: `Buyer ${n}`,
    itemQuery: null,
    grams: null,
    canonicalGrams: null,
    isTest: false,
    linkStatus: null,
    linkedCustomerId: null,
    linkedCustomerName: null,
    conversationAvailable: false,
    photoEligible: false,
    fbUrl: null,
    messageStatus: null,
    routeReason: null,
  };
}
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => row(from + i));
const ids = (rows: PendingCaptureRow[]) => rows.map((r) => r.captureRecordId);
const snap = (total: number, rows: PendingCaptureRow[]): PendingSnapshot => ({
  total,
  ids: new Set(ids(rows)),
});
const NONE = new Set<string>();

/** A stand-in server: keyset pages over `pending` (newest first), limit 50. */
function serverPage(pending: PendingCaptureRow[], after: PendingCaptureRow | null, limit = 50) {
  const sorted = sortPendingRows(pending);
  const rows = after ? sorted.filter((r) => comparePendingRows(r, after) > 0) : sorted;
  return { rows: rows.slice(0, limit), total: pending.length };
}

describe('order', () => {
  it('newest first, microseconds respected, id breaks ties (the server order)', () => {
    const a = row(1, '2026-09-24T14:00:00.000002+00:00');
    const b = row(2, '2026-09-24T14:00:00.000001+00:00');
    const c = { ...row(3, '2026-09-24T14:00:00.000001+00:00'), captureRecordId: 'cap-zzz' };
    expect(ids(sortPendingRows([b, a, c]))).toEqual(['cap-001', 'cap-zzz', 'cap-002']);
    expect(cursorOf([a, b])).toEqual({ capturedAt: b.capturedAt, id: 'cap-002' });
  });
});

describe('the displayed total is the server count, adjusted only by what this station changed', () => {
  it('70 pending with 50 loaded → 70, not 50', () => {
    const loaded = range(0, 50);
    expect(displayedPendingTotal(loaded, snap(70, loaded))).toBe(70);
    expect(hasMorePending(loaded, 70)).toBe(true);
  });

  it('a realtime arrival counts once (a duplicate echo is the same id: still once)', () => {
    const loaded = range(1, 51);
    const s = snap(70, loaded);
    const withNew = sortPendingRows([row(0), ...loaded]);
    expect(displayedPendingTotal(withNew, s)).toBe(71);
    expect(displayedPendingTotal(sortPendingRows([row(0), row(0), ...loaded]), s)).toBe(71);
  });

  it('a Dismiss / Use removal counts once; a repeated removal changes nothing', () => {
    const loaded = range(0, 50);
    const s = snap(70, loaded);
    const without = loaded.filter((r) => r.captureRecordId !== 'cap-007');
    expect(displayedPendingTotal(without, s)).toBe(69);
    expect(displayedPendingTotal(without.filter((r) => r.captureRecordId !== 'cap-007'), s)).toBe(69);
  });

  it('unknown until the first server count', () => {
    expect(displayedPendingTotal([], { total: null, ids: new Set() })).toBeNull();
  });
});

describe('merging a fresh first page', () => {
  it('keeps the older pages the operator loaded (no re-reading them)', () => {
    const current = range(0, 100);
    const { rows, snapshotIds } = mergeFirstPage(current, range(0, 50), {
      pageSize: 50,
      hide: NONE,
      keepNewer: NONE,
      checkedOlder: NONE,
      stillPending: null,
    });
    expect(ids(rows)).toEqual(ids(current));
    expect(snapshotIds.size).toBe(100);
  });

  it('drops an older row the id-check says is no longer pending (a missed realtime event)', () => {
    const current = range(0, 60);
    const checked = new Set(ids(range(50, 60)));
    const still = new Set([...checked].filter((id) => id !== 'cap-055'));
    const { rows } = mergeFirstPage(current, range(0, 50), {
      pageSize: 50,
      hide: NONE,
      keepNewer: NONE,
      checkedOlder: checked,
      stillPending: still,
    });
    expect(ids(rows)).not.toContain('cap-055');
    expect(rows).toHaveLength(59);
  });

  it('a short first page means everything fits: nothing older is kept', () => {
    const { rows } = mergeFirstPage(range(0, 60), range(0, 30), {
      pageSize: 50,
      hide: NONE,
      keepNewer: NONE,
      checkedOlder: NONE,
      stillPending: null,
    });
    expect(rows).toHaveLength(30);
  });

  it('a page read just before a realtime arrival does not drop it; a dismissed row stays hidden but covered', () => {
    const current = sortPendingRows([row(-1), ...range(0, 50)]);
    const { rows, snapshotIds } = mergeFirstPage(current, range(0, 50), {
      pageSize: 50,
      hide: new Set(['cap-003']),
      keepNewer: new Set([row(-1).captureRecordId]),
      checkedOlder: NONE,
      stillPending: null,
    });
    expect(ids(rows)).toContain(row(-1).captureRecordId);
    expect(ids(rows)).not.toContain('cap-003');
    // The server counted cap-003 (it listed it): it is covered, so the shown total subtracts it.
    expect(snapshotIds.has('cap-003')).toBe(true);
    expect(displayedPendingTotal(rows, { total: 70, ids: snapshotIds })).toBe(70);
  });
});

describe('paging: every capture reachable, no duplicates, no skips', () => {
  it('120 pending → 3 pages reach all 120, even with a new capture arriving mid-way', () => {
    const pending = range(0, 120);
    let loaded = serverPage(pending, null).rows;
    expect(loaded).toHaveLength(50);
    // A new capture lands on top while the operator scrolls.
    pending.push(row(-1));
    loaded = sortPendingRows([row(-1), ...loaded]);
    for (let guard = 0; guard < 5 && hasMorePending(loaded, pending.length); guard += 1) {
      const oldest = loaded[loaded.length - 1] ?? null;
      loaded = appendOlderPage(loaded, serverPage(pending, oldest).rows, NONE);
    }
    expect(loaded).toHaveLength(121);
    expect(new Set(ids(loaded)).size).toBe(121);
    expect(ids(loaded)).toEqual(ids(sortPendingRows(pending)));
  });

  it('a realtime update for a not-yet-loaded older capture waits for its page (no hole)', () => {
    const loaded = range(0, 50);
    expect(fitsLoadedWindow(loaded, row(80), true)).toBe(false);
    expect(fitsLoadedWindow(loaded, row(-1), true)).toBe(true);
    expect(fitsLoadedWindow(loaded, row(80), false)).toBe(true);
  });
});
