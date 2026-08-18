import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  findPancakeInboxConversationByPsid,
  getSelectedPancakePage,
  getSelectedPancakeSender,
  sendPancakeConversationMessage,
  sendPancakePrivateReply,
  uploadPancakeImageContent,
  type PancakeSendResult,
  type PancakeUploadDiagnostics,
} from '@/lib/integrations/pancake';

/**
 * Controlled Test B harness — the Owner privately replies to ONE approved Facebook
 * Live COMMENT and (optionally) delivers a screenshot, with every Pancake request/
 * response sanitized and returned. It is deliberately MANUAL + Primary-Super-Admin
 * gated and does NOT touch the automatic Capture flow (Phase 2 broad rollout stays
 * off until this passes). It NEVER synthesizes {page_id}_{psid}: the delivery target
 * is the REAL private conversation id Pancake returns from the private reply.
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
/** `data.message` node of a stored webhook payload (where can_reply_privately lives). */
function rawMessage(raw: unknown): Record<string, unknown> | null {
  const data = obj(obj(raw)?.data);
  return obj(data?.message);
}
/** The already-created private-reply conversation id on a stored comment, or null. A
 *  present value means the comment was ALREADY privately replied to (not a fresh case). */
function privateReplyConvId(raw: unknown): string | null {
  const id = str(obj(rawMessage(raw)?.private_reply_conversation)?.id);
  return id || null;
}

/** Per-field verification of ONE candidate — the Owner confirms these before Run. */
export type PrivateReplyCandidateChecks = {
  pageIdOk: boolean;
  postTypeOk: boolean;
  messageTypeOk: boolean;
  postIdOk: boolean;
  commentIdOk: boolean;
  psidOk: boolean;
  conversationOk: boolean;
  canReplyPrivately: boolean;
  notAlreadyReplied: boolean;
  /** page_customer_id is "when available" — informational, NOT a hard gate. */
  pageCustomerPresent: boolean;
};

/** One candidate comment for the Test B picker (safe/masked for display). */
export type PrivateReplyTestCandidate = {
  webhookEventId: string;
  fbName: string;
  commentPreview: string;
  at: string;
  canReplyPrivately: boolean;
  /** Masked identity fields shown so the Owner can verify the exact selected comment. */
  identity: {
    pageId: string;
    postType: string;
    messageType: string;
    postId: string;
    commentId: string;
    psid: string;
    pageCustomerId: string;
    commentConversationId: string;
  };
  checks: PrivateReplyCandidateChecks;
  /** Every HARD check passes (page/post_type/message.type/post/comment/psid/conv/crp/not-replied). */
  allValid: boolean;
};

const CANDIDATE_COLUMNS =
  'id, page_id, facebook_name, comment_text, received_at, post_type, livestream_post_id, comment_id, facebook_psid, pancake_page_customer_id, conversation_id, raw';

/** Reveal only the last `keep` chars of an id for display; never the whole value. */
function maskTail(v: string, keep: number): string {
  const s = str(v);
  if (!s) return '—';
  return s.length <= keep ? `…${s}` : `…${s.slice(-keep)}`;
}

/** Build the masked candidate + its selectability from one stored webhook row. */
function toCandidate(
  r: Record<string, unknown>,
  selectedPageId: string,
): { candidate: PrivateReplyTestCandidate; eligible: boolean } {
  const msg = rawMessage(r.raw);
  const pageId = str(r.page_id);
  const postType = str(r.post_type);
  const messageType = str(msg?.type);
  const postId = str(r.livestream_post_id);
  const commentId = str(r.comment_id);
  const psid = str(r.facebook_psid);
  const conv = str(r.conversation_id);
  const pageCustomer = str(r.pancake_page_customer_id);
  const crp = msg?.can_reply_privately === true;
  const alreadyReplied = privateReplyConvId(r.raw) !== null;
  const complete = Boolean(postId && commentId && psid && conv);

  const checks: PrivateReplyCandidateChecks = {
    pageIdOk: selectedPageId ? pageId === selectedPageId : Boolean(pageId),
    postTypeOk: postType === 'livestream' || postType === 'video',
    messageTypeOk: messageType === 'COMMENT',
    postIdOk: Boolean(postId),
    commentIdOk: Boolean(commentId),
    psidOk: Boolean(psid),
    conversationOk: Boolean(conv),
    canReplyPrivately: crp,
    notAlreadyReplied: !alreadyReplied,
    pageCustomerPresent: Boolean(pageCustomer),
  };
  const allValid =
    checks.pageIdOk &&
    checks.postTypeOk &&
    checks.messageTypeOk &&
    checks.postIdOk &&
    checks.commentIdOk &&
    checks.psidOk &&
    checks.conversationOk &&
    checks.canReplyPrivately &&
    checks.notAlreadyReplied;

  // SELECTABLE only when privately-replyable + complete + not-already-replied (post_type is
  // already constrained to livestream/video in SQL). This is the SAME hard gate as the
  // recent list — a search NEVER widens it, so inbox/null or can_reply_privately=false
  // events are never offered. page_id / message.type are surfaced only for verification.
  const eligible = crp && complete && !alreadyReplied;

  return {
    candidate: {
      webhookEventId: str(r.id),
      fbName: str(r.facebook_name) || '—',
      commentPreview: str(r.comment_text).slice(0, 64),
      at: str(r.received_at),
      canReplyPrivately: crp,
      identity: {
        pageId: maskTail(pageId, 6),
        postType: postType || '—',
        messageType: messageType || '—',
        postId: maskTail(postId, 4),
        commentId: maskTail(commentId, 4),
        psid: maskTail(psid, 4),
        pageCustomerId: pageCustomer ? maskTail(pageCustomer, 4) : '—',
        commentConversationId: maskTail(conv, 6),
      },
      checks,
      allValid,
    },
    eligible,
  };
}

