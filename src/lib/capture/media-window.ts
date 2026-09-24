import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A Pancake INBOX conversation id is `{page_id}_{psid}`. Extract the customer PSID (everything
 * after the first underscore). Comment/thread ids are a different shape and are rejected upstream
 * by `conversationBelongsToPage` (they do not start with the active page id), so this only ever
 * runs on a real inbox conversation. Returns null when the shape is not `{page}_{psid}`.
 */
export function psidFromConversationId(
  conversationId: string | null | undefined,
): string | null {
  const id = (conversationId ?? '').trim();
  const us = id.indexOf('_');
  if (us <= 0) return null;
  const psid = id.slice(us + 1).trim();
  return psid || null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Is this webhook event a GENUINE customer-originated Inbox DM — as opposed to a Facebook Live
 * COMMENT, comment reply, reaction, or other post-linked activity (all of which can ALSO carry a
 * `data.message` block, so `from.id === psid` alone is NOT enough)? Only a real Inbox DM opens
 * Facebook's ~24h media window; a Live comment does NOT.
 *
 * This predicate is the P0 fix for the false-positive that classified a comment-only customer
 * (Bavelyn, 2026-08-18: 11 post-linked comment events, ZERO Inbox DMs) as media-eligible and
 * fired a doomed reply_inbox PHOTO (`invalid_upload_fb_attachments_result`).
 *
 * ALL of these must hold (fail-safe: ANY doubt → false):
 *   - a `data.message` block exists (a message event, not a bare post / comment / reaction);
 *   - NO post-linked context: `data.post` / `data.comment` / `data.reaction` are absent, AND the
 *     message itself carries no `post_id` / `comment_id` / `post` (comment-originated messages do);
 *   - direction is customer → Page: `message.from.id` is EXACTLY the customer PSID;
 *   - it is NOT a Page echo (`message.is_echo !== true`);
 *   - it carries a real message payload (a message id `mid`, `text`, or `attachments`) — an empty
 *     or unrecognized shape is ambiguous and therefore NOT eligible.
 */
/**
 * A real post / comment / reaction REFERENCE carries an id or a type. Pancake attaches an EMPTY
 * `post: {}` (no id, no type) to a GENUINE Messenger INBOX reply, so an empty object must NOT
 * disqualify it (Owner 2026-08-24 — King's real reply had `data.post = {}` and `message.type = INBOX`
 * and was being wrongly rejected). Only a POPULATED reference means the event is post-linked.
 */
function isRealRef(v: unknown): boolean {
  const o = obj(v);
  if (!o) return false;
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  const type = typeof o.type === 'string' ? o.type.trim() : '';
  return id !== '' || type !== '';
}

export function isGenuineInboxDmEvent(raw: unknown, psid: string): boolean {
  if (!psid) return false;
  const data = obj(obj(raw)?.data);
  if (!data) return false;
  // Post-linked / comment / reaction activity is NEVER an inbox DM (a Facebook Live comment-with-photo
  // carries a `message` block too). But only a POPULATED reference counts — Bavelyn's comment events
  // had a real `data.post`; a genuine INBOX reply can carry an EMPTY `data.post: {}` that must NOT
  // disqualify it (the King false-negative).
  if (isRealRef(data.post) || isRealRef(data.comment) || isRealRef(data.reaction))
    return false;
  const message = obj(data.message);
  if (!message) return false;
  // A comment-originated message can carry its comment/post id ON the message object itself (again,
  // only a POPULATED post reference disqualifies).
  if (message.comment_id != null || message.post_id != null || isRealRef(message.post)) {
    return false;
  }
  // Never a Page echo (an outbound Page message mirrored back into the webhook stream).
  if (message.is_echo === true) return false;
  // Direction: the sender must be EXACTLY the customer PSID (customer → Page).
  const fromId = obj(message.from)?.id;
  if (typeof fromId !== 'string' || fromId !== psid) return false;
  // Positive proof of a real inbox message: Pancake's explicit `type === 'INBOX'` (King's genuine
  // reply had this with no mid captured), or a message id / text / attachments.
  const mid = message.mid;
  const text = message.text;
  const attachments = message.attachments;
  const isInboxType =
    typeof message.type === 'string' && message.type.trim().toUpperCase() === 'INBOX';
  const hasMid = typeof mid === 'string' && mid.trim() !== '';
  const hasText = typeof text === 'string' && text.trim() !== '';
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  return isInboxType || hasMid || hasText || hasAttachments;
}

/**
 * Media-eligibility for a normal Inbox PHOTO send: does this conversation's customer have a
 * recent, GENUINE customer-initiated Inbox DM (see `isGenuineInboxDmEvent`)? Controlled Test B
 * (2026-08-18) showed a photo FAILED while the customer was silent (comment / private-reply only)
 * and SUCCEEDED only after the customer sent one real Inbox message. We infer the open messaging
 * window from our own webhook store, within the window (default 24h; env
 * `PANCAKE_MEDIA_WINDOW_HOURS`, capped 1..168).
 *
 * Fails SAFE (returns false) on any doubt — deferring an auto-send is safe; a wrong send is not.
 * A Live comment / reaction / private-reply-created conversation is NOT enough; only a genuine
 * Inbox DM. This is strong controlled evidence, NOT a claim of universal Facebook/Pancake
 * behavior.
 */
export async function isConversationMediaEligible(
  supabase: SupabaseClient,
  conversationId: string,
  opts?: { windowHours?: number },
): Promise<boolean> {
  const psid = psidFromConversationId(conversationId);
  if (!psid) return false;
  const sinceMs = mediaWindowSinceMs(opts);
  const data = await fetchPsidWindowEvents(supabase, psid, sinceMs);
  return hasGenuineDmInWindow(data, psid, sinceMs);
}

/**
 * For the every-minute missed-reply fallback: which of
 * these items (one per waiting capture) had a genuine customer Inbox DM strictly AFTER ITS OWN `sinceIso`? ONE
 * events query for all of them (same genuine-DM gate); a PSID left undecided by a possibly
 * truncated result is re-checked alone. Returns the item KEYS that qualify. Fail-safe:
 * any read error means "no reply seen".
 */
export async function genuineInboxDmSinceBatch(
  supabase: SupabaseClient,
  items: ReadonlyArray<{ key: string; conversationId: string; sinceIso: string }>,
): Promise<Set<string>> {
  const replied = new Set<string>();
  const parsed = items
    .map((it) => ({
      key: it.key,
      conv: it.conversationId,
      psid: psidFromConversationId(it.conversationId),
      sinceMs: Date.parse(it.sinceIso),
    }))
    .filter(
      (p): p is { key: string; conv: string; psid: string; sinceMs: number } =>
        p.psid !== null && Number.isFinite(p.sinceMs),
    );
  if (parsed.length === 0) return replied;

  const psids = [...new Set(parsed.map((p) => p.psid))];
  const minSince = Math.min(...parsed.map((p) => p.sinceMs));
  const limit = Math.min(EVENTS_PER_PSID * psids.length, BATCH_ROW_CAP);
  let rows: Array<Record<string, unknown>> = [];
  try {
    const { data } = await supabase
      .from('pancake_webhook_events')
      .select('raw, event_timestamp, facebook_psid')
      .in('facebook_psid', psids)
      .is('post_type', null)
      .gt('event_timestamp', new Date(minSince).toISOString())
      .order('event_timestamp', { ascending: false })
      .limit(limit);
    rows = data ?? [];
  } catch {
    return replied;
  }
  const truncated = rows.length >= limit;
  const byPsid = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const psid = typeof row.facebook_psid === 'string' ? row.facebook_psid : null;
    if (!psid) continue;
    const list = byPsid.get(psid) ?? [];
    if (list.length < EVENTS_PER_PSID) list.push(row);
    byPsid.set(psid, list);
  }
  for (const p of parsed) {
    const events = byPsid.get(p.psid) ?? [];
    if (hasGenuineDmInWindow(events, p.psid, p.sinceMs)) {
      replied.add(p.key);
    } else if (truncated && events.length < EVENTS_PER_PSID) {
      const own = await fetchPsidWindowEvents(supabase, p.psid, p.sinceMs).catch(() => []);
      if (hasGenuineDmInWindow(own, p.psid, p.sinceMs)) replied.add(p.key);
    }
  }
  return replied;
}

