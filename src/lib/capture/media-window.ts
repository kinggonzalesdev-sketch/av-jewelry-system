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
export function isGenuineInboxDmEvent(raw: unknown, psid: string): boolean {
  if (!psid) return false;
  const data = obj(obj(raw)?.data);
  if (!data) return false;
  // Post-linked / comment / reaction activity is NEVER an inbox DM — even when it carries a
  // `message` block (a Facebook Live comment-with-photo does exactly this). This is the check
  // that `post_type is null` alone missed: Bavelyn's comment events had post_type null but a
  // populated `data.post`.
  if (data.post != null || data.comment != null || data.reaction != null) return false;
  const message = obj(data.message);
  if (!message) return false;
  // A comment-originated message can carry its comment/post id ON the message object itself.
  if (message.comment_id != null || message.post_id != null || message.post != null) {
    return false;
  }
  // Never a Page echo (an outbound Page message mirrored back into the webhook stream).
  if (message.is_echo === true) return false;
  // Direction: the sender must be EXACTLY the customer PSID (customer → Page).
  const fromId = obj(message.from)?.id;
  if (typeof fromId !== 'string' || fromId !== psid) return false;
  // Positive proof of a real message payload; anything else is ambiguous → not eligible.
  const mid = message.mid;
  const text = message.text;
  const attachments = message.attachments;
  const hasMid = typeof mid === 'string' && mid.trim() !== '';
  const hasText = typeof text === 'string' && text.trim() !== '';
  const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
  return hasMid || hasText || hasAttachments;
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
  const windowHours =
    opts?.windowHours ??
    Math.min(168, Math.max(1, Number(process.env.PANCAKE_MEDIA_WINDOW_HOURS || '24')));
  const sinceMs = Date.now() - windowHours * 3600_000;
  const sinceIso = new Date(sinceMs).toISOString();
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select('raw, event_timestamp')
    .eq('facebook_psid', psid)
    .is('post_type', null)
    .gt('event_timestamp', sinceIso)
    .order('event_timestamp', { ascending: false })
    .limit(50);
  for (const e of (data ?? []) as Array<Record<string, unknown>>) {
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