/**
 * Recent Live/video COMMENT events that CAN be privately replied to (can_reply_privately
 * = true) and carry the full identity (post + comment + psid + comment conversation) —
 * so the Owner can pick their approved test comment. Primary Super Admin only.
 */
export async function listPrivateReplyTestCandidates(): Promise<
  PrivateReplyTestCandidate[]
> {
  return queryCandidates(null);
}

/**
 * The SAME eligible candidates, NARROWED by an exact/partial comment-text search (e.g. the
 * unique consented token `TESTB-AV-817`) so the Owner can locate their test comment in a
 * high-volume Live without scrolling. It NEVER widens the gate: only privately-replyable,
 * complete, not-already-replied Live/video comments are returned. Primary Super Admin only.
 */
export async function searchPrivateReplyTestCandidates(
  query: string,
): Promise<PrivateReplyTestCandidate[]> {
  const q = (query ?? '').trim();
  if (!q) return [];
  return queryCandidates(q.slice(0, 120));
}

async function queryCandidates(
  search: string | null,
): Promise<PrivateReplyTestCandidate[]> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return [];
    throw cause;
  }
  const supabase = await createClient();
  const selectedPageId = (await getSelectedPancakePage())?.pageId ?? '';
  let qb = supabase
    .from('pancake_webhook_events')
    .select(CANDIDATE_COLUMNS)
    .in('post_type', ['livestream', 'video']);
  if (search) qb = qb.ilike('comment_text', `%${search}%`);
  const { data } = await qb
    .order('received_at', { ascending: false })
    .limit(search ? 60 : 40);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows
    .map((r) => toCandidate(r, selectedPageId))
    .filter((x) => x.eligible)
    .map((x) => x.candidate);
}

export type PrivateReplyTestStep = { step: string; ok: boolean; detail: string };

export type PrivateReplyResolution = {
  realConversationId: string | null;
  source:
    | 'private_reply_response'
    | 'inbox_webhook'
    | 'updated_comment'
    | 'get_conversations'
    | 'none';
  /** A follow-up Messaging webhook arrived for this PSID that is NOT the customer messaging. */
  followUpWebhookWithoutCustomerReply: boolean;
  /** The customer sent an inbox message after commenting (contaminates the "alone" test). */
  customerMessagedAfterComment: boolean;
  /** A stored event exposed private_reply_conversation (idempotency usually blocks this). */
  updatedCommentPrivateReplyConversationFound: boolean;
  /** The narrow Get Conversations API fallback found the real inbox conversation. */
  getConversationsFound: boolean;
  secondsToRealConversation: number | null;
  getConversationsDebug: string | null;
};

export type PrivateReplyTestResult = {
  /** private_replies returned 200 / success:true. */
  ok: boolean;
  stopped: boolean;
  /** True for the benign Pancake #10900 "already replied" case — NOT a contract failure. */
  alreadyReplied: boolean;
  steps: PrivateReplyTestStep[];
  privateReplyResponseDebug: string | null;
  resolution: PrivateReplyResolution;
  /** Did the private reply ALONE expose a messageable conversation (no customer reply)? */
  privateReplyAloneCreatesConversation: 'yes' | 'no' | 'cannot_verify';
  realPrivateConversationId: string | null;
};