/** Newest events examined per PSID — the single-row query's `.limit(50)`. */
const EVENTS_PER_PSID = 50;

/**
 * Upper bound on the rows ONE batch query may ask for. Equals PostgREST `max_rows`
 * (supabase/config.toml: 1000; the hosted default), so a response that fills it is
 * recognised as possibly truncated — see `conversationsMediaEligibility`.
 */
const BATCH_ROW_CAP = 1000;

/** Start of the media window (epoch ms): default 24h, env `PANCAKE_MEDIA_WINDOW_HOURS`, capped 1..168. */
function mediaWindowSinceMs(opts?: { windowHours?: number }): number {
  const windowHours =
    opts?.windowHours ??
    Math.min(168, Math.max(1, Number(process.env.PANCAKE_MEDIA_WINDOW_HOURS || '24')));
  return Date.now() - windowHours * 3600_000;
}

/** The single-PSID read: that customer's newest non-post events inside the window. */
async function fetchPsidWindowEvents(
  supabase: SupabaseClient,
  psid: string,
  sinceMs: number,
): Promise<Array<Record<string, unknown>>> {
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select('raw, event_timestamp')
    .eq('facebook_psid', psid)
    .is('post_type', null)
    .gt('event_timestamp', new Date(sinceMs).toISOString())
    .order('event_timestamp', { ascending: false })
    .limit(EVENTS_PER_PSID);
  return data ?? [];
}

