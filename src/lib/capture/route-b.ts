import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { recordAuditEvent, type AuditOutcome } from '@/lib/audit/log';
import { decryptShareToken, firstNameOf, newShareToken, shareLinkUrl } from '@/lib/capture/share-link';
import {
  AUTO_TEXT_DEFAULT_BODY,
  AUTO_TEXT_KEY,
  buildAutoTextValues,
  renderAutoText,
} from '@/lib/messaging/auto-text';
import { getActivePancakePageId, sendPancakePrivateReply } from '@/lib/integrations/pancake';
import { classifyCaptureValue, normalizeGrams, parseFixedPrice } from '@/lib/print/order-receipt';

/** Read the Owner-editable AUTO TEXT template body via the caller's client (works for the PC staff
 *  session AND the service-role router). Falls back to the shipped default so a send never breaks if
 *  the row is missing/unreadable — the default is byte-identical to the seeded `auto_text` row. */
async function readAutoTextTemplateBody(supabase: SupabaseClient): Promise<string> {
  try {
    const { data } = await supabase
      .from('message_templates')
      .select('body')
      .eq('key', AUTO_TEXT_KEY)
      .maybeSingle();
    const body =
      typeof (data as { body?: unknown } | null)?.body === 'string'
        ? (data as { body: string }).body
        : '';
    return body.trim() ? body : AUTO_TEXT_DEFAULT_BODY;
  } catch {
    return AUTO_TEXT_DEFAULT_BODY;
  }
}

/**
 * Build the AUTO TEXT from the FINALIZED Capture business data (Owner 2026-08-22). Messaging NEVER
 * reclassifies: it reuses the SAME upstream classifier the sticker uses (classifyCaptureValue →
 * grams via normalizeGrams / fixed via parseFixedPrice) + the ONE shared sticker rate
 * (sticker_settings.price_per_gram, read via the caller's client so it works for the PC session AND
 * the service-role router). The computed total + conditional 20% layaway DP and the mode-aware line
 * suppression come from the shared AUTO TEXT engine, rendering the Owner's SAVED template. Returns
 * null when the business data is INCOMPLETE (unclassifiable value, missing grams/price, or grams with
 * no rate) so the ONE Private Reply is NOT consumed — it stays retryable until the Capture is final.
 */
async function buildAutoTextMessage(
  supabase: SupabaseClient,
  fbName: string,
  value: string | null,
): Promise<string | null> {
  const mode = classifyCaptureValue(value);
  let values: Record<string, string> | null = null;

  if (mode === 'grams') {
    const grams = normalizeGrams(value);
    if (!grams) return null;
    const { data } = await supabase
      .from('sticker_settings')
      .select('price_per_gram')
      .eq('id', 1)
      .maybeSingle();
    const pricePerGram =
      typeof (data as { price_per_gram?: unknown } | null)?.price_per_gram === 'string'
        ? ((data as { price_per_gram: string }).price_per_gram).trim()
        : '';
    if (!pricePerGram) return null; // grams needs a rate — else keep it reviewable, don't send.
    values = buildAutoTextValues({
      mode: 'grams',
      firstName: firstNameOf(fbName),
      grams,
      pricePerGram,
    });
  } else if (mode === 'fixed') {
    const fixedPrice = parseFixedPrice(value);
    if (!fixedPrice) return null;
    values = buildAutoTextValues({ mode: 'fixed', firstName: firstNameOf(fbName), fixedPrice });
  }

  if (!values) return null; // unclassifiable / incomplete → do not consume the Private Reply.
  const body = await readAutoTextTemplateBody(supabase);
  return renderAutoText(body, values);
}

/**
 * PII-SAFE pipeline audit (Owner 2026-08-22): record WHERE the secure-link flow landed so an
 * operator/dev can tell the failing stage at a glance — never a token, PSID, comment/post id, or
 * message body. Stage tags: COMMENT_MATCH · SECURE_LINK · PRIVATE_REPLY_TEXT (PHOTO_ELIGIBILITY and
 * INBOX_PHOTO are recorded on the PHOTO path in pc-send). Best-effort; never blocks the send.
 */
type RouteBStage = 'COMMENT_MATCH' | 'SECURE_LINK' | 'PRIVATE_REPLY_TEXT';
async function auditRouteB(
  captureRecordId: string,
  stage: RouteBStage,
  outcome: AuditOutcome,
  code: string,
): Promise<void> {
  await recordAuditEvent({
    action: 'capture_secure_link',
    entityType: 'capture_record',
    entityId: captureRecordId,
    outcome,
    reason: `${stage}:${code}`,
    context: { stage, code },
  });
}

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
  /** The capture's EXACT customer PSID (from its linked inbox conversation), when known. Lets the
   *  resolver key off the precise identity instead of fuzzy name-matching — the reliable path. */
  psid?: string | null;
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
        p_psid: input.psid ?? null,
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
      await auditRouteB(captureRecordId, 'COMMENT_MATCH', 'failed', 'outside_window');
      return {
        ok: false,
        code: 'outside_window',
        message: 'Outside the 7-day Private Reply window — Open FB Chat.',
      };
    }
    // DECOUPLED from the secure /m/ link (Owner 2026-08-24): the new AUTO TEXT is link-free, so the
    // AES token is OPTIONAL. We still create the share-link row purely as the idempotency ledger
    // (UNIQUE page,post,comment → one Private Reply per comment) and always store the SHA-256 hash
    // (needs no key). The ciphertext (only the historical /m/ link uses it) may be null when
    // CAPTURE_LINK_ENC_KEY is absent — a missing key must NEVER block a link-free AUTO TEXT.
    const tok = newShareToken();
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
      await auditRouteB(captureRecordId, 'SECURE_LINK', 'failed', 'link_failed');
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

  // Build the mode-aware AUTO TEXT from the FINALIZED Capture business data BEFORE claiming, so an
  // incomplete Capture (unclassifiable value / missing grams-or-price / grams with no rate) never
  // consumes the ONE Private Reply — it stays reviewable/retryable.
  const message = await buildAutoTextMessage(supabase, fbName, input.value);
  if (!message) {
    await auditRouteB(captureRecordId, 'PRIVATE_REPLY_TEXT', 'failed', 'incomplete_business_data');
    return {
      ok: false,
      code: 'incomplete_business_data',
      message: 'Awaiting a finalized grams/price + rate — the Private Reply was not used.',
    };
  }

  // Atomic claim — only the worker that flips pending→sending sends the ONE Private Reply.
  const claim = (await supabase.rpc('claim_share_link_send', { p_id: link.id })).data as string;
  if (claim === 'already_sent') return { ok: true, code: 'already_sent', url };
  if (claim !== 'claimed') {
    return { ok: false, code: 'in_progress', message: 'Another Private Reply for this comment is in progress.' };
  }

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
    await auditRouteB(captureRecordId, 'PRIVATE_REPLY_TEXT', 'succeeded', 'sent');
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
  await auditRouteB(captureRecordId, 'PRIVATE_REPLY_TEXT', 'failed', pr.code);
  return { ok: false, code: pr.code, message: pr.message };
}