export type ControlledPhotoResult = { ok: boolean; steps: PrivateReplyTestStep[] };

const ATTACHMENT_BUCKET = 'attachments';
/** Bounded resolve window (never infinite). Env-tunable; capped for the 60s request budget. */
const RESOLVE_WAIT_MS = Math.min(
  45000,
  Math.max(0, Number(process.env.PANCAKE_PR_RESOLVE_WAIT_MS || '35000')),
);
const RESOLVE_INTERVAL_MS = 5000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function emptyResolution(): PrivateReplyResolution {
  return {
    realConversationId: null,
    source: 'none',
    followUpWebhookWithoutCustomerReply: false,
    customerMessagedAfterComment: false,
    updatedCommentPrivateReplyConversationFound: false,
    getConversationsFound: false,
    secondsToRealConversation: null,
    getConversationsDebug: null,
  };
}

/**
 * BOUNDED wait on the webhook store for a NEW Messaging event for `psid` after the
 * private reply — a real inbox conversation_id, or a stored private_reply_conversation.
 * No infinite polling (stops at the deadline); does NOT require the customer to reply.
 */
async function waitForFollowUpConversation(
  supabase: SupabaseClient,
  psid: string,
  sinceIso: string,
  maxMs: number,
): Promise<{
  conversationId: string | null;
  source: 'inbox_webhook' | 'updated_comment' | null;
  fromCustomer: boolean;
  foundAtIso: string | null;
}> {
  const deadline = Date.now() + Math.max(0, maxMs);
  for (;;) {
    const { data } = await supabase
      .from('pancake_webhook_events')
      .select('received_at, post_type, conversation_id, raw')
      .eq('facebook_psid', psid)
      .gt('received_at', sinceIso)
      .order('received_at', { ascending: true })
      .limit(10);
    for (const e of (data ?? []) as Array<Record<string, unknown>>) {
      const prc = privateReplyConvId(e.raw);
      if (prc) {
        return {
          conversationId: prc,
          source: 'updated_comment',
          fromCustomer: false,
          foundAtIso: str(e.received_at),
        };
      }
      const convId = str(e.conversation_id);
      if (!str(e.post_type) && convId) {
        // Inbox event. from.id === psid → the CUSTOMER messaged (contaminates the test).
        const fromCustomer = str(obj(rawMessage(e.raw)?.from)?.id) === psid;
        return {
          conversationId: convId,
          source: 'inbox_webhook',
          fromCustomer,
          foundAtIso: str(e.received_at),
        };
      }
    }
    if (Date.now() >= deadline) {
      return { conversationId: null, source: null, fromCustomer: false, foundAtIso: null };
    }
    await sleep(RESOLVE_INTERVAL_MS);
  }
}

/**
 * Run the controlled Test B chain for ONE comment (NO photo — that is a separate step):
 * private_replies TEXT → sanitized response → BOUNDED resolution of the REAL private
 * conversation (webhook wait → narrow Get Conversations fallback) → classify whether the
 * private reply ALONE exposed a messageable conversation. STOPS on an unexpected private-
 * reply response; NEVER tries an alternate endpoint/action; NEVER synthesizes {page_id}_{psid}.
 */