/** The eligibility rule over one PSID's events (newest first). Shared by the single + batch reads. */
function hasGenuineDmInWindow(
  events: ReadonlyArray<Record<string, unknown>>,
  psid: string,
  sinceMs: number,
): boolean {
  for (const e of events) {
    // The genuine-DM structure gate — a comment/reaction/echo/post-linked event never qualifies.
    if (!isGenuineInboxDmEvent(e.raw, psid)) continue;
    // Re-check the window in JS too (the DB already bounds it; this makes the rule self-contained
    // and independently testable, and rejects any row that slipped past the bound).
    const tsRaw = e.event_timestamp;
    const ts = typeof tsRaw === 'string' ? Date.parse(tsRaw) : NaN;
    if (Number.isFinite(ts) && ts > sinceMs) return true;
  }
  return false;
}

/**
 * Batch twin of `isConversationMediaEligible` for list readers (the Incoming Captures strip
 * polls up to 50 rows every 5s): answers MANY conversations with ONE `pancake_webhook_events`
 * query (`facebook_psid IN (...)`, the SAME `post_type IS NULL` + window filters), grouped by
 * PSID in memory. Each PSID is judged on exactly what the single-row read would see — its
 * newest 50 in-window events — with the SAME `isGenuineInboxDmEvent` + JS window re-check.
 *
 * Returns a Map keyed by each conversation id AS PASSED (every id present; false when it has
 * no PSID or no genuine DM — the same fail-safe defaults as the single-row function).
 *
 * Truncation guard: the query asks for 50 rows per PSID (capped at PostgREST's max_rows). If
 * the response fills that limit it may have cut off OLDER rows, so any PSID that is still
 * undecided (no genuine DM among its rows here) and has fewer than 50 rows is re-checked with
 * the single-PSID query — the answer can never differ from `isConversationMediaEligible`.
 * In the normal case (a few events per customer) that fallback never runs.
 */
export async function conversationsMediaEligibility(
  supabase: SupabaseClient,
  conversationIds: ReadonlyArray<string>,
  opts?: { windowHours?: number },
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  const psidByConv = new Map<string, string>();
  for (const conv of conversationIds) {
    result.set(conv, false);
    const psid = psidFromConversationId(conv);
    if (psid) psidByConv.set(conv, psid);
  }
  const psids = [...new Set(psidByConv.values())];
  if (psids.length === 0) return result;

  const sinceMs = mediaWindowSinceMs(opts);
  const limit = Math.min(EVENTS_PER_PSID * psids.length, BATCH_ROW_CAP);
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select('raw, event_timestamp, facebook_psid')
    .in('facebook_psid', psids)
    .is('post_type', null)
    .gt('event_timestamp', new Date(sinceMs).toISOString())
    .order('event_timestamp', { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const truncated = rows.length >= limit;

  // Group newest-first (the global order is preserved within each PSID), keeping each PSID's
  // newest 50 — the same slice the single-row `.limit(50)` returns.
  const byPsid = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const psid = typeof row.facebook_psid === 'string' ? row.facebook_psid : null;
    if (!psid) continue;
    const list = byPsid.get(psid) ?? [];
    if (list.length < EVENTS_PER_PSID) list.push(row);
    byPsid.set(psid, list);
  }

  const eligibleByPsid = new Map<string, boolean>();
  await Promise.all(
    psids.map(async (psid) => {
      const events = byPsid.get(psid) ?? [];
      if (hasGenuineDmInWindow(events, psid, sinceMs)) {
        eligibleByPsid.set(psid, true);
      } else if (!truncated || events.length >= EVENTS_PER_PSID) {
        eligibleByPsid.set(psid, false);
      } else {
        // Possibly cut off by the shared limit — ask for this PSID alone (fail-safe false).
        const own = await fetchPsidWindowEvents(supabase, psid, sinceMs).catch(() => []);
        eligibleByPsid.set(psid, hasGenuineDmInWindow(own, psid, sinceMs));
      }
    }),
  );

  for (const [conv, psid] of psidByConv) {
    result.set(conv, eligibleByPsid.get(psid) === true);
  }
  return result;
}
