import 'server-only';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { conversationsMediaEligibilitySystem } from '@/lib/capture/auto-router';
import { sanitizeCaptureName } from '@/lib/capture/name-sanitize';
import { normalizeGrams } from '@/lib/print/order-receipt';
import {
  PENDING_CAPTURES_PAGE_SIZE,
  type PendingCaptureRow,
  type PendingCapturesCursor,
  type PendingCapturesPage,
} from '@/lib/capture/pending-types';

const CAPTURE_BUCKET = 'attachments';
/** Lifetime (seconds) of each screenshot's signed URL. */
const SCREENSHOT_URL_TTL = 600;

/**
 * Sign every screenshot with ONE Storage request (`createSignedUrls`) instead of one
 * `createSignedUrl` per row — the strip re-reads this list every 5 seconds. Returns a Map
 * keyed by the path AS STORED. A path that fails to sign (missing object, no access) or a
 * request that fails outright maps to null — exactly what the per-row call yielded.
 */
async function signScreenshotPaths(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: ReadonlyArray<string>,
): Promise<Map<string, string | null>> {
  // The single-object endpoint strips leading slashes (storage-js `_getFinalPath`); the batch
  // endpoint does not, so normalise here to sign exactly the object the per-row call signed.
  const keyOf = (p: string) => p.replace(/^\/+/, '');
  const keys = [...new Set(paths.map(keyOf))].filter(Boolean);
  const signedByKey = new Map<string, string | null>();
  if (keys.length > 0) {
    try {
      const { data } = await supabase.storage
        .from(CAPTURE_BUCKET)
        .createSignedUrls(keys, SCREENSHOT_URL_TTL);
      for (const d of data ?? []) {
        if (d.path != null) signedByKey.set(d.path, d.signedUrl ?? null);
      }
    } catch {
      // Whole request failed → every screenshot is null, as each per-row call's .catch gave.
    }
  }
  return new Map(paths.map((p) => [p, signedByKey.get(keyOf(p)) ?? null]));
}

