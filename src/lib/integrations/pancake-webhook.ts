import 'server-only';

import { captureDebugEnabled } from '@/lib/capture/debug-log';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Pancake webhook ingest (A.1). The route gates on PANCAKE_WEBHOOK_SECRET, then hands
 * the raw event here. We parse the person's identity TOLERANTLY (pages.fm event shapes
 * vary) and enrich the customer NON-DESTRUCTIVELY via a service-role RPC: fill a missing
 * link for a unique exact-name customer and refresh the avatar. It never resets an
 * existing link and never creates a customer. Inert until the secret is configured.
 */

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export type WebhookIdentity = { conversationId: string; name: string; avatar: string };

/**
 * Pull the conversation id + person name + avatar from an unknown Pancake event.
 * Checks the common envelopes (root, data, message, conversation, payload) and the
 * common person shapes (customer / from / sender / page_customer / recent_sender /
 * customers[0]) so a new payload shape still resolves instead of silently dropping.
 */
export function parsePancakeWebhookIdentity(body: unknown): WebhookIdentity {
  const root = obj(body) ?? {};
  const layers = [
    root,
    obj(root.data),
    obj(root.message),
    obj(root.conversation),
    obj(root.payload),
  ].filter((l): l is Record<string, unknown> => l !== null);

  let conversationId = '';
  for (const l of layers) {
    conversationId =
      conversationId ||
      str(l.conversation_id) ||
      str(l.conversationId) ||
      str(l.thread_id) ||
      (l === root ? '' : str(l.id));
  }
  if (!conversationId) conversationId = str(root.id);

  const people: Record<string, unknown>[] = [];
  for (const l of layers) {
    for (const key of ['customer', 'from', 'sender', 'page_customer', 'recent_sender']) {
      const p = obj(l[key]);
      if (p) people.push(p);
    }
    const arr = Array.isArray(l.customers) ? l.customers : [];
    const first = obj(arr[0]);
    if (first) people.push(first);
  }

  let name = '';
  for (const p of people) name = name || str(p.name);
  for (const l of layers)
    name = name || str(l.customer_name) || str(l.name) || str(l.title);

  let avatar = '';
  for (const p of people)
    avatar = avatar || str(p.avatar) || str(p.avatar_url) || str(p.picture);

  return { conversationId, name, avatar };
}

export type WebhookIngestResult = { ok: boolean } & Record<string, unknown>;

export async function ingestPancakeWebhookEvent(
  body: unknown,
): Promise<WebhookIngestResult> {
  const id = parsePancakeWebhookIdentity(body);
  if (!id.conversationId) return { ok: true, skipped: 'no_conversation' };

  const admin = createAdminClient();
  const { data, error } = (await admin.rpc('webhook_upsert_conversation_identity', {
    p_conversation_id: id.conversationId,
    p_name: id.name || null,
    p_avatar: id.avatar || null,
  })) as { data: unknown; error: { message: string } | null };

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  return { ok: true, result: data };
}

// ── Milestone 1: Facebook Live comment storage ──────────────────────────────
//
// Receive → validate → store → log, idempotently. This phase performs NO order
// creation, NO capture auto-match, and NO customer-link changes (those are later
// phases): the ONLY write is one row in `pancake_webhook_events`, keyed uniquely on
// (page_id, comment_id) so a Pancake retry can never duplicate a Live comment.

export type PancakeLiveComment = {
  pageId: string;
  commentId: string;
  commentText: string | null;
  /** Raw `data.message.inserted_at`; parsed to a timestamp DB-side (bad value → null). */
  eventTimestamp: string | null;
  livestreamPostId: string | null;
  postType: string | null;
  conversationId: string | null;
  facebookPsid: string | null;
  pancakePageCustomerId: string | null;
  facebookName: string | null;
};

/**
 * Returns the extracted Live-comment fields when the event is a Facebook livestream
 * comment (`data.post.type === 'livestream'`), or null for any other messaging event.
 * Tolerant of missing keys; requires page_id + comment_id (the idempotency key).
 */
