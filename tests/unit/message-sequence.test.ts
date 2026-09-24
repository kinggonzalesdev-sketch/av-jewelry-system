import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MESSAGE_SEQUENCE,
  DEFAULT_TEXT_SEND_ATTEMPTS,
  backoffBeforeNextAttempt,
  classifyTextSend,
  isMessageSequence,
  parseTextSendAttempts,
  sequenceRouteReason,
  sequenceStatusLines,
} from '@/lib/capture/message-sequence';
import { fetchFailureTransport, parseRetryAfterSeconds } from '@/lib/integrations/pancake';

/** The pure rules of the screenshot-first sequence (Owner 2026-09-24). */

describe('settings values', () => {
  it('defaults to Screenshot First with 3 text attempts, stored as an enum value', () => {
    expect(DEFAULT_MESSAGE_SEQUENCE).toBe('screenshot_first');
    expect(DEFAULT_TEXT_SEND_ATTEMPTS).toBe(3);
    expect(isMessageSequence('screenshot_first')).toBe(true);
    expect(isMessageSequence('classic')).toBe(true);
    expect(isMessageSequence('Screenshot First')).toBe(false);
  });

  it('allows only 1, 2 or 3 attempts — never unlimited', () => {
    expect([1, 2, 3].map(parseTextSendAttempts)).toEqual([1, 2, 3]);
    for (const bad of [0, 4, 10, -1, 1.5, Number.NaN, 'x', null, undefined]) {
      expect(parseTextSendAttempts(bad)).toBeNull();
    }
    expect(parseTextSendAttempts('2')).toBe(2);
  });
});

describe('retry backoff', () => {
  it('waits about 2s then 5s, and never less than an authoritative Retry-After', () => {
    expect(backoffBeforeNextAttempt(0, null)).toBe(2000);
    expect(backoffBeforeNextAttempt(1, null)).toBe(5000);
    expect(backoffBeforeNextAttempt(0, 8000)).toBe(8000);
    expect(backoffBeforeNextAttempt(1, 1000)).toBe(5000);
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    expect(parseRetryAfterSeconds('7')).toBe(7);
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds('soon')).toBeNull();
    const now = Date.parse('2026-09-24T10:00:00Z');
    expect(parseRetryAfterSeconds('Thu, 24 Sep 2026 10:00:30 GMT', now)).toBe(30);
  });
});

