import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { captureDebugLog } from '@/lib/capture/debug-log';
import {
  conversationsMediaEligibility,
  genuineInboxDmSinceBatch,
  isConversationMediaEligible,
  psidFromConversationId,
} from '@/lib/capture/media-window';
import {
  DEFAULT_MESSAGE_SEQUENCE,
  DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
  DEFAULT_TEXT_SEND_ATTEMPTS,
  MAX_INLINE_TEXT_WAIT_MS,
  backoffBeforeNextAttempt,
  classifyPhotoSend,
  classifyTextSend,
  computationFirstRouteReason,
  isMessageSequence,
  parseScreenshotSendAttempts,
  parseTextSendAttempts,
  sequenceRouteReason,
  type MessageSequence,
  type TextSendResultLike,
} from '@/lib/capture/message-sequence';
import { sanitizeCaptureName } from '@/lib/capture/name-sanitize';
import { attemptSecureLinkPrivateReply, buildAutoTextMessageDetailed } from '@/lib/capture/route-b';
import {
  conversationBelongsToPage,
  findConversationMessageByText,
  getActivePancakePageId,
  resolveConversationForName,
  sendPancakeConversationMessage,
} from '@/lib/integrations/pancake';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * DURABLE, SERVER-SIDE capture auto-router (Owner 2026-08-22, P0-B).
 *
 * Healthy messaging must NOT depend on the Incoming Captures modal being open, a browser tab, an
 * operator click, or a client React retry loop. This runs from a Vercel Cron (see vercel.json →
 * /api/cron/capture-autosend) as the service_role, so a chat-linked capture is routed within a
 * minute whether or not anyone is looking. It reuses the EXACT verified send paths:
 *   • ROUTE A — the customer has a genuine recent Inbox DM (media-eligible) → the actual screenshot
 *     PHOTO via the existing reply_inbox flow. One-photo idempotency is enforced by the atomic DB
 *     claim (claim_capture_photo_send). Persists "AUTO SS Sent to Messenger ✓".
 *   • ROUTE B — not Inbox-eligible but an EXACT, privately-replyable Live comment resolves → ONE
 *     Pancake Private Reply TEXT with the secure /m link (the SAME verified sender Controlled Test B
 *     uses; resolved by the capture's exact PSID). One-reply idempotency is enforced by the atomic
 *     share-link claim. Persists "AUTO TEXT Sent to Messenger ✓". The customer STAYS "Photo waiting"
 *     — a TEXT reply never fakes Photo-ready.
 *   • NEITHER yet (comment webhook lag) → parked 'awaiting_inbox' for a BOUNDED, backed-off retry;
 *     after the budget the DB moves it to a FINITE 'failed' with a human-safe reason (never a
 *     permanent spinner). Needs-Review captures are never selected, so nothing is ever sent merely
 *     because a screenshot exists.
 *
 * Idempotency across overlapping cron runs / two PCs / two phones / duplicate webhooks is guaranteed
 * at the DB layer (claim_captures_to_route FOR UPDATE SKIP LOCKED + the atomic photo/share-link
 * claims). This function only orchestrates.
 */

const CAPTURE_BUCKET = 'attachments';

function ocrStr(ocr: unknown, ...keys: string[]): string | null {
  if (!ocr || typeof ocr !== 'object') return null;
  const o = ocr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

type RouterCapture = {
  id: string;
  ocr: unknown;
  screenshot_path: string | null;
  pancake_conversation_id: string | null;
  message_status: string | null;
};

export type RouteOutcome =
  | 'photo_sent'
  | 'photo_failed'
  | 'text_sent'
  | 'text_failed'
  | 'already_sent'
  | 'in_progress'
  | 'awaiting'
  | 'skipped';

// Route B codes that are TERMINAL for this capture/comment — retrying cannot succeed, so the capture
// is moved to a FINITE 'failed' immediately (finite "AUTO TEXT not sent") instead of looping the
// bounded retry budget while the operator stares at "Preparing AUTO TEXT". A fresh capture/comment is
// unaffected. 'reply_failed' = Pancake did not accept the reply (one-reply-per-comment); 'revoked' =
// the link was revoked.
const TERMINAL_ROUTE_B = new Set(['reply_failed', 'revoked']);

/** Map a Route B result code to a FINITE, operator-safe reason (no tokens/PSIDs/ids). */
function routeBReason(code: string): string {
  switch (code) {
    case 'no_exact_comment':
    case 'no_replyable_comment':
    case 'no_match':
    case 'multiple_comments_no_value':
    case 'ambiguous_claim':
    case 'ambiguous_identity':
      return 'AUTO TEXT pending · awaiting comment context';
    case 'in_progress':
      return 'AUTO TEXT sending…';
    case 'reply_failed':
      return 'AUTO TEXT not sent · Pancake did not accept the reply';
    case 'outside_window':
      return 'AUTO TEXT Failed · outside the 7-day reply window';
    case 'no_key':
      return 'AUTO TEXT Failed · secure-link key not configured';
    case 'no_screenshot':
      return 'AUTO TEXT Failed · no screenshot';
    case 'revoked':
      return 'AUTO TEXT Failed · link revoked';
    case 'computation_sent':
      return 'Computation already started in Messenger';
    default:
      return 'AUTO TEXT Failed · Pancake rejected';
  }
}

async function setRouteReason(
  admin: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  // Through the service-role-gated RPC (not a raw table mutation) — keeps every router write behind
  // a DEFINER guard, and satisfies the write-boundary invariant.
  await admin.rpc('set_capture_route_reason', { p_capture_id: id, p_reason: reason });
}

/* ==========================================================================
 * SCREENSHOT-FIRST SEQUENCE (Owner 2026-09-24).
 *
 * screenshot_first: a capture whose customer has an open Messenger window gets the SCREENSHOT,
 * then the computation TEXT as a SEPARATE request, up to N attempts (Settings, 1..3, default 3).
 * Only transient failures are retried, with bounded backoff (about 2s, then 5s; a Retry-After
 * from Pancake wins). If the text still cannot be sent, or Facebook says a customer reply is
 * needed first, the capture WAITS; a genuine customer reply then sends the text ONCE.
 * A comment-only customer cannot receive a screenshot at all until they message the page
 * (Pancake rejects a screenshot Private Reply: Controlled Test C-A), so, as the Owner decided on
 * 2026-09-24, NOTHING is sent to them: the capture waits, and their first message to the page
 * brings the screenshot, then the computation. (Earlier captures got the computation as their
 * one Private Reply; that is still recorded as the text and never sent twice.)
 *
 * Every step is an atomic database claim (migration 20260924120000): the screenshot must be
 * 'sent' before a text can be claimed; a 'sent' text is never claimed again; a claim lost
 * mid-request becomes 'unconfirmed' and is never re-sent automatically. So a page refresh,
 * a webhook replay, a realtime reconnect, a server restart or an Android reconnect cannot
 * produce a second screenshot or a second computation.
 * ======================================================================== */

/* ==========================================================================
 * COMPUTATION FIRST (Owner 2026-09-25) — the same building blocks in the other order.
 *
 * computation_first: the computation TEXT is the first message (a Messenger text when the
 * customer's chat is open, else the one comment Private Reply). Only after it is confirmed sent
 * is the SCREENSHOT attempted, at once, as its own request (content_ids, never with text), up to
 * N total attempts (Settings, 1..3, default 3), retrying only transient failures with the same
 * backoff as the text. If the screenshot is still blocked, or Facebook needs the customer to
 * message first, the capture WAITS; a genuine customer reply then sends it ONCE.
 *
 * Shared with Screenshot First: the Pancake send helper, the text claim/finalize, the result
 * classifier, the genuine-reply detector and the reply/cron entry points. The database enforces
 * the order (migration 20260925120000): the screenshot claim refuses until the computation is
 * sent, and the Private Reply claim refuses once the computation started in Messenger.
 * ======================================================================== */

type SequenceSettings = { mode: MessageSequence; attempts: number; screenshotAttempts: number };
const CLASSIC_SETTINGS: SequenceSettings = {
  mode: 'classic',
  attempts: DEFAULT_TEXT_SEND_ATTEMPTS,
  screenshotAttempts: DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
};

/** Worst case for ONE inline text attempt: the send (10s timeout), a short pause and the
 *  delivery check (10s timeout) after an ambiguous answer, plus margin. */
const INLINE_ATTEMPT_BUDGET_MS = 25_000;
/** Worst case for ONE screenshot send: read the image (10s) + upload (15s) + send (10s), plus margin. */
const PHOTO_SEND_BUDGET_MS = 36_000;
/** Default wall-clock budget when a caller passes none (the cron route allows 60s). */
const SEQUENCE_BUDGET_MS = 40_000;
/** Pause before checking the chat after an ambiguous answer, so a just-accepted message shows. */
const AMBIGUOUS_CHECK_DELAY_MS = 1500;

/** A missing column or function: the migration is not applied yet (keep the previous behaviour). */
function isMissingSchema(error: unknown): boolean {
  const e = (error && typeof error === 'object' ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  return (
    ['42703', '42P01', '42883', 'PGRST202', 'PGRST204'].includes(code) ||
    /does not exist|could not find the function|schema cache/i.test(message)
  );
}

/**
 * The Owner's messaging sequence.
 *   - migration not applied (a missing column): CLASSIC, so new code on the old database behaves
 *     exactly like the old code;
 *   - any other read failure: null. The caller then sends nothing this time and the capture is
 *     retried on the next sweep, instead of stamping a sequence the Owner did not choose.
 */
export async function readMessageSequenceSettings(
  admin: SupabaseClient,
): Promise<SequenceSettings | null> {
  try {
    const read = (columns: string) =>
      admin.from('pancake_integration_config').select(columns).maybeSingle() as unknown as Promise<{
        data: unknown;
        error: unknown;
      }>;
    let { data, error } = await read(
      'private_reply_sequence, text_send_attempts, screenshot_send_attempts',
    );
    // Before migration 20260925120000 there is no Screenshot Send Attempts: read the rest exactly
    // as before (never fall back to Classic just because that one column is missing).
    if (error && isMissingSchema(error)) {
      ({ data, error } = await read('private_reply_sequence, text_send_attempts'));
    }
    if (error) return isMissingSchema(error) ? CLASSIC_SETTINGS : null;
    const row = data as {
      private_reply_sequence?: unknown;
      text_send_attempts?: unknown;
      screenshot_send_attempts?: unknown;
    } | null;
    if (!row) {
      return {
        mode: DEFAULT_MESSAGE_SEQUENCE,
        attempts: DEFAULT_TEXT_SEND_ATTEMPTS,
        screenshotAttempts: DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
      };
    }
    return {
      mode: isMessageSequence(row.private_reply_sequence)
        ? row.private_reply_sequence
        : CLASSIC_SETTINGS.mode,
      attempts: parseTextSendAttempts(row.text_send_attempts) ?? DEFAULT_TEXT_SEND_ATTEMPTS,
      screenshotAttempts:
        parseScreenshotSendAttempts(row.screenshot_send_attempts) ?? DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
    };
  } catch {
    // An unexpected client failure: the previous behaviour, never a guessed new one.
    return CLASSIC_SETTINGS;
  }
}

/**
 * Stamp the capture's sequence ONCE (set-once in the database) and return the effective one.
 * A capture already in flight keeps its original sequence when the Owner changes the setting.
 * Returns null when the sequence cannot be determined right now: the caller must not send.
 */
async function stampSequence(
  admin: SupabaseClient,
  captureId: string,
  settings: SequenceSettings | null,
): Promise<MessageSequence | null> {
  if (!settings) return null;
  try {
    const res = (await admin.rpc('start_capture_message_sequence', {
      p_capture_id: captureId,
      p_mode: settings.mode,
      // The attempt setting that belongs to the sequence (screenshot attempts on Computation First).
      p_max_attempts:
        settings.mode === 'computation_first' ? settings.screenshotAttempts : settings.attempts,
    })) as { data: unknown; error: unknown };
    if (res.error) return isMissingSchema(res.error) ? 'classic' : null;
    return isMessageSequence(res.data) ? res.data : 'classic';
  } catch {
    return 'classic';
  }
}

async function finalizeText(
  admin: SupabaseClient,
  captureId: string,
  outcome: 'sent' | 'retry' | 'waiting_reply' | 'failed' | 'unconfirmed',
  code: string,
  messageId: string | null = null,
  retryAfterSeconds: number | null = null,
): Promise<string | null> {
  const res = (await admin.rpc('finalize_capture_text_send', {
    p_capture_id: captureId,
    p_outcome: outcome,
    p_code: code,
    p_message_id: messageId,
    p_retry_after_seconds: retryAfterSeconds,
  })) as { data: unknown };
  return typeof res.data === 'string' ? res.data : null;
}

/** A PII-free production warning for a text that did not go out cleanly. */
function warnText(captureId: string, outcome: string, code: string): void {
  console.warn(
    '[capture-text] not_sent',
    JSON.stringify({ capture: captureId.slice(-6), outcome, code: code.slice(0, 60) }),
  );
}

export type TextSequenceOutcome =
  | 'text_sent'
  | 'waiting_reply'
  | 'text_failed'
  | 'unconfirmed'
  | 'deferred'
  | 'already_sent'
  | 'skipped';

export type TextSequenceDeps = {
  send: typeof sendPancakeConversationMessage;
  verify: typeof findConversationMessageByText;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

// Resolved at CALL time (not module load) so a partial module mock never breaks an import.
const DEFAULT_TEXT_DEPS: TextSequenceDeps = {
  send: (input) => sendPancakeConversationMessage(input),
  verify: (conversationId, text, sinceMs) =>
    findConversationMessageByText(conversationId, text, sinceMs),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

type TextLegRow = {
  ocr: unknown;
  canonical_grams: string | null;
  pancake_conversation_id: string | null;
  message_sequence?: string | null;
};

/** The computation text state → its route_reason line, in the capture's own sequence wording. */
function textRouteReason(
  computationFirst: boolean,
  state: 'sent' | 'waiting_reply' | 'failed' | 'unconfirmed' | 'pending',
): string {
  if (!computationFirst) return sequenceRouteReason(state);
  switch (state) {
    case 'sent':
      return computationFirstRouteReason('photo_pending');
    case 'waiting_reply':
      return computationFirstRouteReason('text_waiting_reply');
    case 'failed':
      return computationFirstRouteReason('text_failed');
    case 'unconfirmed':
      return computationFirstRouteReason('text_unconfirmed');
    default:
      return computationFirstRouteReason('text_pending');
  }
}

/**
 * Send the computation TEXT for ONE sequenced capture: claim → send (a text-only request, never
 * with the image) → classify → finalize, looping only on transient failures while attempts and
 * the time budget remain. trigger 'reply' is the single send unlocked by a genuine customer reply
 * after the capture started waiting. The database decides every state change.
 *
 * Screenshot First: this is the second step (the screenshot went first). Computation First: this
 * is the FIRST step, and what follows it runs here too — the screenshot once the computation is
 * confirmed sent (unless opts.photo is 'defer': the caller schedules it), else the capture's
 * visible state (waiting for a reply / not sent).
 */
export async function runCaptureTextSequence(
  admin: SupabaseClient,
  captureId: string,
  opts: { trigger: 'auto' | 'reply'; deadlineAt: number; photo?: 'inline' | 'defer' },
  deps: Partial<TextSequenceDeps> = {},
): Promise<TextSequenceOutcome> {
  const d: TextSequenceDeps = { ...DEFAULT_TEXT_DEPS, ...deps };

  let row: TextLegRow;
  try {
    const { data, error } = await admin
      .from('capture_records')
      .select('id, ocr, canonical_grams, pancake_conversation_id, message_sequence')
      .eq('id', captureId)
      .maybeSingle();
    if (error || !data) return 'skipped';
    row = data;
  } catch {
    return 'skipped';
  }

  const computationFirst = row.message_sequence === 'computation_first';
  const outcome = await runTextLeg(admin, captureId, row, opts, d, computationFirst);
  if (!computationFirst) return outcome;

  switch (outcome) {
    case 'text_sent':
    case 'already_sent':
      // THEN the screenshot, only now that the computation is out.
      if (opts.photo !== 'defer') {
        await runCapturePhotoSequence(admin, captureId, { trigger: 'auto', deadlineAt: opts.deadlineAt }, d);
      }
      break;
    case 'waiting_reply':
      // Nothing more until the customer replies (the reply sends the computation, then the screenshot).
      await admin.rpc('mark_capture_photo_state', { p_capture_id: captureId, p_status: 'link_sent' });
      break;
    case 'text_failed':
    case 'unconfirmed':
      // The screenshot never goes before the computation: a finite state staff can see.
      await admin.rpc('mark_capture_photo_state', { p_capture_id: captureId, p_status: 'failed' });
      break;
    default:
      break;
  }
  return outcome;
}

async function runTextLeg(
  admin: SupabaseClient,
  captureId: string,
  row: TextLegRow,
  opts: { trigger: 'auto' | 'reply'; deadlineAt: number },
  d: TextSequenceDeps,
  computationFirst: boolean,
): Promise<TextSequenceOutcome> {
  const reason = (state: Parameters<typeof textRouteReason>[1]) =>
    textRouteReason(computationFirst, state);
  const conv = (row.pancake_conversation_id ?? '').trim();
  const fbName = sanitizeCaptureName(
    ocrStr(row.ocr, 'fbName', 'fb_name', 'name'),
    (row.ocr as { rawLines?: unknown } | null)?.rawLines,
  );
  // The SAME authoritative computation text as the Private Reply (canonical grams when the exact
  // comment proved them, else the capture's value); the formatting is never changed here.
  const value = (row.canonical_grams ?? '').trim() || ocrStr(row.ocr, 'itemQuery', 'grams', 'weight');
  let message: string | null = null;
  if (conv && fbName) {
    try {
      const built = await buildAutoTextMessageDetailed(admin, fbName, value);
      // The shared rate could not be READ: a transient failure — nothing is claimed and the
      // next sweep tries again. Only genuinely incomplete data becomes a finite failure below.
      if (built.readError) return 'skipped';
      message = built.message;
    } catch {
      return 'skipped';
    }
  }

  let retries = 0;
  for (;;) {
    // Never start an attempt that could outlive the caller's time budget.
    if (d.now() + INLINE_ATTEMPT_BUDGET_MS > opts.deadlineAt) return 'deferred';

    const claimRes = (await admin.rpc('claim_capture_text_send', {
      p_capture_id: captureId,
      p_trigger: opts.trigger,
    })) as { data: unknown };
    const claim = typeof claimRes.data === 'string' ? claimRes.data : null;
    if (claim !== 'claimed') {
      if (claim === 'already_sent') return 'already_sent';
      if (claim === 'waiting_reply') {
        await setRouteReason(admin, captureId, reason('waiting_reply'));
        return 'waiting_reply';
      }
      if (claim === 'unconfirmed') {
        await setRouteReason(admin, captureId, reason('unconfirmed'));
        warnText(captureId, 'unconfirmed', 'stale_claim');
        return 'unconfirmed';
      }
      if (claim === 'failed') return 'text_failed';
      return 'skipped'; // not_ready (no screenshot yet) · not_due · in_progress · not_applicable
    }

    if (!message) {
      // Nothing authoritative to send (no conversation / incomplete price data): a finite
      // state staff can see; never a guessed or partial computation.
      const code = conv ? 'incomplete_business_data' : 'no_conversation';
      await finalizeText(admin, captureId, 'failed', code);
      await setRouteReason(admin, captureId, reason('failed'));
      warnText(captureId, 'failed', code);
      return 'text_failed';
    }

    const attemptStartedAt = d.now();
    const res = await d.send({ conversationId: conv, message });
    const cls = classifyTextSend(res);

    if (cls.kind === 'sent') {
      await finalizeText(admin, captureId, 'sent', 'sent', res.pancakeMessageId ?? null);
      await setRouteReason(admin, captureId, reason('sent'));
      return 'text_sent';
    }
    if (cls.kind === 'wait_reply') {
      await finalizeText(admin, captureId, 'waiting_reply', res.code);
      await setRouteReason(admin, captureId, reason('waiting_reply'));
      warnText(captureId, 'waiting_reply', res.code);
      return 'waiting_reply';
    }
    if (cls.kind === 'failed') {
      await finalizeText(admin, captureId, 'failed', res.code);
      await setRouteReason(admin, captureId, reason('failed'));
      warnText(captureId, 'failed', res.code);
      return 'text_failed';
    }

    if (cls.kind === 'ambiguous') {
      // The request may have reached Pancake (a gateway can still deliver it seconds later).
      // Look for this exact text, NEWER than this attempt: found → sent. Anything else is
      // "unconfirmed" and is NEVER re-sent automatically — a duplicate computation is worse
      // than a staff check.
      await d.sleep(AMBIGUOUS_CHECK_DELAY_MS);
      const seen = await d.verify(conv, message, attemptStartedAt).catch(() => 'unknown' as const);
      if (seen === 'found') {
        await finalizeText(admin, captureId, 'sent', 'confirmed_after_ambiguous');
        await setRouteReason(admin, captureId, reason('sent'));
        return 'text_sent';
      }
      const code = `${res.code}:${res.transport ?? String(res.sendHttpStatus ?? 'unknown')}:${seen}`;
      await finalizeText(admin, captureId, 'unconfirmed', code);
      await setRouteReason(admin, captureId, reason('unconfirmed'));
      warnText(captureId, 'unconfirmed', code);
      return 'unconfirmed';
    }
    const retryAfterMs = cls.retryAfterMs;
    const retryCode: string = res.code;

    // Transient failure.
    if (opts.trigger === 'reply') {
      // A reply unlocks ONE send; a transient failure waits for the next genuine reply.
      await finalizeText(admin, captureId, 'waiting_reply', retryCode);
      await setRouteReason(admin, captureId, reason('waiting_reply'));
      warnText(captureId, 'waiting_reply', retryCode);
      return 'waiting_reply';
    }
    // The backoff is PERSISTED (text_next_at), so no other worker can make the next attempt early.
    const wait = backoffBeforeNextAttempt(retries, retryAfterMs);
    const waitSeconds = Math.ceil(wait / 1000);
    const next = await finalizeText(admin, captureId, 'retry', retryCode, null, waitSeconds);
    if (next !== 'pending') {
      if (next === 'waiting_reply') {
        await setRouteReason(admin, captureId, reason('waiting_reply'));
        warnText(captureId, 'waiting_reply', retryCode);
        return 'waiting_reply';
      }
      return 'skipped';
    }
    retries += 1;
    if (
      wait > MAX_INLINE_TEXT_WAIT_MS ||
      d.now() + waitSeconds * 1000 + INLINE_ATTEMPT_BUDGET_MS > opts.deadlineAt
    ) {
      // Still due: the next every-minute sweep continues from the persisted attempt count.
      await setRouteReason(admin, captureId, reason('pending'));
      return 'deferred';
    }
    await d.sleep(waitSeconds * 1000 + 300);
  }
}

export type PhotoSequenceOutcome =
  | 'photo_sent'
  | 'waiting_reply'
  | 'photo_failed'
  | 'unconfirmed'
  | 'deferred'
  | 'already_sent'
  | 'skipped';

async function finalizePhoto(
  admin: SupabaseClient,
  captureId: string,
  outcome: 'sent' | 'retry' | 'waiting_reply' | 'failed' | 'unconfirmed',
  code: string,
  messageId: string | null = null,
  retryAfterSeconds: number | null = null,
): Promise<string | null> {
  const res = (await admin.rpc('finalize_capture_photo_leg', {
    p_capture_id: captureId,
    p_outcome: outcome,
    p_code: code,
    p_message_id: messageId,
    p_retry_after_seconds: retryAfterSeconds,
  })) as { data: unknown };
  return typeof res.data === 'string' ? res.data : null;
}

/** A short, PII-free code for a screenshot send result (stage, Pancake code, HTTP status). */
function photoCode(res: TextSendResultLike): string {
  const status = res.sendHttpStatus ?? res.uploadDiagnostics?.httpStatus ?? null;
  return [res.stage === 'upload' ? 'upload' : null, res.code, status === null ? null : String(status)]
    .filter(Boolean)
    .join(':')
    .slice(0, 60);
}

function warnPhoto(captureId: string, outcome: string, code: string): void {
  console.warn(
    '[capture-photo] not_sent',
    JSON.stringify({ capture: captureId.slice(-6), outcome, code: code.slice(0, 60) }),
  );
}

/**
 * Computation First: send the SCREENSHOT for ONE capture whose computation is already sent.
 * claim (the database refuses until the computation is sent) → upload + send the image alone
 * (content_ids, never with text) → classify → finalize, looping only on transient failures while
 * attempts and the time budget remain. trigger 'reply' is the single send a genuine customer
 * reply unlocks after the capture started waiting.
 *
 * Facebook accepts a screenshot only inside an open Messenger window (a genuine message from the
 * customer). Without one, an attempt is a known rejection (the 2026-08-18 P0: never a doomed
 * photo), so the capture waits for the customer's message without sending anything — the same
 * "customer interaction required" answer, known before the request.
 *
 * A timeout or gateway error after the request left is AMBIGUOUS: the image may have arrived and
 * an image cannot be matched in the chat the way a text can, so it becomes 'unconfirmed' and is
 * never re-sent automatically (staff check the chat; Retry is an explicit click).
 */
export async function runCapturePhotoSequence(
  admin: SupabaseClient,
  captureId: string,
  opts: { trigger: 'auto' | 'reply'; deadlineAt: number },
  deps: Partial<TextSequenceDeps> = {},
): Promise<PhotoSequenceOutcome> {
  const d: TextSequenceDeps = { ...DEFAULT_TEXT_DEPS, ...deps };

  let row: {
    screenshot_path: string | null;
    pancake_conversation_id: string | null;
    message_sequence: string | null;
  };
  try {
    const { data, error } = await admin
      .from('capture_records')
      .select('id, screenshot_path, pancake_conversation_id, message_sequence')
      .eq('id', captureId)
      .maybeSingle();
    if (error || !data) return 'skipped';
    row = data;
  } catch {
    return 'skipped';
  }
  if (row.message_sequence !== 'computation_first') return 'skipped';

  const conv = (row.pancake_conversation_id ?? '').trim();
  const path = (row.screenshot_path ?? '').trim();
  if (!conv || !path) return 'skipped';
  const activePage = await getActivePancakePageId();
  if (!conversationBelongsToPage(conv, activePage)) return 'skipped';

  if (!(await isConversationMediaEligible(admin, conv))) {
    const parked = (await admin.rpc('park_capture_photo_leg', {
      p_capture_id: captureId,
      p_code: 'no_open_chat',
    })) as { data: unknown };
    if (parked.data === 'waiting_reply') {
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_waiting_reply'));
      return 'waiting_reply';
    }
    return 'skipped'; // the computation is not sent yet, or the screenshot is already handled
  }

  let retries = 0;
  for (;;) {
    // Never start an attempt that could outlive the caller's time budget.
    if (d.now() + PHOTO_SEND_BUDGET_MS > opts.deadlineAt) return 'deferred';

    const signed = (await admin.storage
      .from(CAPTURE_BUCKET)
      .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
    const attachmentUrl = signed.data?.signedUrl ?? null;
    // A storage hiccup: nothing is claimed; the next sweep tries again.
    if (!attachmentUrl) return 'skipped';

    const claimRes = (await admin.rpc('claim_capture_photo_leg', {
      p_capture_id: captureId,
      p_conversation_id: conv,
      p_trigger: opts.trigger,
    })) as { data: unknown };
    const claim = typeof claimRes.data === 'string' ? claimRes.data : null;
    if (claim !== 'claimed') {
      if (claim === 'already_sent') return 'already_sent';
      if (claim === 'waiting_reply') {
        await setRouteReason(admin, captureId, computationFirstRouteReason('photo_waiting_reply'));
        return 'waiting_reply';
      }
      if (claim === 'unconfirmed') {
        await setRouteReason(admin, captureId, computationFirstRouteReason('photo_unconfirmed'));
        warnPhoto(captureId, 'unconfirmed', 'stale_claim');
        return 'unconfirmed';
      }
      if (claim === 'failed') return 'photo_failed';
      return 'skipped'; // text_not_sent · not_due · in_progress · not_applicable · not_found
    }

    // The image ALONE: content_ids, never a text message in the same request.
    const res = await d.send({ conversationId: conv, message: '', attachmentUrl });
    const cls = classifyPhotoSend(res);
    const code = photoCode(res);

    if (cls.kind === 'sent') {
      await finalizePhoto(admin, captureId, 'sent', 'sent', res.pancakeMessageId ?? null);
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_sent'));
      return 'photo_sent';
    }
    if (cls.kind === 'wait_reply') {
      await finalizePhoto(admin, captureId, 'waiting_reply', code);
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_waiting_reply'));
      warnPhoto(captureId, 'waiting_reply', code);
      return 'waiting_reply';
    }
    if (cls.kind === 'failed') {
      await finalizePhoto(admin, captureId, 'failed', code);
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_failed'));
      warnPhoto(captureId, 'failed', code);
      return 'photo_failed';
    }
    if (cls.kind === 'ambiguous') {
      const ambiguous = `${code}:${res.transport ?? 'gateway'}`.slice(0, 60);
      await finalizePhoto(admin, captureId, 'unconfirmed', ambiguous);
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_unconfirmed'));
      warnPhoto(captureId, 'unconfirmed', ambiguous);
      return 'unconfirmed';
    }

    // Transient failure.
    if (opts.trigger === 'reply') {
      // A reply unlocks ONE send; a transient failure waits for the next genuine reply.
      await finalizePhoto(admin, captureId, 'waiting_reply', code);
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_waiting_reply'));
      warnPhoto(captureId, 'waiting_reply', code);
      return 'waiting_reply';
    }
    // The backoff is PERSISTED (photo_next_at), so no other worker can make the next attempt early.
    const wait = backoffBeforeNextAttempt(retries, cls.retryAfterMs);
    const waitSeconds = Math.ceil(wait / 1000);
    const next = await finalizePhoto(admin, captureId, 'retry', code, null, waitSeconds);
    if (next !== 'pending') {
      if (next === 'waiting_reply') {
        await setRouteReason(admin, captureId, computationFirstRouteReason('photo_waiting_reply'));
        warnPhoto(captureId, 'waiting_reply', code);
        return 'waiting_reply';
      }
      return 'skipped';
    }
    retries += 1;
    if (
      wait > MAX_INLINE_TEXT_WAIT_MS ||
      d.now() + waitSeconds * 1000 + PHOTO_SEND_BUDGET_MS > opts.deadlineAt
    ) {
      // Still due: the next every-minute sweep continues from the persisted attempt count.
      await setRouteReason(admin, captureId, computationFirstRouteReason('photo_pending'));
      return 'deferred';
    }
    await d.sleep(waitSeconds * 1000 + 300);
  }
}

/** Computation First after a genuine customer reply (or its cron fallback): a screenshot that
 *  was WAITING is sent once, but only for a reply NEWER than the wait; a screenshot still due is
 *  simply continued. Never before the computation (the database claim refuses). */
async function resumePhotoAfterReply(
  admin: SupabaseClient,
  captureId: string,
  conversationId: string,
  deadlineAt: number,
): Promise<PhotoSequenceOutcome> {
  const { data } = (await admin
    .from('capture_records')
    .select('photo_send_status, photo_waiting_since')
    .eq('id', captureId)
    .maybeSingle()) as {
    data: { photo_send_status?: string | null; photo_waiting_since?: string | null } | null;
  };
  if (!data) return 'skipped';
  if (data.photo_send_status === 'waiting_reply') {
    const since = data.photo_waiting_since ?? '';
    if (!since) return 'skipped';
    const replied = await genuineInboxDmSinceBatch(admin, [
      { key: captureId, conversationId, sinceIso: since },
    ]);
    if (!replied.has(captureId)) return 'skipped';
    return runCapturePhotoSequence(admin, captureId, { trigger: 'reply', deadlineAt });
  }
  return runCapturePhotoSequence(admin, captureId, { trigger: 'auto', deadlineAt });
}

/** Computation First, comment-only customer: the computation went as the ONE Private Reply. Record
 *  it as the computation (never sent again) and let the screenshot wait for their message. */
async function recordComputationPrivateReply(admin: SupabaseClient, captureId: string): Promise<void> {
  await admin.rpc('mark_capture_text_sent_by_private_reply', { p_capture_id: captureId });
  await admin.rpc('park_capture_photo_leg', { p_capture_id: captureId, p_code: 'comment_only' });
  await setRouteReason(admin, captureId, computationFirstRouteReason('photo_waiting_reply'));
}

/** Continue screenshot-first text work that is DUE (never started, a retry whose time has come,
 *  or a lost claim, which the claim turns into 'unconfirmed'). The list comes from the database,
 *  oldest due first, so waiting captures can never starve due ones. Before the migration the
 *  function does not exist and this simply does nothing. */
async function runDueTextLegs(
  admin: SupabaseClient,
  deadlineAt: number,
): Promise<{ sent: number; considered: number }> {
  let ids: string[] = [];
  try {
    const res = (await admin.rpc('list_due_capture_text_legs', { p_limit: 20 })) as {
      data: unknown;
      error: unknown;
    };
    if (res.error || !Array.isArray(res.data)) return { sent: 0, considered: 0 };
    ids = (res.data as unknown[]).filter((v): v is string => typeof v === 'string');
  } catch {
    return { sent: 0, considered: 0 };
  }
  let sent = 0;
  for (const id of ids) {
    if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) break;
    const outcome = await runCaptureTextSequence(admin, id, { trigger: 'auto', deadlineAt });
    if (outcome === 'text_sent') sent += 1;
  }
  return { sent, considered: ids.length };
}

/** Continue Computation First screenshots that are DUE (not attempted yet after the computation,
 *  a retry whose time has come, or a lost claim). Before migration 20260925120000 the function
 *  does not exist and this simply does nothing. */
async function runDuePhotoLegs(
  admin: SupabaseClient,
  deadlineAt: number,
): Promise<{ sent: number; considered: number }> {
  let ids: string[] = [];
  try {
    const res = (await admin.rpc('list_due_capture_photo_legs', { p_limit: 20 })) as {
      data: unknown;
      error: unknown;
    };
    if (res.error || !Array.isArray(res.data)) return { sent: 0, considered: 0 };
    ids = (res.data as unknown[]).filter((v): v is string => typeof v === 'string');
  } catch {
    return { sent: 0, considered: 0 };
  }
  let sent = 0;
  for (const id of ids) {
    if (Date.now() + PHOTO_SEND_BUDGET_MS > deadlineAt) break;
    const outcome = await runCapturePhotoSequence(admin, id, { trigger: 'auto', deadlineAt });
    if (outcome === 'photo_sent') sent += 1;
  }
  return { sent, considered: ids.length };
}

/** Computation First into an OPEN Messenger chat: store the chat, then the computation, then (in
 *  runCaptureTextSequence, only once the computation is sent) the screenshot. */
async function routeComputationFirstInbox(
  admin: SupabaseClient,
  id: string,
  conversationId: string,
  deadlineAt: number,
): Promise<{ outcome: RouteOutcome; reason: string }> {
  if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) {
    return { outcome: 'awaiting', reason: 'budget' };
  }
  await admin.rpc('set_capture_sequence_conversation', {
    p_capture_id: id,
    p_conversation_id: conversationId,
  });
  const t = await runCaptureTextSequence(admin, id, { trigger: 'auto', deadlineAt });
  const outcome: RouteOutcome =
    t === 'text_sent'
      ? 'text_sent'
      : t === 'already_sent'
        ? 'already_sent'
        : t === 'text_failed'
          ? 'text_failed'
          : 'awaiting';
  return { outcome, reason: `computation_first:${t}` };
}

/** The capture's computation state (null = never started), or undefined when it cannot be read. */
async function readTextSendStatus(
  admin: SupabaseClient,
  id: string,
): Promise<string | null | undefined> {
  try {
    const { data, error } = (await admin
      .from('capture_records')
      .select('text_send_status')
      .eq('id', id)
      .maybeSingle()) as { data: { text_send_status?: string | null } | null; error: unknown };
    if (error || !data) return undefined;
    return data.text_send_status ?? null;
  } catch {
    return undefined;
  }
}

/** Route ONE claimed capture. Returns its outcome for the cron summary (no PII). */
async function routeOne(
  admin: SupabaseClient,
  activePage: string,
  cap: RouterCapture,
  ctx: { settings: SequenceSettings | null; deadlineAt: number } = {
    settings: CLASSIC_SETTINGS,
    deadlineAt: Date.now() + SEQUENCE_BUDGET_MS,
  },
): Promise<{ outcome: RouteOutcome; reason: string }> {
  const id = cap.id;
  const conversationId = (cap.pancake_conversation_id ?? '').trim();
  const path = (cap.screenshot_path ?? '').trim();
  const fbName = sanitizeCaptureName(
    ocrStr(cap.ocr, 'fbName', 'fb_name', 'name'),
    (cap.ocr as { rawLines?: unknown } | null)?.rawLines,
  );
  const value = ocrStr(cap.ocr, 'itemQuery', 'grams', 'weight');

  if (!path) {
    await admin.rpc('mark_capture_photo_state', {
      p_capture_id: id,
      p_status: 'awaiting_inbox',
    });
    await setRouteReason(admin, id, 'AUTO not sent · no screenshot');
    return { outcome: 'awaiting', reason: 'no_screenshot' };
  }

  // A real on-page inbox conversation stored on the capture.
  const onPageConv =
    conversationId && conversationBelongsToPage(conversationId, activePage)
      ? conversationId
      : null;

  // SCREENSHOT HAS PRIORITY (Owner 2026-08-22). The actual PHOTO must win whenever the EXACT customer
  // has a genuine media-eligible Inbox conversation — even when THIS capture has no stored
  // pancake_conversation_id yet (webhook lag, or a comment-first identity). So mirror the proven
  // manual path (pc-send): use the stored on-page conversation, else RESOLVE the customer's real Inbox
  // conversation by the exact name (unique-match only — a wrong-page/ambiguous name yields nothing).
  // Media eligibility is the AUTHORITATIVE gate below: a discovered {page}_{psid} with no genuine
  // Inbox DM (a comment-only "Photo waiting" customer) fails it and correctly falls to Route B.
  let convForPhoto = onPageConv;
  if (!convForPhoto && fbName) {
    const resolved = await resolveConversationForName(admin, fbName, {
      sinceDays: 14,
      maxPages: 8,
      // Service-role sweep: skip the staff-gated webhook fast-match RPC (it can only 42501 under the
      // admin client, and tiers 1+2 already cover the system path) — see resolveConversationForName.
      // Removes the per-Live-comment "Not authorized." Postgres error with no behaviour change.
      system: true,
    });
    if (
      resolved.conversationId &&
      conversationBelongsToPage(resolved.conversationId, activePage)
    ) {
      convForPhoto = resolved.conversationId;
    }
  }

  // ROUTE A — genuine media eligibility → actual screenshot PHOTO (never a secure link instead).
  if (convForPhoto) {
    const eligible = await isConversationMediaEligible(admin, convForPhoto);
    if (eligible) {
      const signed = (await admin.storage
        .from(CAPTURE_BUCKET)
        .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
      const attachmentUrl = signed.data?.signedUrl ?? null;
      if (!attachmentUrl) {
        await admin.rpc('mark_capture_photo_state', {
          p_capture_id: id,
          p_status: 'awaiting_inbox',
        });
        await setRouteReason(admin, id, 'AUTO SS pending · screenshot URL unavailable');
        return { outcome: 'awaiting', reason: 'no_signed_url' };
      }
      // The capture's sequence is fixed (set-once) just before its first send.
      const mode = await stampSequence(admin, id, ctx.settings);
      if (mode === null) {
        await setRouteReason(admin, id, 'AUTO SS pending · retrying shortly');
        return { outcome: 'awaiting', reason: 'sequence_unavailable' };
      }
      if (mode === 'computation_first') {
        // COMPUTATION FIRST: the computation text, then the screenshot.
        return routeComputationFirstInbox(admin, id, convForPhoto, ctx.deadlineAt);
      }
      if (Date.now() + PHOTO_SEND_BUDGET_MS > ctx.deadlineAt) {
        // Out of time for a whole screenshot send: nothing claimed; the next sweep sends it.
        return { outcome: 'awaiting', reason: 'budget' };
      }
      const claim = (
        await admin.rpc('claim_capture_photo_send', {
          p_capture_id: id,
          p_conversation_id: convForPhoto,
        })
      ).data as string;
      if (claim === 'already_sent') {
        if (mode === 'screenshot_first') {
          // The screenshot is out; make sure its text leg continues (idempotent claim).
          const t = await runCaptureTextSequence(admin, id, {
            trigger: 'auto',
            deadlineAt: ctx.deadlineAt,
          });
          if (t === 'already_sent') await setRouteReason(admin, id, sequenceRouteReason('sent'));
          return { outcome: 'already_sent', reason: `already_sent:${t}` };
        }
        await setRouteReason(admin, id, 'AUTO SS Sent to Messenger ✓');
        return { outcome: 'already_sent', reason: 'already_sent' };
      }
      if (claim !== 'claimed')
        return { outcome: 'in_progress', reason: 'photo_in_progress' };

      // SCREENSHOT FIRST: the image goes alone (content_ids, never with text).
      const res = await sendPancakeConversationMessage({
        conversationId: convForPhoto,
        message: '',
        attachmentUrl,
      });
      await admin.rpc('finalize_capture_photo_send', {
        p_capture_id: id,
        p_ok: res.ok,
        p_pancake_message_id: res.pancakeMessageId,
        p_conversation_id: convForPhoto,
      });
      if (res.ok && mode === 'screenshot_first') {
        // THEN the computation text, as its own request, only after the screenshot succeeded.
        await setRouteReason(admin, id, sequenceRouteReason('pending'));
        const t = await runCaptureTextSequence(admin, id, {
          trigger: 'auto',
          deadlineAt: ctx.deadlineAt,
        });
        return { outcome: 'photo_sent', reason: `photo_sent:${t}` };
      }
      // A screenshot failure never falls through to text: the existing finite 'failed' state
      // (reviewable, with Retry) applies in both sequences.
      await setRouteReason(
        admin,
        id,
        res.ok ? 'AUTO SS Sent to Messenger ✓' : `AUTO SS Failed · ${res.code}`,
      );
      return { outcome: res.ok ? 'photo_sent' : 'photo_failed', reason: res.code };
    }
  }

  // ROUTE B — secure-link Private Reply TEXT to the EXACT resolved Live comment (verified Test-B
  // contract). Keyed off the exact PSID when we have the conversation (stored OR discovered above),
  // else resolved BY NAME (resolve_exact_live_comment gates unique-PSID + can_reply_privately, else
  // Needs Review) — so a capture the PC never opened still auto-sends, fully server-side.
  const psid = convForPhoto ? psidFromConversationId(convForPhoto) : null;
  if (!psid && !fbName) {
    await admin.rpc('mark_capture_photo_state', {
      p_capture_id: id,
      p_status: 'awaiting_inbox',
    });
    await setRouteReason(admin, id, 'AUTO TEXT pending · awaiting comment context');
    return { outcome: 'awaiting', reason: 'no_identity' };
  }
  // Comment-only customer: a screenshot cannot go first (Pancake rejects a screenshot Private
  // Reply). Classic: the ONE Private Reply carries the computation, as before.
  const mode = await stampSequence(admin, id, ctx.settings);
  if (mode === null) {
    await setRouteReason(admin, id, 'AUTO TEXT pending · retrying shortly');
    return { outcome: 'awaiting', reason: 'sequence_unavailable' };
  }
  if (mode === 'screenshot_first') {
    // Screenshot-first (Owner 2026-09-24): send NOTHING to a comment-only customer. The moment
    // they message the page, the reply path sends the screenshot, then the computation. With the
    // conversation stored on the capture it waits as 'link_sent' (what the reply path picks up);
    // without one it stays 'awaiting_inbox' so the next sweep can still find the conversation.
    await admin.rpc('mark_capture_photo_state', {
      p_capture_id: id,
      p_status: onPageConv ? 'link_sent' : 'awaiting_inbox',
    });
    await setRouteReason(admin, id, sequenceRouteReason('awaiting_message'));
    return { outcome: 'awaiting', reason: 'awaiting_customer_message' };
  }
  if (mode === 'computation_first') {
    // Computation First, no open chat: the computation goes ONCE. If it already started in
    // Messenger it is never repeated as a Private Reply (the database refuses that too); a sent
    // computation just leaves the screenshot waiting for the customer's message.
    const textStatus = await readTextSendStatus(admin, id);
    if (textStatus === undefined) {
      return { outcome: 'awaiting', reason: 'text_state_unavailable' };
    }
    if (textStatus !== null) {
      if (textStatus === 'sent') {
        const parked = await runCapturePhotoSequence(admin, id, {
          trigger: 'auto',
          deadlineAt: ctx.deadlineAt,
        });
        return { outcome: 'awaiting', reason: `computation_first:text_sent:${parked}` };
      }
      return { outcome: 'awaiting', reason: `computation_first:text_${textStatus}` };
    }
  }
  const rb = await attemptSecureLinkPrivateReply({
    supabase: admin,
    captureRecordId: id,
    fbName,
    value,
    screenshotPath: path,
    psid,
  });
  if (rb.ok) {
    await admin.rpc('mark_capture_photo_state', {
      p_capture_id: id,
      p_status: 'link_sent',
    });
    if (mode === 'computation_first') {
      // The Private Reply WAS the computation: record it, and the screenshot waits for their message.
      await recordComputationPrivateReply(admin, id);
      return {
        outcome: rb.code === 'already_sent' ? 'already_sent' : 'text_sent',
        reason: `computation_first:${rb.code}`,
      };
    }
    await setRouteReason(admin, id, 'AUTO TEXT Sent to Messenger ✓');
    return {
      outcome: rb.code === 'already_sent' ? 'already_sent' : 'text_sent',
      reason: rb.code,
    };
  }
  // A TERMINAL Route B failure → move the capture to a FINITE 'failed' now (finite "AUTO TEXT not
  // sent"), never a "Preparing AUTO TEXT" loop against a dead comment. Otherwise it is not sendable
  // YET (comment webhook lag) → keep 'awaiting_inbox' for the bounded retry; the DB moves it to
  // 'failed' once the attempt budget/age is spent.
  const finite = rb.code ? TERMINAL_ROUTE_B.has(rb.code) : false;
  await admin.rpc('mark_capture_photo_state', {
    p_capture_id: id,
    p_status: finite ? 'failed' : 'awaiting_inbox',
  });
  await setRouteReason(admin, id, routeBReason(rb.code));
  return { outcome: finite ? 'text_failed' : 'awaiting', reason: rb.code };
}

export type AutoRouteSummary = {
  ok: boolean;
  claimed: number;
  exhausted: number;
  outcomes: Record<string, number>;
};

/**
 * ONE durable routing sweep: atomically claim a bounded batch of chat-linked, unsent captures and
 * route each (A photo / B text), then move any budget-exhausted/aged capture to a finite 'failed'.
 * Service-role; safe to run concurrently (DB claims prevent double-processing). Returns a PII-free
 * summary for the cron log.
 */
export async function routePendingCapturesSystem(
  limit = 15,
  opts: { deadlineAt?: number } = {},
): Promise<AutoRouteSummary> {
  const admin = createAdminClient();

  // P0-A cheap short-circuit (Owner 2026-08-26): thousands of Live-comment webhooks/day trigger this
  // sweep even when there is NO actionable Capture work. A single bounded EXISTS (has_capture_routing_work
  // — the SAME canonical states the claim / exhaust / reactivation-fallback consume) skips the expensive
  // claim + link_sent fallback loop + exhaust update when nothing is pending/awaiting and no recent
  // link_sent needs recovery. When work DOES exist the guard passes and the sweep runs EXACTLY as before
  // (no latency added to AUTO TEXT/AUTO SS). Fail-OPEN: any guard error falls through to the full sweep.
  try {
    const workRes = (await admin.rpc('has_capture_routing_work')) as { data: unknown };
    if (workRes.data === false) {
      captureDebugLog('[capture-router]', { skipped_no_work: true });
      return { ok: true, claimed: 0, exhausted: 0, outcomes: { skipped_no_work: 1 } };
    }
  } catch {
    /* fail-open — never skip real work because the guard errored */
  }

  const activePage = await getActivePancakePageId();
  // The messaging sequence is read ONCE per sweep; each capture stamps it set-once at its first send.
  const settings = await readMessageSequenceSettings(admin);
  const deadlineAt = opts.deadlineAt ?? Date.now() + SEQUENCE_BUDGET_MS;
  const claimRes = (await admin.rpc('claim_captures_to_route', { p_limit: limit })) as {
    data: RouterCapture[] | null;
  };
  const caps = claimRes.data ?? [];

  const outcomes: Record<string, number> = {};
  for (const cap of caps) {
    let outcome: RouteOutcome = 'skipped';
    let reason = 'exception';
    if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) {
      // Out of time: it stays claimable with its backoff and the next sweep routes it.
      outcomes.deferred_budget = (outcomes.deferred_budget ?? 0) + 1;
      continue;
    }
    try {
      ({ outcome, reason } = await routeOne(admin, activePage, cap, { settings, deadlineAt }));
    } catch {
      outcome = 'skipped';
    }
    // PII-SAFE routing trace (Owner 2026-08-24): capture id + conversation TAIL only + outcome/reason —
    // NEVER a name, full PSID, token, or message body. An actual send FAILURE stays a production WARN;
    // the routine per-capture trace is gated behind CAPTURE_DEBUG_LOGS (Owner 2026-08-26, P0-B). The
    // durable stage trail lives in capture_records.route_reason + audit_events ('capture_secure_link').
    const entry = {
      capture: cap.id.slice(-6),
      conv_tail: (cap.pancake_conversation_id ?? '').slice(-4) || null,
      has_screenshot: !!cap.screenshot_path,
      outcome,
      reason,
    };
    if (outcome === 'photo_failed' || outcome === 'text_failed') {
      console.warn('[capture-router] send_failed', JSON.stringify(entry));
    } else {
      captureDebugLog('[capture-router]', entry);
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  // FALLBACK reactivation (Owner 2026-08-24, Case B): the webhook reactivates a customer's waiting
  // captures the instant they reply, but as a DURABLE safety net the cron also re-checks recent
  // 'link_sent' captures (AUTO TEXT sent, waiting for a reply) — so a missed/dropped reply webhook
  // still turns the reply into an AUTO SS within a minute, with no browser open. Bounded to distinct
  // recent conversations; each reactivation is a no-op unless the customer is now Photo-ready, and the
  // atomic photo claim keeps it to one photo per capture even alongside the webhook path.
  let reactivated = 0;
  try {
    const { data: waiting } = await admin
      .from('capture_records')
      .select('pancake_conversation_id')
      .eq('source', 'floating')
      .eq('is_test', false)
      .is('official_order_id', null)
      .is('confirmed', null)
      .eq('message_status', 'link_sent')
      .not('pancake_conversation_id', 'is', null)
      .gt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
      .limit(30);
    const convs = [
      ...new Set(
        ((waiting ?? []) as Array<{ pancake_conversation_id: string | null }>)
          .map((w) => (w.pancake_conversation_id ?? '').trim())
          .filter(Boolean),
      ),
    ];
    for (const c of convs) {
      try {
        if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) break;
        const r = await reactivatePhotoForConversationSystem(c, { deadlineAt });
        reactivated += r.sent;
      } catch {
        /* best-effort per conversation */
      }
    }
  } catch {
    /* best-effort — never breaks the main sweep */
  }

  // Screenshot-first text work still due (deferred retries, lost claims, and the missed-reply
  // fallback). Best-effort and bounded by the sweep's time budget.
  let textLegs = { sent: 0, considered: 0 };
  try {
    textLegs = await runDueTextLegs(admin, deadlineAt);
  } catch {
    /* best-effort — never breaks the main sweep */
  }
  // Computation First screenshots still due (deferred retries, lost claims).
  let photoLegs = { sent: 0, considered: 0 };
  try {
    photoLegs = await runDuePhotoLegs(admin, deadlineAt);
  } catch {
    /* best-effort — never breaks the main sweep */
  }

  const exhaustedRes = (await admin.rpc('mark_captures_route_exhausted')) as {
    data: number | null;
  };
  const exhausted = exhaustedRes.data;
  return {
    ok: true,
    claimed: caps.length,
    exhausted: typeof exhausted === 'number' ? exhausted : 0,
    outcomes: {
      ...outcomes,
      reactivated_photos: reactivated,
      ...(textLegs.considered > 0 ? { due_text_sent: textLegs.sent } : {}),
      ...(photoLegs.considered > 0 ? { due_photo_sent: photoLegs.sent } : {}),
    },
  };
}

/**
 * REACTIVATE a customer's waiting captures the instant they genuinely reply (Owner 2026-08-24, Case
 * B). A capture that already sent its AUTO TEXT is 'link_sent' and is NOT re-claimed by the durable
 * router (that queue is for AUTO-TEXT-not-yet-sent rows) — so nothing re-checked Route A when the
 * customer finally replied and their Inbox window opened. The Pancake webhook calls this the moment a
 * genuine Inbox DM is stored: it re-checks media eligibility for that EXACT conversation and, if the
 * customer is now Photo-ready, sends the actual screenshot PHOTO (AUTO SS) for their OWN waiting
 * captures.
 *
 * EXACT IDENTITY only — matched by the conversation id (never a similar name). Excludes ordered /
 * dismissed / already-photo-sent / old (>3 days) captures, so an unrelated or historical capture is
 * never woken. Idempotent + bounded: `claim_capture_photo_send` guarantees one photo per capture even
 * against the cron / a manual Send / a duplicate webhook. Server-side; needs no open browser / refresh.
 */
export async function reactivatePhotoForConversationSystem(
  conversationId: string,
  opts: { deadlineAt?: number } = {},
): Promise<{ eligible: boolean; sent: number; considered: number }> {
  const conv = (conversationId ?? '').trim();
  if (!conv) return { eligible: false, sent: 0, considered: 0 };
  const admin = createAdminClient();
  const activePage = await getActivePancakePageId();
  if (!conversationBelongsToPage(conv, activePage)) {
    return { eligible: false, sent: 0, considered: 0 };
  }
  // Only send a photo when the customer NOW has an open Inbox window (their genuine reply opened it).
  const eligible = await isConversationMediaEligible(admin, conv);
  if (!eligible) return { eligible: false, sent: 0, considered: 0 };

  // Match by EXACT identity — the same conversation id, or (robust to any page-prefix formatting) the
  // same customer PSID. Never a display-name match, so a similarly-named customer is never woken.
  const psid = psidFromConversationId(conv);
  const { data } = await admin
    .from('capture_records')
    .select('id, screenshot_path, pancake_conversation_id')
    .eq('source', 'floating')
    .eq('is_test', false)
    .is('official_order_id', null)
    .is('confirmed', null)
    .not('pancake_conversation_id', 'is', null)
    .in('message_status', ['link_sent', 'awaiting_inbox', 'pending'])
    .not('screenshot_path', 'is', null)
    .gt('created_at', new Date(Date.now() - 3 * 86400_000).toISOString())
    .order('captured_at', { ascending: false })
    .limit(50);
  const caps = (
    (data ?? []) as Array<{
      id: string;
      screenshot_path: string | null;
      pancake_conversation_id: string | null;
    }>
  )
    .filter(
      (c) =>
        c.pancake_conversation_id === conv ||
        (psid !== null && psidFromConversationId(c.pancake_conversation_id) === psid),
    )
    .slice(0, 10);

  const settings = caps.length > 0 ? await readMessageSequenceSettings(admin) : CLASSIC_SETTINGS;
  // Settings unreadable right now: send nothing; the cron fallback / next reply retries.
  if (!settings) return { eligible: true, sent: 0, considered: caps.length };
  const deadlineAt = opts.deadlineAt ?? Date.now() + SEQUENCE_BUDGET_MS;
  let sent = 0;
  for (const cap of caps) {
    const path = (cap.screenshot_path ?? '').trim();
    if (!path) continue;
    const signed = (await admin.storage
      .from(CAPTURE_BUCKET)
      .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
    const url = signed.data?.signedUrl ?? null;
    if (!url) continue;
    // Set-once: a capture that already started (e.g. its Private Reply) keeps its sequence.
    if (Date.now() + PHOTO_SEND_BUDGET_MS > deadlineAt) break;
    const mode = await stampSequence(admin, cap.id, settings);
    if (mode === null) continue;
    if (mode === 'computation_first') {
      // Computation First: its own screenshot leg. Never before the computation (the database
      // refuses); a screenshot that was waiting goes ONCE, for a reply newer than the wait. A
      // computation still waiting for this reply is sent by resumeTextForConversationSystem.
      const r = await resumePhotoAfterReply(
        admin,
        cap.id,
        (cap.pancake_conversation_id ?? '').trim() || conv,
        deadlineAt,
      );
      if (r === 'photo_sent') sent += 1;
      continue;
    }
    // Atomic one-photo-per-capture claim (link_sent → sending); already_sent / in_progress → skip.
    const claim = (
      await admin.rpc('claim_capture_photo_send', {
        p_capture_id: cap.id,
        p_conversation_id: conv,
      })
    ).data as string;
    if (claim !== 'claimed') continue;
    const res = await sendPancakeConversationMessage({
      conversationId: conv,
      message: '',
      attachmentUrl: url,
    });
    await admin.rpc('finalize_capture_photo_send', {
      p_capture_id: cap.id,
      p_ok: res.ok,
      p_pancake_message_id: res.pancakeMessageId,
      p_conversation_id: conv,
    });
    if (res.ok && mode === 'screenshot_first') {
      // Screenshot sent. A comment-only customer already has the computation (its Private Reply,
      // claim → already_sent); otherwise the text follows now as its own request.
      await setRouteReason(admin, cap.id, sequenceRouteReason('pending'));
      const t = await runCaptureTextSequence(admin, cap.id, { trigger: 'auto', deadlineAt });
      if (t === 'already_sent') await setRouteReason(admin, cap.id, sequenceRouteReason('sent'));
      sent += 1;
      continue;
    }
    // The AUTO TEXT history stays in capture_share_links + audit_events; the row's live status now
    // reflects the PHOTO. A failed photo leaves it reviewable and Send stays enabled as the fallback.
    await admin.rpc('set_capture_route_reason', {
      p_capture_id: cap.id,
      p_reason: res.ok ? 'AUTO SS Sent to Messenger ✓' : `AUTO SS Failed · ${res.code}`,
    });
    if (res.ok) sent += 1;
  }
  // An actual AUTO SS send stays a production INFO (useful outcome); a no-op reactivation check (sent=0)
  // is gated behind CAPTURE_DEBUG_LOGS (Owner 2026-08-26, P0-B).
  const summary = { conv_tail: conv.slice(-4), considered: caps.length, sent };
  if (sent > 0) {
    console.info('[capture-reactivate] sent', JSON.stringify(summary));
  } else {
    captureDebugLog('[capture-reactivate]', summary);
  }
  return { eligible: true, sent, considered: caps.length };
}

/**
 * GENUINE CUSTOMER REPLY → send the waiting computation TEXT once (Owner 2026-09-24). Called by
 * the Pancake webhook only for a NEWLY stored event that passes the genuine-Inbox-DM gate (never
 * a Page echo, staff message, comment, reaction or system event), so a replayed webhook cannot
 * trigger it. Matches the EXACT conversation (or its PSID), never a name. Each capture is claimed
 * atomically, so this, the cron fallback and a duplicate webhook can never double-send.
 */
export async function resumeTextForConversationSystem(
  conversationId: string,
  opts: { deadlineAt?: number } = {},
): Promise<{ sent: number; considered: number }> {
  const conv = (conversationId ?? '').trim();
  if (!conv) return { sent: 0, considered: 0 };
  const admin = createAdminClient();
  const activePage = await getActivePancakePageId();
  if (!conversationBelongsToPage(conv, activePage)) return { sent: 0, considered: 0 };

  // Filter by THIS customer in the database (the stored id, or any id ending in their PSID),
  // so another customer's waiting captures can never crowd theirs out of the result.
  const psid = psidFromConversationId(conv);
  let rows: Array<{ id: string; pancake_conversation_id: string | null }> = [];
  try {
    const base = admin
      .from('capture_records')
      .select('id, pancake_conversation_id')
      .eq('source', 'floating')
      .eq('is_test', false)
      .is('official_order_id', null)
      .is('confirmed', null)
      .in('message_sequence', ['screenshot_first', 'computation_first'])
      .eq('text_send_status', 'waiting_reply');
    const scoped = psid
      ? base.like('pancake_conversation_id', `%${psid}`)
      : base.eq('pancake_conversation_id', conv);
    const { data, error } = await scoped
      .gt('created_at', new Date(Date.now() - 3 * 86400_000).toISOString())
      .order('captured_at', { ascending: false })
      .limit(20);
    if (error) return { sent: 0, considered: 0 };
    rows = data ?? [];
  } catch {
    return { sent: 0, considered: 0 };
  }

  // Exact identity only (the database filter is a suffix match; this confirms the PSID).
  const mine = rows.filter(
    (r) =>
      r.pancake_conversation_id === conv ||
      (psid !== null && psidFromConversationId(r.pancake_conversation_id) === psid),
  );

  const deadlineAt = opts.deadlineAt ?? Date.now() + SEQUENCE_BUDGET_MS;
  let sent = 0;
  for (const r of mine) {
    if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) break;
    const t = await runCaptureTextSequence(admin, r.id, { trigger: 'reply', deadlineAt });
    if (t === 'text_sent') sent += 1;
  }
  if (sent > 0) {
    console.info('[capture-text-resume] sent', JSON.stringify({ conv_tail: conv.slice(-4), sent }));
  } else {
    captureDebugLog('[capture-text-resume]', { conv_tail: conv.slice(-4), considered: mine.length });
  }
  return { sent, considered: mine.length };
}

/**
 * MISSED-REPLY FALLBACK (every minute, from the cron route only — never per Live comment). The
 * webhook normally resumes a waiting text the instant the customer replies; if that webhook was
 * missed, this finds waiting captures whose customer HAS genuinely replied SINCE the wait began
 * (one batched events query) and sends each text once. Before the migration it does nothing.
 * Computation First screenshots that are waiting get the same fallback.
 */
export async function runWaitingTextReplyFallbackSystem(
  opts: { deadlineAt?: number } = {},
): Promise<{ sent: number; considered: number }> {
  const admin = createAdminClient();
  const deadlineAt = opts.deadlineAt ?? Date.now() + SEQUENCE_BUDGET_MS;
  const texts = await runWaitingTextReplyFallback(admin, deadlineAt);
  const photos = await runWaitingPhotoReplyFallback(admin, deadlineAt);
  return { sent: texts.sent + photos.sent, considered: texts.considered + photos.considered };
}

async function runWaitingTextReplyFallback(
  admin: SupabaseClient,
  deadlineAt: number,
): Promise<{ sent: number; considered: number }> {
  if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) return { sent: 0, considered: 0 };
  let items: Array<{ id: string; pancake_conversation_id: string; text_waiting_since: string }> = [];
  try {
    const res = (await admin.rpc('list_waiting_capture_texts', { p_limit: 100 })) as {
      data: unknown;
      error: unknown;
    };
    if (res.error || !Array.isArray(res.data)) return { sent: 0, considered: 0 };
    items = (res.data as Array<Record<string, unknown>>)
      .map((r) => ({
        id: typeof r.id === 'string' ? r.id : '',
        pancake_conversation_id:
          typeof r.pancake_conversation_id === 'string' ? r.pancake_conversation_id : '',
        text_waiting_since: typeof r.text_waiting_since === 'string' ? r.text_waiting_since : '',
      }))
      .filter((r) => r.id && r.pancake_conversation_id && r.text_waiting_since);
  } catch {
    return { sent: 0, considered: 0 };
  }
  if (items.length === 0) return { sent: 0, considered: 0 };

  const replied = await genuineInboxDmSinceBatch(
    admin,
    items.map((i) => ({
      key: i.id,
      conversationId: i.pancake_conversation_id,
      sinceIso: i.text_waiting_since,
    })),
  );
  let sent = 0;
  for (const it of items) {
    if (!replied.has(it.id)) continue;
    if (Date.now() + INLINE_ATTEMPT_BUDGET_MS > deadlineAt) break;
    const t = await runCaptureTextSequence(admin, it.id, { trigger: 'reply', deadlineAt });
    if (t === 'text_sent') sent += 1;
  }
  return { sent, considered: items.length };
}

/** The same missed-reply fallback for Computation First screenshots that are waiting: a genuine
 *  reply SINCE the wait began sends each one once. Before migration 20260925120000 it does nothing. */
async function runWaitingPhotoReplyFallback(
  admin: SupabaseClient,
  deadlineAt: number,
): Promise<{ sent: number; considered: number }> {
  if (Date.now() + PHOTO_SEND_BUDGET_MS > deadlineAt) return { sent: 0, considered: 0 };
  let items: Array<{ id: string; pancake_conversation_id: string; photo_waiting_since: string }> = [];
  try {
    const res = (await admin.rpc('list_waiting_capture_photos', { p_limit: 100 })) as {
      data: unknown;
      error: unknown;
    };
    if (res.error || !Array.isArray(res.data)) return { sent: 0, considered: 0 };
    items = (res.data as Array<Record<string, unknown>>)
      .map((r) => ({
        id: typeof r.id === 'string' ? r.id : '',
        pancake_conversation_id:
          typeof r.pancake_conversation_id === 'string' ? r.pancake_conversation_id : '',
        photo_waiting_since: typeof r.photo_waiting_since === 'string' ? r.photo_waiting_since : '',
      }))
      .filter((r) => r.id && r.pancake_conversation_id && r.photo_waiting_since);
  } catch {
    return { sent: 0, considered: 0 };
  }
  if (items.length === 0) return { sent: 0, considered: 0 };

  const replied = await genuineInboxDmSinceBatch(
    admin,
    items.map((i) => ({
      key: i.id,
      conversationId: i.pancake_conversation_id,
      sinceIso: i.photo_waiting_since,
    })),
  );
  let sent = 0;
  for (const it of items) {
    if (!replied.has(it.id)) continue;
    if (Date.now() + PHOTO_SEND_BUDGET_MS > deadlineAt) break;
    const p = await runCapturePhotoSequence(admin, it.id, { trigger: 'reply', deadlineAt });
    if (p === 'photo_sent') sent += 1;
  }
  return { sent, considered: items.length };
}

/* Entry points for the MANUAL PC Send (pc-send.ts runs under the operator's session; these use
 * the service-role client, like the rest of this sanctioned module). */

/**
 * "Is this customer's Messenger chat open?" read with the service-role client. The webhook
 * events table is readable only by Owners under RLS, so the same check under an Admin's or a
 * staff member's session saw no messages and treated every open chat as closed: the PC sent a
 * comment reply instead of the screenshot (2026-09-24). Read-only; returns yes/no only; both
 * callers (pc-send, pending) are claim_capture-gated.
 */
export async function isConversationMediaEligibleSystem(conversationId: string): Promise<boolean> {
  return isConversationMediaEligible(createAdminClient(), conversationId);
}

/** The batch form of the same check, for the Incoming Captures list ("Photo ready"). */
export async function conversationsMediaEligibilitySystem(
  conversationIds: ReadonlyArray<string>,
): Promise<Map<string, boolean>> {
  return conversationsMediaEligibility(createAdminClient(), conversationIds);
}

/** Stamp the capture's sequence set-once from the current settings; 'classic' if unavailable. */
export async function stampCaptureSequenceSystem(captureId: string): Promise<MessageSequence | null> {
  const admin = createAdminClient();
  const settings = await readMessageSequenceSettings(admin);
  return stampSequence(admin, captureId, settings);
}

/**
 * Computation First, manual Send into an OPEN chat: store the chat and send the computation now
 * (bounded). The screenshot is NOT sent here: the caller schedules it after the response
 * (runCapturePhotoSequenceSystem), and the every-minute sweep continues it otherwise.
 */
export async function runComputationFirstTextSystem(
  captureId: string,
  conversationId: string,
): Promise<TextSequenceOutcome> {
  const admin = createAdminClient();
  await admin.rpc('set_capture_sequence_conversation', {
    p_capture_id: captureId,
    p_conversation_id: conversationId,
  });
  return runCaptureTextSequence(admin, captureId, {
    trigger: 'auto',
    deadlineAt: Date.now() + SEQUENCE_BUDGET_MS,
    photo: 'defer',
  });
}

/** Computation First: the screenshot leg for one capture (after its computation is sent). */
export async function runCapturePhotoSequenceSystem(captureId: string): Promise<PhotoSequenceOutcome> {
  return runCapturePhotoSequence(createAdminClient(), captureId, {
    trigger: 'auto',
    deadlineAt: Date.now() + SEQUENCE_BUDGET_MS,
  });
}

/** Computation First, manual Send with no open chat: the computation's state (null = never
 *  started; undefined = could not be read), so a Private Reply never repeats it. */
export async function readComputationStatusSystem(captureId: string): Promise<string | null | undefined> {
  return readTextSendStatus(createAdminClient(), captureId);
}

/** Computation First, manual Send with no open chat: the one Private Reply carried the
 *  computation; record it and let the screenshot wait for the customer's message. */
export async function recordComputationPrivateReplySystem(captureId: string): Promise<void> {
  await recordComputationPrivateReply(createAdminClient(), captureId);
}

/** After a manual screenshot send: run the text leg (bounded by the sequence time budget). */
export async function runCaptureTextSequenceSystem(
  captureId: string,
): Promise<TextSequenceOutcome> {
  const admin = createAdminClient();
  const t = await runCaptureTextSequence(admin, captureId, {
    trigger: 'auto',
    deadlineAt: Date.now() + SEQUENCE_BUDGET_MS,
  });
  if (t === 'already_sent') await setRouteReason(admin, captureId, sequenceRouteReason('sent'));
  return t;
}