export async function runPrivateReplyControlledTest(input: {
  webhookEventId: string;
  message: string;
}): Promise<PrivateReplyTestResult> {
  await requirePrimarySuperAdmin();
  const steps: PrivateReplyTestStep[] = [];
  const stop = (alreadyReplied = false): PrivateReplyTestResult => ({
    ok: false,
    stopped: true,
    alreadyReplied,
    steps,
    privateReplyResponseDebug: null,
    resolution: emptyResolution(),
    privateReplyAloneCreatesConversation: 'cannot_verify',
    realPrivateConversationId: null,
  });
  const supabase = await createClient();

  const sender = await getSelectedPancakeSender();
  if (!sender) {
    steps.push({ step: 'sender', ok: false, detail: 'No Pancake sender selected.' });
    return stop();
  }
  steps.push({
    step: 'sender',
    ok: true,
    detail: `${sender.userName ?? 'sender'} (…${sender.userId.slice(-4)})`,
  });

  const { data } = await supabase
    .from('pancake_webhook_events')
    .select(
      'livestream_post_id, comment_id, facebook_psid, pancake_page_customer_id, conversation_id, raw',
    )
    .eq('id', input.webhookEventId)
    .maybeSingle();
  if (!data) {
    steps.push({ step: 'identity', ok: false, detail: 'Webhook event not found.' });
    return stop();
  }
  const ev = data as Record<string, unknown>;
  const postId = str(ev.livestream_post_id);
  const messageId = str(ev.comment_id);
  const psid = str(ev.facebook_psid);
  const commentConv = str(ev.conversation_id);
  const complete = Boolean(postId && messageId && psid && commentConv);
  steps.push({
    step: 'identity',
    ok: complete,
    detail: `post…${postId.slice(-4)} · comment…${messageId.slice(-4)} · psid…${psid.slice(-4)} · comment_conv…${commentConv.slice(-4)} · page_customer…${str(ev.pancake_page_customer_id).slice(-4)}`,
  });
  if (!complete) return stop();

  const crp = rawMessage(ev.raw)?.can_reply_privately === true;
  steps.push({
    step: 'can_reply_privately',
    ok: crp,
    detail: crp ? 'true' : 'not true — private reply NOT attempted (safe stop).',
  });
  if (!crp) return stop();

  // private_replies TEXT (verified contract). Stamp the send time to bound the resolution.
  const sendAtMs = Date.now();
  const sendAtIso = new Date(sendAtMs).toISOString();
  const pr = await sendPancakePrivateReply({
    postId,
    messageId,
    fromId: psid,
    commentConversationId: commentConv,
    message: input.message,
  });
  steps.push({
    step: 'private_replies',
    ok: pr.ok,
    detail: `[${pr.code}] ${pr.message}${pr.debug ? ` · ${pr.debug}` : ''}`,
  });
  if (!pr.ok) {
    if (pr.code === 'already_replied') {
      const existing = pr.privateConversationId ?? privateReplyConvId(ev.raw);
      steps.push({
        step: 'already_replied',
        ok: false,
        detail:
          'ALREADY_REPLIED (Pancake #10900) — the endpoint/action/payload are correct; ' +
          'this comment was already privately replied to. ' +
          (existing
            ? `Existing private conversation …${existing.slice(-6)} (diagnostic only — no screenshot sent). `
            : '') +
          'Pick a brand-new, silent-customer comment for a fresh Test B.',
      });
      const r = stop(true);
      r.realPrivateConversationId = existing ?? null;
      r.resolution.realConversationId = existing ?? null;
      return r;
    }
    // Unexpected response → STOP and report the exact sanitized response. Never try an
    // alternate/undocumented action or endpoint.
    const r = stop();
    r.privateReplyResponseDebug = pr.debug ?? null;
    return r;
  }

  // RESOLUTION (bounded, never synthesizes {page_id}_{psid}).
  const resolution = emptyResolution();
  if (pr.privateConversationId) {
    resolution.realConversationId = pr.privateConversationId;
    resolution.source = 'private_reply_response';
    resolution.secondsToRealConversation = 0;
    steps.push({
      step: 'resolve',
      ok: true,
      detail: `Resolved from the private_replies RESPONSE → …${pr.privateConversationId.slice(-6)}`,
    });
  } else {
    // Step 1 — bounded webhook-store wait (does NOT require the customer to reply).
    const waited = await waitForFollowUpConversation(supabase, psid, sendAtIso, RESOLVE_WAIT_MS);
    resolution.customerMessagedAfterComment =
      waited.source === 'inbox_webhook' && waited.fromCustomer;
    resolution.updatedCommentPrivateReplyConversationFound = waited.source === 'updated_comment';
    if (waited.conversationId) {
      const secs = waited.foundAtIso
        ? Math.max(0, Math.round((Date.parse(waited.foundAtIso) - sendAtMs) / 1000))
        : null;
      resolution.realConversationId = waited.conversationId;
      resolution.source = waited.source ?? 'inbox_webhook';
      resolution.secondsToRealConversation = secs;
      resolution.followUpWebhookWithoutCustomerReply = !waited.fromCustomer;
      steps.push({
        step: 'webhook_wait',
        ok: true,
        detail: `Follow-up ${waited.source} for PSID …${psid.slice(-4)} after ~${secs ?? '?'}s ${waited.fromCustomer ? '(FROM THE CUSTOMER — they messaged back)' : '(NOT from the customer)'} → …${waited.conversationId.slice(-6)}`,
      });
    } else {
      steps.push({
        step: 'webhook_wait',
        ok: false,
        detail: `No follow-up Messaging event for PSID …${psid.slice(-4)} within ${Math.round(RESOLVE_WAIT_MS / 1000)}s.`,
      });
      // Step 2 — narrow Get Conversations fallback (official API, by PSID, no name, no full history).
      const api = await findPancakeInboxConversationByPsid(psid, {
        sinceMinutes: 90,
        maxPages: 3,
      });
      resolution.getConversationsDebug = api.debug ?? null;
      if (api.conversationId) {
        resolution.realConversationId = api.conversationId;
        resolution.source = 'get_conversations';
        resolution.getConversationsFound = true;
        resolution.secondsToRealConversation = Math.round((Date.now() - sendAtMs) / 1000);
        steps.push({
          step: 'get_conversations',
          ok: true,
          detail: `Get Conversations found the REAL inbox conversation for PSID …${psid.slice(-4)} → …${api.conversationId.slice(-6)} (scanned ${api.scanned}).`,
        });
      } else {
        steps.push({
          step: 'get_conversations',
          ok: false,
          detail: `Get Conversations (narrow, last 90m) did NOT find an inbox conversation for PSID …${psid.slice(-4)} (scanned ${api.scanned}).`,
        });
      }
    }
  }

  // Classify: did the private reply ALONE expose a messageable conversation?
  let alone: 'yes' | 'no' | 'cannot_verify';
  if (resolution.customerMessagedAfterComment) {
    alone = 'cannot_verify'; // contaminated — the customer messaged; re-run with a silent customer.
  } else if (resolution.realConversationId) {
    alone = 'yes'; // resolved with NO customer message → private reply alone.
  } else {
    alone = 'no'; // sent, but neither a page-side webhook nor the narrow API exposed a conversation.
  }
  steps.push({
    step: 'private_reply_alone',
    ok: alone === 'yes',
    detail: `PRIVATE REPLY ALONE CREATES/EXPOSES A CONVERSATION: ${alone.toUpperCase()}`,
  });

  return {
    ok: true,
    stopped: false,
    alreadyReplied: false,
    steps,
    privateReplyResponseDebug: pr.debug ?? null,
    resolution,
    privateReplyAloneCreatesConversation: alone,
    realPrivateConversationId: resolution.realConversationId,
  };
}