export function parsePancakeLiveComment(body: unknown): PancakeLiveComment | null {
  const root = obj(body) ?? {};
  const data = obj(root.data) ?? {};
  const post = obj(data.post) ?? {};
  const message = obj(data.message) ?? {};
  const from = obj(message.from) ?? {};
  const conversation = obj(data.conversation) ?? {};
  const page = obj(data.page) ?? {};

  // page_id may arrive at the root, on data, on the message, on the conversation, or on
  // data.page.
  const pageId =
    str(root.page_id) ||
    str(data.page_id) ||
    str(message.page_id) ||
    str(conversation.page_id) ||
    str(page.id);
  const commentId = str(message.id);
  const psid = str(from.id);
  const name = str(from.name);

  // Capture ANY person-event that carries a sender we can message: a page_id, a stable
  // message id (the idempotency key), and a sender PSID + name that is NOT the page
  // itself. This covers Facebook LIVE comments whether the post is typed 'livestream' OR
  // 'video' (a Reels/video live — the shape our real live actually sends) AND inbox
  // messages; each yields a messageable {page_id}_{psid} identity for the pinned-name
  // fast-match. The OLD code required post.type === 'livestream', which SILENTLY DROPPED
  // every comment on a video live — so nothing was ever stored and no name could match.
  if (!pageId || !commentId || !psid || !name || psid === pageId) return null;

  return {
    pageId,
    commentId,
    commentText: str(message.message) || null,
    eventTimestamp: str(message.inserted_at) || null,
    livestreamPostId: str(post.id) || null,
    postType: str(post.type) || null,
    conversationId: str(conversation.id) || str(message.conversation_id) || null,
    facebookPsid: psid,
    pancakePageCustomerId: str(from.page_customer_id) || null,
    facebookName: name,
  };
}

/**
 * Store one Live comment idempotently via the service-role RPC. `stored` is true for a
 * NEW row, false when it was a duplicate retry. Does NO slow Pancake API call — just the
 * single fast insert — so the route acknowledges with 200 well within Pancake's window.
 */
export async function storePancakeLiveComment(
  c: PancakeLiveComment,
  raw: unknown,
): Promise<{ ok: true; stored: boolean } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data, error } = (await admin.rpc('webhook_store_pancake_live_comment', {
    p_page_id: c.pageId,
    p_comment_id: c.commentId,
    p_conversation_id: c.conversationId,
    p_livestream_post_id: c.livestreamPostId,
    p_post_type: c.postType,
    p_comment_text: c.commentText,
    p_event_timestamp: c.eventTimestamp,
    p_facebook_psid: c.facebookPsid,
    p_pancake_page_customer_id: c.pancakePageCustomerId,
    p_facebook_name: c.facebookName,
    p_raw: raw ?? null,
  })) as { data: unknown; error: { message: string } | null };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  return { ok: true, stored: data === true };
}

/** Mask an id for logs — reveal only the last 4 chars, never the whole value. */
function maskId(v: string | null): string {
  if (!v) return '—';
  return v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
}

/**
 * Sanitized diagnostic line for the server logs. NEVER logs the webhook secret, any
 * access token, or the raw comment text — only masked ids + the person's name + outcome.
 */
export function logLiveCommentReceipt(args: {
  isLive: boolean;
  live?: PancakeLiveComment | null;
  stored?: boolean;
  http: number;
}): void {
  // P0-B (Owner 2026-08-26): routine per-webhook receipt logging was the top Vercel "Observability
  // Events" cost (~10k webhooks/day). Production default OFF — re-enable with CAPTURE_DEBUG_LOGS=1.
  // Real store FAILURES are logged unconditionally by the webhook route; this is only the receipt trace.
  if (!captureDebugEnabled()) return;
  if (!args.isLive || !args.live) {
    console.log(
      `Pancake webhook received\nEvent: messaging\nLive Comment: no\nHTTP: ${args.http}`,
    );
    return;
  }
  const l = args.live;
  console.log(
    [
      'Pancake webhook received',
      'Event: messaging',
      'Live Comment: yes',
      `Page: ${maskId(l.pageId)}`,
      `Comment ID: ${maskId(l.commentId)}`,
      `Conversation ID: ${maskId(l.conversationId)}`,
      `Customer ID: ${maskId(l.pancakePageCustomerId)}`,
      `Facebook Name: ${l.facebookName ?? '—'}`,
      `Stored: ${args.stored ? 'yes' : 'no'}`,
      `HTTP: ${args.http}`,
    ].join('\n'),
  );
}
