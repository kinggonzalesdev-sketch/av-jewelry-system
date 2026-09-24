/**
 * Screenshot-first Private Reply SEQUENCE — the pure, client-safe rules (Owner 2026-09-24).
 *
 * The server orchestration lives in `auto-router.ts` (the sanctioned service-role module) and
 * the atomic state machine lives in the database (migration 20260924120000). This module holds
 * everything that must be identical everywhere and is unit-testable without a database:
 * the setting values, the retry policy, the send-result classification, and the staff-facing
 * status wording.
 */

/** The configurable sequences. Stored as these exact values; never as display text. */
export const MESSAGE_SEQUENCES = ['screenshot_first', 'classic'] as const;
export type MessageSequence = (typeof MESSAGE_SEQUENCES)[number];

export const DEFAULT_MESSAGE_SEQUENCE: MessageSequence = 'screenshot_first';

export const MESSAGE_SEQUENCE_OPTIONS: ReadonlyArray<{
  value: MessageSequence;
  label: string;
  description: string;
}> = [
  {
    value: 'screenshot_first',
    label: 'Screenshot First',
    description:
      'Send the screenshot first, then attempt to send the invoice/computation text. If the text cannot be sent after the allowed attempts, wait for a genuine customer reply before sending the text.',
  },
  {
    value: 'classic',
    label: 'Classic (previous behaviour)',
    description:
      'The behaviour before September 2026: the screenshot is sent when the chat window is open, with no computation text after it.',
  },
];

export function isMessageSequence(value: unknown): value is MessageSequence {
  return typeof value === 'string' && (MESSAGE_SEQUENCES as readonly string[]).includes(value);
}

/** Total text attempts after the screenshot: 3 means 3 attempts in all, not 3 retries. */
export const TEXT_SEND_ATTEMPTS_MIN = 1;
export const TEXT_SEND_ATTEMPTS_MAX = 3;
export const DEFAULT_TEXT_SEND_ATTEMPTS = 3;

/** A valid attempt count (an integer 1..3), or null. Never unlimited. */
export function parseTextSendAttempts(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(n)) return null;
  if (n < TEXT_SEND_ATTEMPTS_MIN || n > TEXT_SEND_ATTEMPTS_MAX) return null;
  return n;
}

/**
 * Bounded backoff BEFORE attempt 2 and attempt 3 (about 2s, then about 5s). An authoritative
 * Retry-After from Pancake wins when it is longer.
 */
export const TEXT_RETRY_BACKOFF_MS: readonly number[] = [2000, 5000];

/** Waits longer than this are not slept in-process: the capture stays due and the next
 *  every-minute sweep continues it (so a request is never held open for a long retry-after). */
export const MAX_INLINE_TEXT_WAIT_MS = 10_000;

export function backoffBeforeNextAttempt(
  retriesSoFar: number,
  retryAfterMs: number | null,
): number {
  const idx = Math.max(0, Math.min(retriesSoFar, TEXT_RETRY_BACKOFF_MS.length - 1));
  const base = TEXT_RETRY_BACKOFF_MS[idx] ?? 5000;
  return Math.max(base, retryAfterMs ?? 0);
}

/** The per-capture text state (capture_records.text_send_status). */
export type TextSendStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'waiting_reply'
  | 'failed'
  | 'unconfirmed';

/** The subset of a Pancake send result the classifier reads. */
export type TextSendResultLike = {
  ok: boolean;
  code: string;
  sendHttpStatus?: number | null;
  sendMessageCode?: string | null;
  /** How a thrown request failed: 'network' = never reached Pancake (safe to retry);
   *  'timeout' / 'unknown' = it may have reached Pancake (ambiguous). */
  transport?: 'network' | 'timeout' | 'unknown';
  retryAfterSeconds?: number | null;
  debug?: string;
};

export type TextSendClass =
  | { kind: 'sent' }
  | { kind: 'retry'; retryAfterMs: number | null }
  | { kind: 'wait_reply' }
  | { kind: 'failed' }
  | { kind: 'ambiguous' };

/**
 * Facebook / Pancake answers that mean "a customer reply is needed before you can message
 * again": the 24-hour window (error #10 / subcode 2018278), a comment already privately
 * replied to (#10900), and "this person isn't available right now" (#551). Retrying these
 * wastes attempts, so the capture moves straight to waiting for the customer's reply.
 */