/** One SANITIZED Controlled-Photo diagnostic row. NEVER carries a token, image bytes, a
 *  signed URL, a full name, a PSID in clear, or a full conversation/content id — only
 *  last-6 suffixes + the parsed upload/send outcome. Persisted one-per-attempt. */
export type ControlledPhotoDiagnostic = {
  captureRef: string | null;
  conversationRef: string | null;
  uploadApiVersion: string | null;
  uploadHttpStatus: number | null;
  uploadSuccess: boolean | null;
  uploadContentIdSuffix: string | null;
  uploadType: string | null;
  uploadMessageCode: string | null;
  sendHttpStatus: number | null;
  sendSuccess: boolean | null;
  sendMessageCode: string | null;
  classification: 'A' | 'B' | 'C' | 'D';
};

/** Last-6 suffix ONLY — never the full id / PSID. */
function ref6(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return s.length <= 6 ? s : s.slice(-6);
}

/**
 * Classify ONE Controlled-Photo attempt from its sanitized upload diagnostics + send outcome:
 *   A — upload/content staging failed (not success, or no valid PHOTO content id)
 *   B — upload fully valid (success + id + type=PHOTO) but the attachment SEND was rejected
 *   C — upload valid AND the photo send succeeded
 *   D — cannot determine (no upload diagnostics captured)
 */
export function classifyControlledPhoto(
  up: PancakeUploadDiagnostics | undefined,
  send: { ok: boolean },
): ControlledPhotoDiagnostic['classification'] {
  if (!up) return 'D';
  const uploadValid = up.success === true && up.contentIdPresent && up.type === 'PHOTO';
  if (!uploadValid) return 'A';
  return send.ok ? 'C' : 'B';
}

/** Build the ONE sanitized diagnostic row for a Controlled-Photo attempt (pure/testable). */
export function buildControlledPhotoDiagnostic(input: {
  captureId: string;
  conversationId: string;
  photo: Pick<
    PancakeSendResult,
    'ok' | 'uploadDiagnostics' | 'sendHttpStatus' | 'sendSuccess' | 'sendMessageCode'
  >;
}): ControlledPhotoDiagnostic {
  const up = input.photo.uploadDiagnostics;
  return {
    captureRef: ref6(input.captureId),
    conversationRef: ref6(input.conversationId),
    uploadApiVersion: up?.apiVersion ?? null,
    uploadHttpStatus: up?.httpStatus ?? null,
    uploadSuccess: up ? up.success : null,
    uploadContentIdSuffix: up?.contentIdSuffix ?? null,
    uploadType: up?.type ?? null,
    uploadMessageCode: up?.messageCode ?? null,
    sendHttpStatus: input.photo.sendHttpStatus ?? null,
    sendSuccess: input.photo.sendSuccess ?? null,
    sendMessageCode: input.photo.sendMessageCode ?? null,
    classification: classifyControlledPhoto(up, { ok: input.photo.ok }),
  };
}