describe('only transient failures are retried', () => {
  const base = { ok: false, code: 'failed' as const };

  it('success', () => {
    expect(classifyTextSend({ ok: true, code: 'sent' }).kind).toBe('sent');
  });

  it('retries HTTP 5xx, HTTP 429 (with Retry-After) and a network error that never reached Pancake', () => {
    expect(classifyTextSend({ ...base, sendHttpStatus: 503 }).kind).toBe('retry');
    expect(classifyTextSend({ ...base, sendHttpStatus: 429, retryAfterSeconds: 4 })).toEqual({
      kind: 'retry',
      retryAfterMs: 4000,
    });
    expect(classifyTextSend({ ok: false, code: 'unavailable', transport: 'network' }).kind).toBe('retry');
  });

  it('treats a timeout as AMBIGUOUS — never blindly re-sent', () => {
    expect(classifyTextSend({ ok: false, code: 'unavailable', transport: 'timeout' }).kind).toBe('ambiguous');
    expect(classifyTextSend({ ok: false, code: 'unavailable' }).kind).toBe('ambiguous');
  });

  it('moves straight to waiting for a reply when Facebook needs one', () => {
    expect(classifyTextSend({ ok: false, code: 'outside_window' }).kind).toBe('wait_reply');
    expect(
      classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error":{"code":10,"error_subcode":2018278}}' }).kind,
    ).toBe('wait_reply');
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: 'Activity already replied to (#10900)' }).kind).toBe(
      'wait_reply',
    );
  });

  it('never retries authentication, configuration or malformed-request failures', () => {
    expect(classifyTextSend({ ...base, sendHttpStatus: 401 }).kind).toBe('failed');
    expect(classifyTextSend({ ...base, sendHttpStatus: 403 }).kind).toBe('failed');
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: 'Invalid OAuth access token (#190)' }).kind).toBe(
      'failed',
    );
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: 'Invalid parameter (#100)' }).kind).toBe('failed');
    expect(classifyTextSend({ ok: false, code: 'token_missing' }).kind).toBe('failed');
    expect(classifyTextSend({ ok: false, code: 'conversation_missing' }).kind).toBe('failed');
  });

  it('treats a gateway 502/504/52x as AMBIGUOUS (it may already have been delivered)', () => {
    for (const s of [502, 504, 520, 524]) {
      expect(classifyTextSend({ ...base, sendHttpStatus: s }).kind).toBe('ambiguous');
    }
    expect(classifyTextSend({ ...base, sendHttpStatus: 500 }).kind).toBe('retry');
  });

  it('retries Facebook rate limits and honours Retry-After on a 503', () => {
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: 'Application request limit reached (#4)' }).kind).toBe(
      'retry',
    );
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error_code":613}' }).kind).toBe('retry');
    expect(classifyTextSend({ ...base, sendHttpStatus: 503, retryAfterSeconds: 9 })).toEqual({
      kind: 'retry',
      retryAfterMs: 9000,
    });
  });

  it('an invalid or expired token is a failure (#190 / its subcodes / the message), never a wait', () => {
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error":{"type":"OAuthException","code":190}}' }).kind).toBe('failed');
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error":{"code":102,"error_subcode":463}}' }).kind).toBe('failed');
    expect(classifyTextSend({ ...base, sendHttpStatus: 200, debug: '{"success":false,"message":"Invalid access token"}' }).kind).toBe('failed');
  });

  it('a rate limit labelled OAuthException is still retried (transient checks come first)', () => {
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error":{"type":"OAuthException","code":4}}' }).kind).toBe('retry');
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error":{"type":"OAuthException","code":1,"is_transient":true}}' }).kind).toBe('retry');
    // A subcode is never read as the error code.
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: '{"error":{"code":999,"error_subcode":2}}' }).kind).toBe('wait_reply');
  });

  it('any other definite rejection waits for a reply instead of retrying', () => {
    expect(classifyTextSend({ ...base, sendHttpStatus: 400, debug: 'something else' }).kind).toBe('wait_reply');
  });
});

describe('how a failed request failed', () => {
  it('only a pre-connection failure is a safe-to-retry network error', () => {
    expect(fetchFailureTransport({ name: 'TypeError', cause: { code: 'ECONNREFUSED' } })).toBe('network');
    expect(fetchFailureTransport({ name: 'TypeError', cause: { code: 'ENOTFOUND' } })).toBe('network');
    expect(fetchFailureTransport({ name: 'TimeoutError' })).toBe('timeout');
    expect(fetchFailureTransport({ name: 'TypeError', cause: { code: 'ECONNRESET' } })).toBe('unknown');
    expect(fetchFailureTransport('boom')).toBe('unknown');
  });
});

describe('staff-facing status (never a raw API error)', () => {
  it('shows the compact two-step states', () => {
    expect(sequenceStatusLines('screenshot_first', 'sent', null)?.lines).toEqual([
      'Screenshot sent ✓',
      'Sending computation…',
    ]);
    expect(sequenceStatusLines('screenshot_first', 'sent', 'sent')?.lines).toEqual([
      'Screenshot sent ✓',
      'Computation sent ✓',
    ]);
    expect(sequenceStatusLines('screenshot_first', 'sent', 'waiting_reply')?.lines).toEqual([
      'Screenshot sent ✓',
      'Waiting for customer reply',
    ]);
    expect(sequenceStatusLines('screenshot_first', 'link_sent', 'sent')?.lines).toEqual([
      'Computation sent ✓',
      'Screenshot after customer replies',
    ]);
  });

  it('comment-only: the "please reply" request, then screenshot + computation after the reply', () => {
    expect(sequenceStatusLines('screenshot_first', 'link_sent', null)?.lines).toEqual([
      'Reply request sent ✓',
      'Screenshot + computation after reply',
    ]);
    expect(sequenceRouteReason('prompt_sent')).toBe(
      'Reply request sent ✓ · Screenshot + computation after reply',
    );
  });

  it('a failed screenshot after the computation went out says the computation was sent', () => {
    expect(sequenceStatusLines('screenshot_first', 'failed', 'sent')).toEqual({
      lines: ['Computation sent ✓'],
      tone: 'ok',
    });
    // Any other failure keeps the card's own wording.
    expect(sequenceStatusLines('screenshot_first', 'failed', null)).toBeNull();
    expect(sequenceStatusLines('classic', 'failed', 'sent')).toBeNull();
  });

  it('leaves classic / not-started captures to the existing wording', () => {
    expect(sequenceStatusLines('classic', 'sent', null)).toBeNull();
    expect(sequenceStatusLines(null, 'sent', null)).toBeNull();
    expect(sequenceStatusLines('screenshot_first', 'awaiting_inbox', null)).toBeNull();
  });
});