const REPLY_REQUIRED = [
  /2018278/,
  /outside of allowed window/i,
  /10900/,
  /already\s+replied/i,
  /\(#10\)/,
  /["'](error_)?code["']?\s*:\s*10[,}]/,
  /\(#551\)/,
  /["'](error_)?code["']?\s*:\s*551[,}]/,
];

/**
 * Answers that no reply can fix: an invalid or expired token (#190, or its subcodes 460/463/467),
 * or a malformed request (#100). NOT the bare label "OAuthException": Facebook puts that type on
 * nearly every error, rate limits included.
 */
const NEVER_RETRY = [
  /\(#190\)/,
  /["'](error_)?code["']?\s*:\s*190[,}]/,
  /error_subcode["']?\s*:\s*(460|463|467)[,}]/,
  /invalid (oauth )?access token/i,
  /session has expired/i,
  /\(#100\)/,
  /["'](error_)?code["']?\s*:\s*100[,}]/,
];

/** Facebook's own temporary failures: rate limits (#4, #17, #32, #613), a temporary outage (#2),
 *  or an error it marks transient. Checked BEFORE the never-retry list. */
const FB_TRANSIENT = [
  /\(#(2|4|17|32|613)\)/,
  /["'](error_)?code["']?\s*:\s*(2|4|17|32|613)[,}]/,
  /is_transient["']?\s*:\s*true/,
];

/** Gateway answers where the request may already have been forwarded and accepted:
 *  bad gateway, gateway timeout, and the proxy 52x family. Checked before any retry. */
const GATEWAY_AMBIGUOUS = new Set([502, 504, 520, 521, 522, 523, 524]);

/**
 * Classify ONE text send result. Only genuinely transient failures are retried:
 * a network error that never reached Pancake, HTTP 429, HTTP 500/503 and Facebook's own rate
 * limits. A timeout or a gateway 502/504/52x is AMBIGUOUS (Pancake may have accepted it):
 * the caller checks the chat for the exact text before anything is retried.
 */
export function classifyTextSend(res: TextSendResultLike): TextSendClass {
  if (res.ok) return { kind: 'sent' };

  const code = res.code;
  if (code === 'outside_window') return { kind: 'wait_reply' };
  if (
    code === 'token_missing' ||
    code === 'page_missing' ||
    code === 'conversation_missing' ||
    code === 'sender_unset'
  ) {
    return { kind: 'failed' };
  }

  if (code === 'unavailable') {
    return res.transport === 'network' ? { kind: 'retry', retryAfterMs: null } : { kind: 'ambiguous' };
  }

  const status = res.sendHttpStatus ?? null;
  const evidence = `${res.sendMessageCode ?? ''} ${res.debug ?? ''}`;
  const secs = res.retryAfterSeconds;
  const retryAfterMs = typeof secs === 'number' && secs > 0 ? Math.min(secs, 3600) * 1000 : null;
  if (status !== null && GATEWAY_AMBIGUOUS.has(status)) return { kind: 'ambiguous' };
  if (REPLY_REQUIRED.some((re) => re.test(evidence))) return { kind: 'wait_reply' };
  // Transient signals first: Facebook labels rate limits "OAuthException" too.
  if (status === 429 || FB_TRANSIENT.some((re) => re.test(evidence))) {
    return { kind: 'retry', retryAfterMs };
  }
  if (status === 401 || status === 403 || NEVER_RETRY.some((re) => re.test(evidence))) {
    return { kind: 'failed' };
  }
  if (status !== null && status >= 500) return { kind: 'retry', retryAfterMs };

  // Any other definite rejection is permanent for now: stop retrying and let a genuine
  // customer reply unlock ONE more send.
  return { kind: 'wait_reply' };
}

/**
 * The compact staff-facing status lines for a screenshot-first capture. Never raw API
 * errors. Returns null when the capture is not on the screenshot-first sequence, so the
 * caller keeps its existing wording.
 */
export function sequenceStatusLines(
  messageSequence: string | null | undefined,
  messageStatus: string | null | undefined,
  textStatus: string | null | undefined,
): { lines: string[]; tone: 'ok' | 'wait' | 'warn' } | null {
  if (messageSequence !== 'screenshot_first') return null;

  if (messageStatus === 'link_sent') {
    // Comment-only customer. Before 2026-09-24 evening the one Private Reply carried the
    // computation (text recorded as sent); now it only asks the customer to reply, and the
    // screenshot and then the computation follow that reply.
    if (textStatus === 'sent') {
      return { lines: ['Computation sent ✓', 'Screenshot after customer replies'], tone: 'wait' };
    }
    return { lines: ['Reply request sent ✓', 'Screenshot + computation after reply'], tone: 'wait' };
  }
  if (messageStatus === 'failed') {
    // The screenshot failed after the computation already went out: say so (the card's warning
    // row says what failed). Any other failure keeps the card's existing wording.
    return textStatus === 'sent' ? { lines: ['Computation sent ✓'], tone: 'ok' } : null;
  }
  if (messageStatus !== 'sent') return null;

  switch (textStatus) {
    case 'sent':
      return { lines: ['Screenshot sent ✓', 'Computation sent ✓'], tone: 'ok' };
    case 'waiting_reply':
      return { lines: ['Screenshot sent ✓', 'Waiting for customer reply'], tone: 'wait' };
    case 'failed':
      return { lines: ['Screenshot sent ✓', 'Computation not sent · open chat'], tone: 'warn' };
    case 'unconfirmed':
      return { lines: ['Screenshot sent ✓', 'Computation may not have sent · check chat'], tone: 'warn' };
    default:
      return { lines: ['Screenshot sent ✓', 'Sending computation…'], tone: 'wait' };
  }
}

/** The one-line durable route_reason for the same states (≤200 chars, human-safe). */
export function sequenceRouteReason(
  textStatus: TextSendStatus | 'private_reply_sent' | 'prompt_sent',
): string {
  switch (textStatus) {
    case 'prompt_sent':
      return 'Reply request sent ✓ · Screenshot + computation after reply';
    case 'private_reply_sent':
      return 'Computation sent ✓ · Screenshot after customer replies';
    case 'sent':
      return 'Screenshot sent ✓ · Computation sent ✓';
    case 'waiting_reply':
      return 'Screenshot sent ✓ · Waiting for customer reply';
    case 'failed':
      return 'Screenshot sent ✓ · Computation not sent · open chat';
    case 'unconfirmed':
      return 'Screenshot sent ✓ · Computation may not have sent · check chat';
    default:
      return 'Screenshot sent ✓ · Sending computation…';
  }
}