/** Read one string field off the (untyped) OCR JSON, tolerating shape/casing. */
function ocrStr(ocr: unknown, ...keys: string[]): string | null {
  if (!ocr || typeof ocr !== 'object') return null;
  const o = ocr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * THE definition of a pending capture — the ONE filter both the "Capture Pending" count and the
 * Incoming Captures list use, so they can never drift: a floating screenshot that is not yet an
 * order (no official_order_id) and not confirmed. Dismiss deletes the row; Use links the order.
 * Messaging state (screenshot sent, computation sent, waiting) does NOT end pending: a capture
 * stays until staff Use or Dismiss it.
 */
function pendingCaptures(
  supabase: ServerClient,
  columns: string,
  options?: { count: 'exact'; head?: boolean },
) {
  return supabase
    .from('capture_records')
    .select(columns, options)
    .eq('source', 'floating')
    .is('official_order_id', null)
    .is('confirmed', null);
}

/** At most this many "just dismissed" ids are excluded from a count (see listPendingCapturesPage). */
const MAX_EXCLUDED_IDS = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A timestamp exactly as PostgREST returned it (keeps microseconds for an exact keyset). */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;

/** Only well-formed capture ids ever reach a PostgREST filter string. */
function safeIds(ids: ReadonlyArray<string> | undefined): string[] {
  return [...new Set((ids ?? []).filter((id) => UUID_RE.test(id)))];
}

/**
 * Lightweight COUNT of pending captures — for the compact "Capture Pending" pill beside
 * + New Order. `head: true` fetches NO rows (no screenshots, no OCR), only the count. RLS
 * scopes it to claim_capture holders, so it returns 0 for anyone who cannot see captures
 * (no throw — safe to call for any Orders viewer). Same filter as the list (pendingCaptures).
 */
export async function countPendingCaptures(): Promise<number> {
  const supabase = await createClient();
  const { count } = await pendingCaptures(supabase, 'id', { count: 'exact', head: true });
  return count ?? 0;
}

/**
 * One page of pending captures, newest first, with the EXACT pending total. Each row gets a
 * short-lived signed screenshot URL and the OCR guess (name + item) so the operator can
 * confirm/correct it into a New Order. The page is never the whole list: the first page is what
 * the station always loaded, and older pages load on demand from `cursor`.
 *
 * `excludeIds`: captures THIS station just dismissed (its DELETE may still be in flight), so a
 * refresh started meanwhile neither lists nor counts them. An empty page is a normal "nothing
 * waiting", never an error.
 */
export async function listPendingCapturesPage(
  opts: {
    limit?: number;
    cursor?: PendingCapturesCursor | null;
    excludeIds?: ReadonlyArray<string>;
  } = {},
): Promise<PendingCapturesPage> {
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const limit = Math.max(1, Math.min(opts.limit ?? PENDING_CAPTURES_PAGE_SIZE, 100));
  const exclude = safeIds(opts.excludeIds).slice(0, MAX_EXCLUDED_IDS);
  const cursor =
    opts.cursor && UUID_RE.test(opts.cursor.id) && TIMESTAMP_RE.test(opts.cursor.capturedAt)
      ? opts.cursor
      : null;

  const BASE_COLUMNS =
    'id, captured_at, screenshot_path, ocr, is_test, link_status, customer_id, pancake_conversation_id, message_status, route_reason, canonical_grams, customers ( display_name, facebook_conversation_url )';
  const withExclusions = <Q extends { not: (c: string, o: string, v: string) => Q }>(q: Q): Q =>
    exclude.length ? q.not('id', 'in', `(${exclude.join(',')})`) : q;
  const readRows = (columns: string) => {
    // The first page carries the exact total in the SAME request (one query, one snapshot).
    let q = withExclusions(
      pendingCaptures(supabase, columns, cursor ? undefined : { count: 'exact' }),
    );
    if (cursor) {
      const at = `"${cursor.capturedAt}"`;
      q = q.or(`captured_at.lt.${at},and(captured_at.eq.${at},id.lt.${cursor.id})`);
    }
    return q
      .order('captured_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
  };

  // The screenshot-first sequence columns (migration 20260924120000). If they are not there yet,
  // read exactly the columns this list always read, so Incoming Captures never breaks.
  const [first, pageTotal] = await Promise.all([
    readRows(`${BASE_COLUMNS}, message_sequence, text_send_status`),
    // An older page is filtered by the cursor, so its total comes from the head-only count.
    cursor
      ? withExclusions(pendingCaptures(supabase, 'id', { count: 'exact', head: true })).then(
          (r) => r.count,
        )
      : Promise.resolve(null),
  ]);
  let { data, error, count } = first;
  if (error) ({ data, error, count } = await readRows(BASE_COLUMNS));

  if (error || !data) return { rows: [], total: null };
  const total = (cursor ? pageTotal : count) ?? null;

  type CustJoin = {
    display_name?: string | null;
    facebook_conversation_url?: string | null;
  };
  const rows = data as unknown as Array<{
    id: string;
    captured_at: string;
    screenshot_path: string | null;
    ocr: unknown;
    is_test: boolean | null;
    link_status: string | null;
    customer_id: string | null;
    pancake_conversation_id: string | null;
    message_status: string | null;
    route_reason: string | null;
    canonical_grams: string | null;
    message_sequence?: string | null;
    text_send_status?: string | null;
    customers: CustJoin | CustJoin[] | null;
  }>;

  // Photo eligibility per row: only a `linked` capture whose conversation has a GENUINE
  // customer-initiated Inbox DM in the media window is "Photo ready". A comment-only `linked`
  // customer is NOT (the Bavelyn P0). Computed only for linked+conversation rows (fail-safe false
  // otherwise) so the strip can show "Photo waiting" without firing a doomed send.
  const linkedConv = rows.map((r) =>
    r.link_status === 'linked' ? (r.pancake_conversation_id ?? '').trim() : '',
  );

  // ONE signing request + ONE webhook-events query for the whole list (was 2 remote calls per
  // row, every poll) — same bucket/TTL, same eligibility rules, same fail-safe null/false.
  const [signedByPath, eligibleByConv] = await Promise.all([
    signScreenshotPaths(
      supabase,
      rows.map((r) => r.screenshot_path).filter((p): p is string => Boolean(p)),
    ),
    // Server read: the events table is Owner-only under RLS, so an Admin saw every chat closed.
    conversationsMediaEligibilitySystem(linkedConv.filter(Boolean)).catch(
      () => new Map<string, boolean>(),
    ),
  ]);

  const mapped = rows.map((r, i): PendingCaptureRow => {
    const cust = Array.isArray(r.customers) ? r.customers[0] : r.customers;
    const linkStatus = (r.link_status ?? null) as PendingCaptureRow['linkStatus'];
    // Clean the OCR'd name for display/matching (incl. captures already stored by older phones):
    // a phantom leading O/0/° glyph, AND a DETACHED leading letter ("Y Katy Seacombe" → "Katy
    // Seacombe") when the SAME capture's rawLines carry the clean twin (positive evidence it is
    // avatar/UI contamination, never a blind strip of a real Y-name).
    const fbName =
      sanitizeCaptureName(
        ocrStr(r.ocr, 'fbName', 'fb_name', 'name'),
        (r.ocr as { rawLines?: unknown } | null)?.rawLines,
      ) || null;
    return {
      captureRecordId: r.id,
      capturedAt: r.captured_at,
      screenshotUrl: r.screenshot_path
        ? (signedByPath.get(r.screenshot_path) ?? null)
        : null,
      fbName,
      itemQuery: ocrStr(r.ocr, 'itemQuery', 'item_query', 'item'),
      // Prefer the dedicated grams field; fall back to the mined number (older builds
      // put the pinned weight in itemQuery). normalizeGrams also rejects non-weights.
      grams: normalizeGrams(
        ocrStr(r.ocr, 'grams', 'weight') ??
          ocrStr(r.ocr, 'itemQuery', 'item_query', 'item'),
      ),
      // Canonical grams proven by the EXACT Pancake comment (leading-decimal correction), if any.
      // Raw OCR grams above is preserved; the UI shows effectiveGrams = canonicalGrams ?? grams.
      canonicalGrams: (r.canonical_grams ?? '').trim()
        ? normalizeGrams(r.canonical_grams)
        : null,
      isTest: r.is_test === true,
      linkStatus,
      linkedCustomerId: r.customer_id ?? null,
      // A capture can be LINKED to a real on-page conversation WITHOUT a saved customer RECORD (a Live
      // commenter we message directly — Ericka). Fall back to the capture's own resolved Facebook name
      // so the panel shows WHO it is, never a bare "Facebook customer" when the name is known
      // (Owner 2026-08-24, Issue 2). Identity/messaging still key off the conversation id, not the name.
      linkedCustomerName: (cust?.display_name ?? '').trim() || fbName,
      conversationAvailable: Boolean((r.pancake_conversation_id ?? '').trim()),
      photoEligible: linkedConv[i] ? eligibleByConv.get(linkedConv[i]) === true : false,
      fbUrl: (cust?.facebook_conversation_url ?? '').trim() || null,
      messageStatus: r.message_status ?? null,
      routeReason: (r.route_reason ?? '').trim() || null,
      messageSequence: r.message_sequence ?? null,
      textSendStatus: r.text_send_status ?? null,
    };
  });
  return { rows: mapped, total };
}

/**
 * Which of these (already loaded, older-page) captures are STILL pending — ids only, one query,
 * no screenshots. Lets the station drop an older row that was Used or Dismissed elsewhere when a
 * realtime event was missed, without re-reading every page it has loaded.
 */
export async function stillPendingCaptureIds(ids: ReadonlyArray<string>): Promise<string[] | null> {
  await requirePermission('claim_capture');
  const wanted = safeIds(ids).slice(0, 500);
  if (wanted.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await pendingCaptures(supabase, 'id').in('id', wanted);
  if (error || !data) return null;
  return (data as unknown as Array<{ id: string }>).map((r) => r.id);
}