describe('migration 20260924120000 — additive, screenshot-first enforced in the database', () => {
  const RAW = readFileSync(
    join(__dirname, '..', '..', 'supabase', 'migrations', '20260924120000_capture_screenshot_first_sequence.sql'),
    'utf8',
  );
  const SQL = RAW.split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('--'))
    .join(String.fromCharCode(10))
    .toLowerCase();

  it('is strictly additive: nothing dropped, renamed, deleted or rewritten', () => {
    expect(SQL).not.toMatch(/drop (table|column|function|index|trigger|policy)/);
    expect(SQL).not.toMatch(/rename/);
    expect(SQL).not.toMatch(/delete from/);
    expect(SQL).not.toMatch(/alter column .* type/);
    expect(SQL).not.toMatch(/truncate/);
    // Every UPDATE lives inside a function body (the state machine), never a top-level data change.
    const topLevel = SQL.split('$function$').filter((_, i) => i % 2 === 0).join(' ');
    expect(topLevel).not.toMatch(/update public\./);
  });

  it('the text claim requires the screenshot to be sent first (IMAGE THEN TEXT)', () => {
    expect(SQL).toContain("if coalesce(r.message_status, '') <> 'sent' then return 'not_ready'; end if;");
    expect(SQL).toContain("if v_status = 'sent' then return 'already_sent'; end if;");
  });

  it('never re-sends a computation that already went as the Private Reply (the ledger decides)', () => {
    const claimBody = SQL.slice(
      SQL.indexOf('create or replace function public.claim_capture_text_send'),
      SQL.indexOf('create or replace function public.finalize_capture_text_send'),
    );
    expect(claimBody).toContain('from public.capture_share_links s');
    expect(claimBody).toContain("s.private_reply_status = 'sent'");
    // The ledger check comes BEFORE any claim can be taken.
    expect(claimBody.indexOf('capture_share_links')).toBeLessThan(claimBody.indexOf("set text_send_status = 'sending'"));
  });

  it('due work and waiting work are listed by the database (no starvation, service role only)', () => {
    expect(SQL).toContain('create or replace function public.list_due_capture_text_legs');
    expect(SQL).toContain('create or replace function public.list_waiting_capture_texts');
    expect(SQL).toContain('grant execute on function public.list_due_capture_text_legs(integer) to service_role;');
    expect(SQL).toContain('grant execute on function public.list_waiting_capture_texts(integer) to service_role;');
  });

  it('a lost claim becomes unconfirmed, never re-sent', () => {
    expect(SQL).toContain("set text_send_status = 'unconfirmed'");
  });

  it('caps attempts at 1..3 in the database', () => {
    expect(SQL).toContain('check (text_send_attempts between 1 and 3)');
    expect(SQL).toContain('check (text_max_attempts is null or text_max_attempts between 1 and 3)');
  });

  it('closes every new definer function to PUBLIC and anon; state functions are service-role only', () => {
    for (const fn of [
      'start_capture_message_sequence(uuid, text, integer)',
      'mark_capture_text_sent_by_private_reply(uuid)',
      'claim_capture_text_send(uuid, text)',
      'finalize_capture_text_send(uuid, text, text, text, integer)',
    ]) {
      expect(SQL).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(SQL).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    expect(SQL).toContain('revoke all on function public.save_capture_messaging_settings(text, integer) from public, anon;');
    expect(SQL).toContain('if not app_private.is_owner() then');
  });

  it('keeps the sweep guard a superset of its previous body', () => {
    expect(SQL).toContain("coalesce(c.message_status, '') in ('pending', 'awaiting_inbox')");
    expect(SQL).toContain("(c.message_status = 'link_sent' and c.created_at > now() - interval '24 hours')");
  });
});