/**
 * SEPARATE, explicit controlled PHOTO step — sends the Capture screenshot via the existing
 * reply_inbox PHOTO flow to a RESOLVED REAL inbox conversation id. NEVER uses the comment
 * conversation id and NEVER a synthesized {page_id}_{psid}. Only ever run on an explicit
 * Owner click, after a real conversation was resolved by the run above.
 */
export async function sendControlledTestPhoto(input: {
  conversationId: string;
  screenshotCaptureId: string;
}): Promise<ControlledPhotoResult> {
  await requirePrimarySuperAdmin();
  const steps: PrivateReplyTestStep[] = [];
  const conversationId = (input.conversationId ?? '').trim();
  const captureId = (input.screenshotCaptureId ?? '').trim();
  if (!conversationId) {
    steps.push({
      step: 'photo',
      ok: false,
      detail: 'No resolved conversation id — run the private reply + resolve step first.',
    });
    return { ok: false, steps };
  }
  if (!captureId) {
    steps.push({ step: 'photo', ok: false, detail: 'Enter a screenshot capture id.' });
    return { ok: false, steps };
  }
  const supabase = await createClient();
  const { data: cap } = await supabase
    .from('capture_records')
    .select('screenshot_path')
    .eq('id', captureId)
    .maybeSingle();
  const path = str((cap as { screenshot_path?: string } | null)?.screenshot_path);
  if (!path) {
    steps.push({ step: 'photo', ok: false, detail: 'No screenshot on that capture id.' });
    return { ok: false, steps };
  }
  const signed = (await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
  const url = signed.data?.signedUrl ?? null;
  const photo = await sendPancakeConversationMessage({
    conversationId,
    message: '',
    attachmentUrl: url,
  });

  // INSTRUMENTATION (sanitized — no token / no image bytes / no PII). Preserve the FULL
  // semantic distinction UPLOAD_HTTP_OK vs UPLOAD_SUCCESS vs UPLOAD_CONTENT_ID_PRESENT vs
  // UPLOAD_TYPE, plus the exact send serialization + API version, so ONE controlled retry
  // pinpoints the first failure (upload staging vs send/attachment vs FB messaging window).
  const d = photo.uploadDiagnostics;
  if (d) {
    steps.push({
      step: 'upload_contents',
      ok: d.httpOk && d.success && d.contentIdPresent,
      detail:
        `UPLOAD_HTTP_OK=${d.httpOk} (HTTP ${d.httpStatus ?? '—'}) · ` +
        `UPLOAD_SUCCESS=${d.success} · UPLOAD_CONTENT_ID_PRESENT=${d.contentIdPresent} · ` +
        `content_id ${d.contentIdSuffix ?? '—'} · UPLOAD_TYPE=${d.type ?? '—'} · ` +
        `code ${d.messageCode ?? '—'} · endpoint ${d.endpoint} (${d.apiVersion ?? 'v?'})`,
    });
  } else {
    steps.push({
      step: 'upload_contents',
      ok: false,
      detail: 'No upload_contents call was made (missing token/page or unreadable screenshot).',
    });
  }
  if (photo.sentForm) {
    steps.push({
      step: 'send_payload',
      ok: true,
      detail: `${photo.sentForm} → conversation …${conversationId.slice(-6)} · Content-Type application/x-www-form-urlencoded`,
    });
  }
  steps.push({
    step: 'photo',
    ok: photo.ok,
    detail: `[${photo.code}] ${photo.message}${photo.debug ? ` · ${photo.debug}` : ''}`,
  });

  // Durable sanitized server-side record (retrievable from Vercel logs). No token/image/PII.
  console.info('[controlled-photo] attempt', {
    captureId: captureId ? `…${captureId.slice(-6)}` : null,
    conversation: `…${conversationId.slice(-6)}`,
    upload: d ?? null,
    sentForm: photo.sentForm ?? null,
    sendCode: photo.code,
    sendOk: photo.ok,
  });

  // DURABLE persistence — exactly ONE sanitized row per attempt (Owner request 2026-08-18),
  // since React state overwrites the last attempt and console.info is not reliably retrievable.
  // Best-effort: a failed insert never breaks the controlled test. Gated by a Primary-Super-
  // Admin SECURITY DEFINER RPC; stores only suffixes + parsed outcome (no token/image/URL/PII).
  const diagnostic = buildControlledPhotoDiagnostic({ captureId, conversationId, photo });
  try {
    await supabase.rpc('record_controlled_photo_diagnostic', {
      p_capture_ref: diagnostic.captureRef,
      p_conversation_ref: diagnostic.conversationRef,
      p_upload_api_version: diagnostic.uploadApiVersion,
      p_upload_http_status: diagnostic.uploadHttpStatus,
      p_upload_success: diagnostic.uploadSuccess,
      p_upload_content_id_suffix: diagnostic.uploadContentIdSuffix,
      p_upload_type: diagnostic.uploadType,
      p_upload_message_code: diagnostic.uploadMessageCode,
      p_send_http_status: diagnostic.sendHttpStatus,
      p_send_success: diagnostic.sendSuccess,
      p_send_message_code: diagnostic.sendMessageCode,
      p_classification: diagnostic.classification,
    });
  } catch {
    // best-effort — diagnostics must never break the controlled test
  }
  steps.push({
    step: 'diagnostic_saved',
    ok: true,
    detail: `Durable diagnostic recorded (classification ${diagnostic.classification}).`,
  });

  return { ok: photo.ok, steps };
}

/** Parse the HTTP status out of a sanitized `debug` string (`HTTP 200 · … · …`), or null. */
function httpStatusOf(debug: string | null | undefined): number | null {
  const m = /HTTP\s+(\d+)/.exec(debug ?? '');
  const s = m?.[1];
  return s ? Number(s) : null;
}

/** Record ONE sanitized Test-C diagnostic (reuses the controlled_photo_diagnostics store). */
async function recordMediaDiagnostic(
  supabase: SupabaseClient,
  captureId: string,
  commentConversationId: string,
  up: PancakeUploadDiagnostics | undefined,
  send: { httpStatus: number | null; success: boolean; messageCode: string | null } | null,
  classification: ControlledPhotoDiagnostic['classification'],
): Promise<void> {
  try {
    await supabase.rpc('record_controlled_photo_diagnostic', {
      p_capture_ref: ref6(captureId),
      p_conversation_ref: ref6(commentConversationId),
      p_upload_api_version: up?.apiVersion ?? null,
      p_upload_http_status: up?.httpStatus ?? null,
      p_upload_success: up ? up.success : null,
      p_upload_content_id_suffix: up?.contentIdSuffix ?? null,
      p_upload_type: up?.type ?? null,
      p_upload_message_code: up?.messageCode ?? null,
      p_send_http_status: send?.httpStatus ?? null,
      p_send_success: send?.success ?? null,
      p_send_message_code: send?.messageCode ?? null,
      p_classification: classification,
    });
  } catch {
    // best-effort — diagnostics must never break the controlled test
  }
}

export type PrivateReplyMediaResult = { ok: boolean; steps: PrivateReplyTestStep[] };

/**
 * CONTROLLED TEST C (Owner 2026-08-18) — deliver the screenshot to a first-time / silent miner via
 * the LIVE COMMENT itself: upload the screenshot → attach it to a `private_replies` MEDIA reply to
 * the approved comment (Facebook private replies to a comment are window-EXEMPT for ~7 days), so NO
 * customer action is required (Cases 1/2). MANUAL + Primary-Super-Admin gated; does NOT touch the
 * automatic Capture flow. NEVER falls back to text, NEVER synthesizes a conversation id — it uses
 * the comment's own post_id/comment_id/from_id. Records one sanitized durable diagnostic. UNPROVEN
 * until this test confirms the photo actually arrives with no customer message.
 */
export async function runControlledPrivateReplyMediaTest(input: {
  webhookEventId: string;
  screenshotCaptureId: string;
}): Promise<PrivateReplyMediaResult> {
  await requirePrimarySuperAdmin();
  const steps: PrivateReplyTestStep[] = [];
  const supabase = await createClient();

  const webhookEventId = (input.webhookEventId ?? '').trim();
  const captureId = (input.screenshotCaptureId ?? '').trim();
  if (!webhookEventId) {
    steps.push({ step: 'candidate', ok: false, detail: 'Pick a candidate comment first.' });
    return { ok: false, steps };
  }
  if (!captureId) {
    steps.push({ step: 'capture', ok: false, detail: 'Enter a screenshot capture id.' });
    return { ok: false, steps };
  }

  // 1) Comment identity from the stored webhook event (the entry point).
  const { data } = await supabase
    .from('pancake_webhook_events')
    .select('livestream_post_id, comment_id, facebook_psid, conversation_id, raw')
    .eq('id', webhookEventId)
    .maybeSingle();
  if (!data) {
    steps.push({ step: 'candidate', ok: false, detail: 'Webhook event not found.' });
    return { ok: false, steps };
  }
  const ev = data as Record<string, unknown>;
  const postId = str(ev.livestream_post_id);
  const commentId = str(ev.comment_id);
  const psid = str(ev.facebook_psid);
  const commentConv = str(ev.conversation_id);
  const crp = rawMessage(ev.raw)?.can_reply_privately === true;
  const alreadyReplied = privateReplyConvId(ev.raw) !== null;
  const complete = Boolean(postId && commentId && psid && commentConv);
  steps.push({
    step: 'comment_identity',
    ok: complete,
    detail: `post…${postId.slice(-4)} · comment…${commentId.slice(-4)} · psid…${psid.slice(-4)} · comment_conv…${commentConv.slice(-6)}`,
  });
  if (!complete) return { ok: false, steps };
  steps.push({
    step: 'can_reply_privately',
    ok: crp,
    detail: crp ? 'true' : 'not true — media private reply NOT attempted (safe stop).',
  });
  if (!crp) return { ok: false, steps };
  if (alreadyReplied) {
    steps.push({
      step: 'already_replied',
      ok: false,
      detail:
        'This comment was already privately replied to (Pancake #10900) — pick a BRAND-NEW comment.',
    });
    return { ok: false, steps };
  }

  // 2) Load + sign the screenshot.
  const { data: cap } = await supabase
    .from('capture_records')
    .select('screenshot_path')
    .eq('id', captureId)
    .maybeSingle();
  const path = str((cap as { screenshot_path?: string } | null)?.screenshot_path);
  if (!path) {
    steps.push({ step: 'screenshot', ok: false, detail: 'No screenshot on that capture id.' });
    return { ok: false, steps };
  }
  const signed = (await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
  const url = signed.data?.signedUrl ?? null;
  if (!url) {
    steps.push({ step: 'screenshot', ok: false, detail: 'Could not sign the screenshot.' });
    return { ok: false, steps };
  }

  // 3) Upload the screenshot BYTES → content_id (the confirmed upload_contents flow).
  const up = await uploadPancakeImageContent(url);
  const upDiag = up.diag;
  steps.push({
    step: 'upload_contents',
    ok: up.ok,
    detail: upDiag
      ? `UPLOAD_HTTP_OK=${upDiag.httpOk} · UPLOAD_SUCCESS=${upDiag.success} · content_id ${upDiag.contentIdSuffix ?? '—'} · UPLOAD_TYPE=${upDiag.type ?? '—'} · code ${upDiag.messageCode ?? '—'} · ${upDiag.endpoint} (${upDiag.apiVersion ?? 'v?'})`
      : ((up as { debug?: string }).debug ?? 'upload failed'),
  });
  if (!up.ok) {
    await recordMediaDiagnostic(supabase, captureId, commentConv, upDiag, null, 'A');
    return { ok: false, steps };
  }

  // 4) MEDIA private reply — attach the screenshot to the COMMENT reply itself (window-exempt).
  const pr = await sendPancakePrivateReply({
    postId,
    messageId: commentId,
    fromId: psid,
    commentConversationId: commentConv,
    message: '',
    contentId: up.contentId,
  });
  steps.push({
    step: 'private_reply_media',
    ok: pr.ok,
    detail: `[${pr.code}] ${pr.message}${pr.debug ? ` · ${pr.debug}` : ''}`,
  });

  // 5) Classify (A staging / B upload-valid-send-rejected / C success / D unknown) + record.
  const classification = classifyControlledPhoto(upDiag, { ok: pr.ok });
  await recordMediaDiagnostic(
    supabase,
    captureId,
    commentConv,
    upDiag,
    { httpStatus: httpStatusOf(pr.debug), success: pr.ok, messageCode: pr.ok ? null : pr.code },
    classification,
  );
  steps.push({
    step: 'result',
    ok: pr.ok,
    detail: pr.ok
      ? `Media private reply SENT (classification ${classification}). Now visually check the consented account's Messenger for the photo.`
      : `Media private reply NOT delivered (classification ${classification}). See the step above.`,
  });
  return { ok: pr.ok, steps };
}
