import type { PendingCaptureRow, PendingCapturesCursor } from '@/lib/capture/pending-types';

/**
 * The Incoming Captures list state (Owner 2026-09-24: "Capture Pending 70" but "Incoming
 * Captures (50)"). Pure functions, so the rules are testable without a browser:
 *
 *   - the station holds a WINDOW of the newest pending captures (the first page, plus any older
 *     pages the operator loaded), always contiguous and newest first, so the next page starts
 *     exactly after the oldest loaded row (keyset: no duplicates, no skips);
 *   - the TOTAL is the server's exact count, adjusted only by what this station changed since that
 *     count (captures it added or removed), derived from sets, never from +1/-1 counters, so a
 *     duplicate event, a reconnect or a late refresh can never count twice.
 */

/** Microsecond sort key for a PostgREST / realtime timestamp ("…23.469687+00:00"). */
function timeKey(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return Number.NEGATIVE_INFINITY;
  const frac = /\.(\d+)/.exec(iso)?.[1] ?? '';
  return ms * 1000 + Number(`${frac}000000`.slice(3, 6));
}

/** Newest first: captured_at DESC, then id DESC — the server's order. */
export function comparePendingRows(a: PendingCaptureRow, b: PendingCaptureRow): number {
  const ta = timeKey(a.capturedAt);
  const tb = timeKey(b.capturedAt);
  if (ta !== tb) return tb > ta ? 1 : -1;
  if (a.captureRecordId === b.captureRecordId) return 0;
  return a.captureRecordId < b.captureRecordId ? 1 : -1;
}

export function sortPendingRows(rows: ReadonlyArray<PendingCaptureRow>): PendingCaptureRow[] {
  return [...rows].sort(comparePendingRows);
}

/** Where the next older page starts: the oldest loaded row. */
export function cursorOf(rows: ReadonlyArray<PendingCaptureRow>): PendingCapturesCursor | null {
  const last = rows[rows.length - 1];
  return last ? { capturedAt: last.capturedAt, id: last.captureRecordId } : null;
}

/** What the server's last count covered: the total, and the loaded captures it included. */
export type PendingSnapshot = { total: number | null; ids: ReadonlySet<string> };

export const EMPTY_SNAPSHOT: PendingSnapshot = { total: null, ids: new Set() };

/**
 * The count shown on BOTH the "Capture Pending" pill and the "Incoming Captures (N)" title: the
 * server's exact total, minus counted captures this station has since removed (Dismiss, Use seen
 * through realtime), plus captures it has since added (a realtime arrival). Null until the first
 * server count arrives.
 */
export function displayedPendingTotal(
  rows: ReadonlyArray<PendingCaptureRow>,
  snapshot: PendingSnapshot,
): number | null {
  if (snapshot.total === null) return null;
  const loaded = new Set(rows.map((r) => r.captureRecordId));
  let added = 0;
  for (const id of loaded) if (!snapshot.ids.has(id)) added += 1;
  let removed = 0;
  for (const id of snapshot.ids) if (!loaded.has(id)) removed += 1;
  return Math.max(0, snapshot.total + added - removed);
}

/** True while older pending captures exist beyond the loaded window. */
export function hasMorePending(
  rows: ReadonlyArray<PendingCaptureRow>,
  total: number | null,
): boolean {
  return total !== null && rows.length < total;
}

/**
 * Merge a fresh FIRST page into the loaded window.
 *   - `hide`: captures this station removed (Dismiss in flight, or a realtime removal the fresh
 *     page may predate). They stay off the list, but still count as "covered" by the server total.
 *   - `keepNewer`: captures that arrived through realtime moments ago; kept on top when the page
 *     was read just before they existed (no flicker).
 *   - `stillPending`: for older loaded rows that were re-checked, the ids still pending (null =
 *     not checked). Older rows that were checked and are gone are dropped.
 * A short first page means every pending capture fits in it, so nothing older is kept.
 */
export function mergeFirstPage(
  current: ReadonlyArray<PendingCaptureRow>,
  page: ReadonlyArray<PendingCaptureRow>,
  opts: {
    pageSize: number;
    hide: ReadonlySet<string>;
    keepNewer: ReadonlySet<string>;
    checkedOlder: ReadonlySet<string>;
    stillPending: ReadonlySet<string> | null;
  },
): { rows: PendingCaptureRow[]; snapshotIds: Set<string> } {
  const head = sortPendingRows(page);
  const headIds = new Set(head.map((r) => r.captureRecordId));
  const snapshotIds = new Set(headIds);
  const newest = head[0];
  const oldest = head[head.length - 1];

  const arrivals = current.filter(
    (r) =>
      !headIds.has(r.captureRecordId) &&
      opts.keepNewer.has(r.captureRecordId) &&
      (!newest || comparePendingRows(r, newest) < 0),
  );
  const older =
    head.length < opts.pageSize || !oldest
      ? []
      : current.filter((r) => {
          if (headIds.has(r.captureRecordId)) return false;
          if (comparePendingRows(r, oldest) <= 0) return false;
          if (opts.stillPending && opts.checkedOlder.has(r.captureRecordId)) {
            return opts.stillPending.has(r.captureRecordId);
          }
          return true;
        });
  for (const r of older) snapshotIds.add(r.captureRecordId);

  const rows = sortPendingRows([...arrivals, ...head, ...older]).filter(
    (r) => !opts.hide.has(r.captureRecordId),
  );
  return { rows, snapshotIds };
}

/** Append an older page after the loaded window (duplicates by id are ignored). */
export function appendOlderPage(
  current: ReadonlyArray<PendingCaptureRow>,
  page: ReadonlyArray<PendingCaptureRow>,
  hide: ReadonlySet<string>,
): PendingCaptureRow[] {
  const have = new Set(current.map((r) => r.captureRecordId));
  const fresh = page.filter((r) => !have.has(r.captureRecordId) && !hide.has(r.captureRecordId));
  return sortPendingRows([...current, ...fresh]);
}

/**
 * May a capture that is not loaded yet join the window (a realtime insert/update)? Only when it
 * falls INSIDE the window (newer than the oldest loaded row) or nothing older is left to load.
 * An update for an older, not-yet-loaded capture is left for the page that will load it, so the
 * window never gets a hole that the next page would skip.
 */
export function fitsLoadedWindow(
  rows: ReadonlyArray<PendingCaptureRow>,
  row: PendingCaptureRow,
  moreToLoad: boolean,
): boolean {
  const oldest = rows[rows.length - 1];
  if (!oldest || !moreToLoad) return true;
  return comparePendingRows(row, oldest) <= 0;
}
