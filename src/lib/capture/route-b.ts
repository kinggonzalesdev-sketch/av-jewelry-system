import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  buildPrivateReplyMessage,
  decryptShareToken,
  firstNameOf,
  newShareToken,
  shareLinkUrl,
} from '@/lib/capture/share-link';
import { getActivePancakePageId, sendPancakePrivateReply } from '@/lib/integrations/pancake';

const LINK_TTL_MS = 72 * 3600 * 1000; // 72-hour link expiry
const WINDOW_MS = 7 * 24 * 3600 * 1000; // Pancake Private Reply 7-day window

type ResolvedComment = {
  resolved?: boolean;
  reason?: string;
  page_id?: string;
  post_id?: string;
  comment_id?: string;
  facebook_psid?: string | null;
  conversation_id?: string | null;
  event_timestamp?: string | null;
};

type ShareLinkRow = {
  found?: boolean;
  id?: string;
  private_reply_status?: string;
  token_ciphertext?: string | null;
  revoked_at?: string | null;
  expires_at?: string | null;
  page_id?: string;
  post_id?: string;
  comment_id?: string;
  facebook_psid?: string | null;
  conversation_id?: string | null;
};

export type RouteBResult =
  | { ok: true; code: 'sent' | 'already_sent'; url: string | null }
  | { ok: false; code: string; message: string };

/**
 * ROUTE B (Owner 2026-08-21): when a normal Inbox PHOTO can't be sent, create/reuse a secure
 * screenshot link and send ONE Pancake Private Reply TEXT to the EXACT resolved Live comment.
 *
 * Safety: the comment identity is resolved by `resolve_exact_live_comment` (unique PSID + unique
 * qualifying comment within 7 days, else Needs Review — never a guess) and PERSISTED; later calls
 * reuse the same link by capture id, never re-matching by name. Strong idempotency — UNIQUE(page,
 * post,comment) gives one link/token, and an atomic pending→sending claim means only ONE worker
 * ever calls sendPancakePrivateReply (two phones / retries / auto+manual cannot double-send). TEXT
 * only — never a Private Reply PHOTO.
 */
export async function attemptSecureLinkPrivateReply(input: {
  supabase: SupabaseClient;
  captureRecordId: string;
  fbName: string;
  value: string | null;
  screenshotPath: string | null;
}): Promise<RouteBResult> {
  const { supabase, captureRecordId, fbName } = input;
  if (!input.screenshotPath) {
    return { ok: false, code: 'no_screenshot', message: 'No screenshot to link.' };
  }

  // Reuse a link already made for THIS capture (persisted identity — never re-match by name).
  const existingRes = await supabase.rpc('find_capture_share_link_for_capture', {
    p_capture_id: captureRecordId,
  });
  const existing = existingRes.data as ShareLinkRow | null;
  let link: ShareLinkRow | null = existing?.found ? existing : null;

  if (!link) {
    // Resolve the EXACT comment identity (strict; else Needs Review).
    const activePage = await getActivePancakePageId();
    const rc = (
      await supabase.rpc('resolve_exact_live_comment', {
        p_name: fbName,
        p_value: input.value,
        p_active_page: activePage,
      })
    ).data as ResolvedComment | null;
    if (!rc?.resolved || !rc.page_id || !rc.post_id || !rc.comment_id) {
      return {
        ok: false,
        code: 'no_exact_comment',
        message: `Needs Review (${rc?.reason ?? 'no exact comment'}).`,
      };
    }
    const ts = rc.event_timestamp ? Date.parse(rc.event_timestamp) : NaN;
    if (!Number.isFinite(ts) || Date.now() - ts > WINDOW_MS) {
      return {
        ok: false,
        code: 'outside_window',
        message: 'Outside the 7-day Private Reply window — Open FB Chat.',
      };
    }
    const tok = newShareToken();
    if (!tok.ciphertext) {
      return { ok: false, code: 'no_key', message: 'Secure-link key not configured.' };
    }
    const up = (
      await supabase.rpc('upsert_capture_share_link', {
        p_capture_id: captureRecordId,
        p_page: rc.page_id,
        p_post: rc.post_id,
        p_comment: rc.comment_id,
        p_psid: rc.facebook_psid,
        p_conversation: rc.conversation_id,
        p_event_ts: rc.event_timestamp,
        p_token_hash: tok.hash,
        p_token_ciphertext: tok.ciphertext,
        p_expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString(),
      })
    ).data as ShareLinkRow | null;
    if (!up?.id) {
      return { ok: false, code: 'link_failed', message: 'Could not create the secure link.' };
    }
    link = {
      ...up,
      page_id: rc.page_id,
      post_id: rc.post_id,
      comment_id: rc.comment_id,
      facebook_psid: rc.facebook_psid ?? null,
      conversation_id: rc.conversation_id ?? null,
    };
  }

  if (!link || !link.id) return { ok: false, code: 'no_exact_comment', message: 'Needs Review.' };
  const raw = decryptShareToken(link.token_ciphertext);
  const url = raw ? shareLinkUrl(raw) : null;
  if (link.revoked_at) return { ok: false, code: 'revoked', message: 'This link was revoked.' };
  if (link.private_reply_status === 'sent') return { ok: true, code: 'already_sent', url };

  // Atomic claim — only the worker that flips pending→sending sends the ONE Private Reply.
  const claim = (await supabase.rpc('claim_share_link_send', { p_id: link.id })).data as string;
  if (claim === 'already_sent') return { ok: true, code: 'already_sent', url };
  if (claim !== 'claimed') {
    return { ok: false, code: 'in_progress', message: 'Another Private Reply for this comment is in progress.' };
  }

  const message = buildPrivateReplyMessage(firstNameOf(fbName), url ?? '');
  const pr = await sendPancakePrivateReply({
    postId: link.post_id ?? '',
    messageId: link.comment_id ?? '',
    fromId: link.facebook_psid ?? '',
    commentConversationId: link.conversation_id ?? '',
    message,
  });
  if (pr.ok) {
    await supabase.rpc('finalize_share_link_send', {
      p_id: link.id,
      p_result: 'sent',
      p_msg_id: pr.pancakeMessageId,
    });
    return { ok: true, code: 'sent', url };
  }
  // A definite PRE-SEND failure → release to retry; anything after contacting Pancake → terminal
  // 'failed' (do NOT auto-retry and risk a second Private Reply — Pancake allows only one).
  const preSend =
    pr.code === 'sender_unset' || pr.code === 'token_missing' || pr.code === 'page_missing';
  await supabase.rpc('finalize_share_link_send', {
    p_id: link.id,
    p_result: preSend ? 'retry' : 'failed',
    p_msg_id: null,
  });
  return { ok: false, code: pr.code, message: pr.message };
}
