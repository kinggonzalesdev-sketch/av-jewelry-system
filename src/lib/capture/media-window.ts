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
 * Media-eligibility for an AUTOMATIC Capture PHOTO send: does this conversation's customer have a
 * recent customer-initiated INBOX message? Controlled Test B (2026-08-18) showed a photo FAILED
 * while the customer was silent (comment / private-reply only) and SUCCEEDED after the customer
 * sent one inbox message. We infer the open messaging window from our own webhook store: an inbox
 * event (`post_type` null) for the PSID whose `data.message.from.id` is the customer (not the
 * Page), within the window (default 24h; env `PANCAKE_MEDIA_WINDOW_HOURS`, capped 1..168).
 *
 * Fails SAFE (returns false) on any doubt — deferring an auto-send is safe; a wrong send is not.
 * This is strong controlled evidence, NOT a claim of universal Facebook/Pancake behavior.
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
  const sinceIso = new Date(Date.now() - windowHours * 3600_000).toISOString();
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select('raw, event_timestamp')
    .eq('facebook_psid', psid)
    .is('post_type', null)
    .gt('event_timestamp', sinceIso)
    .order('event_timestamp', { ascending: false })
    .limit(20);
  for (const e of (data ?? []) as Array<Record<string, unknown>>) {
    const message = obj(obj(obj(e.raw)?.data)?.message);
    const fromId = obj(message?.from)?.id;
    if (typeof fromId === 'string' && fromId === psid) return true;
  }
  return false;
}
