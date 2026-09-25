import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MESSAGE_SEQUENCE,
  DEFAULT_TEXT_SEND_ATTEMPTS,
  DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
  MESSAGE_SEQUENCE_OPTIONS,
  attemptSettingFor,
  backoffBeforeNextAttempt,
  classifyPhotoSend,
  classifyTextSend,
  computationFirstRouteReason,
  isMessageSequence,
  parseScreenshotSendAttempts,
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
      'Waiting for customer reply to send computation',
    ]);
    expect(sequenceStatusLines('screenshot_first', 'sending', null)?.lines).toEqual([
      'Sending screenshot…',
    ]);
    expect(sequenceRouteReason('waiting_reply')).toBe(
      'Screenshot sent ✓ · Waiting for customer reply to send computation',
    );
    expect(sequenceStatusLines('screenshot_first', 'link_sent', 'sent')?.lines).toEqual([
      'Computation sent ✓',
      'Screenshot after customer replies',
    ]);
  });

  it('comment-only: nothing sent yet — waiting for the customer to message', () => {
    expect(sequenceStatusLines('screenshot_first', 'link_sent', null)?.lines).toEqual([
      'Waiting for customer to message',
      'Screenshot + computation will follow',
    ]);
    expect(sequenceRouteReason('awaiting_message')).toBe(
      'Waiting for customer to message · Screenshot + computation will follow',
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

  it('Screenshot First never says the screenshot waits on a reply after a computation, unless that really happened', () => {
    // Only a capture whose computation truly went first (before the database gate) may say so.
    const statuses = [null, 'pending', 'awaiting_inbox', 'sending', 'sent', 'link_sent', 'failed'];
    const texts = [null, 'pending', 'sending', 'waiting_reply', 'failed', 'unconfirmed'];
    for (const m of statuses) {
      for (const t of texts) {
        const shown = (sequenceStatusLines('screenshot_first', m, t)?.lines ?? []).join(' · ');
        expect(shown).not.toMatch(/Waiting for reply to send screenshot/);
        expect(shown).not.toMatch(/Screenshot after customer replies/);
        expect(shown).not.toMatch(/^Computation sent/);
      }
    }
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

describe('migration 20260924160000 — the Screenshot First gate lives in the database', () => {
  const RAW = readFileSync(
    join(__dirname, '..', '..', 'supabase', 'migrations', '20260924160000_capture_screenshot_first_hard_gate.sql'),
    'utf8',
  );
  const SQL = RAW.split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('--'))
    .join(String.fromCharCode(10))
    .toLowerCase();
  const claimBody = SQL.slice(SQL.indexOf('create or replace function public.claim_share_link_send'));

  it('is additive: no table, column or data change (only its own trigger is re-created)', () => {
    expect(SQL).not.toMatch(/drop (table|column|function|index|policy)/);
    expect(SQL.match(/drop trigger/g)).toEqual(['drop trigger']);
    expect(SQL).toContain('drop trigger if exists trg_stamp_message_sequence on public.capture_records;');
    expect(SQL).not.toMatch(/alter table|rename|delete from|truncate/);
    const topLevel = SQL.split('$$').filter((_, i) => i % 2 === 0).join(' ');
    expect(topLevel).not.toMatch(/update public\./);
  });

  it('a new capture snapshots the saved setting at insert, set-once', () => {
    expect(SQL).toContain('before insert on public.capture_records');
    expect(SQL).toContain('if new.message_sequence is null then');
    expect(SQL).toContain('from public.pancake_integration_config c');
  });

  it('the Private Reply claim refuses a screenshot_first capture BEFORE it can be claimed', () => {
    expect(claimBody).toContain("c.message_sequence = 'screenshot_first'");
    expect(claimBody).toContain("return 'screenshot_first';");
    expect(claimBody.indexOf("return 'screenshot_first';")).toBeLessThan(
      claimBody.indexOf("set private_reply_status = 'sending'"),
    );
    // A reply that already went still answers 'already_sent' (idempotent re-entry).
    expect(claimBody).toContain("s.private_reply_status is distinct from 'sent'");
  });

  it('keeps the live claim rules and grants', () => {
    expect(claimBody).toContain('app_private.is_active_staff() or app_private.is_service_role()');
    expect(claimBody).toContain("send_claimed_at < now() - interval '5 minutes'");
    expect(SQL).toContain('revoke all on function public.claim_share_link_send(uuid) from public, anon;');
    expect(SQL).toContain(
      'revoke all on function app_private.stamp_capture_message_sequence() from public, anon, authenticated;',
    );
  });
});

/* ---------------------------------------------------------------------------------------------
 * COMPUTATION FIRST (Owner 2026-09-25)
 * ------------------------------------------------------------------------------------------- */

describe('Computation First settings values', () => {
  it('is a stable enum value with its own description and Screenshot Send Attempts (default 3, 1..3)', () => {
    expect(isMessageSequence('computation_first')).toBe(true);
    expect(isMessageSequence('Computation First')).toBe(false);
    expect(MESSAGE_SEQUENCE_OPTIONS.map((o) => o.value)).toEqual([
      'screenshot_first',
      'computation_first',
      'classic',
    ]);
    expect(MESSAGE_SEQUENCE_OPTIONS.find((o) => o.value === 'computation_first')?.description).toBe(
      'Send the invoice/computation first, then immediately attempt the screenshot. If the screenshot cannot be sent after the allowed attempts, wait for a genuine customer reply before sending the screenshot.',
    );
    expect(DEFAULT_SCREENSHOT_SEND_ATTEMPTS).toBe(3);
    expect([0, 1, 2, 3, 4, 1.5, 'x'].map(parseScreenshotSendAttempts)).toEqual([null, 1, 2, 3, null, null, null]);
    expect(attemptSettingFor('computation_first')).toBe('screenshot');
    expect(attemptSettingFor('screenshot_first')).toBe('text');
    expect(attemptSettingFor('classic')).toBeNull();
  });
});

describe('screenshot send classification (transient-only retry)', () => {
  const upload = (code: string, status: number | null = null) => ({
    ok: false,
    code,
    stage: 'upload' as const,
    uploadDiagnostics: { httpStatus: status },
  });

  it('an upload hiccup never reached the customer: network, 429 and 5xx are retried', () => {
    expect(classifyPhotoSend(upload('unavailable')).kind).toBe('retry');
    expect(classifyPhotoSend(upload('failed', 503)).kind).toBe('retry');
    expect(classifyPhotoSend(upload('failed', 429)).kind).toBe('retry');
  });

  it('an image Pancake refuses, or a missing token/page, is a finite failure', () => {
    expect(classifyPhotoSend(upload('failed', 400)).kind).toBe('failed');
    expect(classifyPhotoSend(upload('failed', null)).kind).toBe('failed');
    expect(classifyPhotoSend(upload('token_missing')).kind).toBe('failed');
  });

  it('the message request is judged exactly like the text', () => {
    expect(classifyPhotoSend({ ok: true, code: 'sent' }).kind).toBe('sent');
    expect(classifyPhotoSend({ ok: false, code: 'outside_window' }).kind).toBe('wait_reply');
    expect(classifyPhotoSend({ ok: false, code: 'failed', sendHttpStatus: 503 }).kind).toBe('retry');
    expect(classifyPhotoSend({ ok: false, code: 'failed', sendHttpStatus: 429, retryAfterSeconds: 7 })).toEqual({
      kind: 'retry',
      retryAfterMs: 7000,
    });
    expect(classifyPhotoSend({ ok: false, code: 'unavailable', transport: 'timeout' }).kind).toBe('ambiguous');
    expect(classifyPhotoSend({ ok: false, code: 'failed', sendHttpStatus: 504 }).kind).toBe('ambiguous');
    // Invalid token / malformed request (an invalid content_id): never retried.
    expect(
      classifyPhotoSend({ ok: false, code: 'failed', sendHttpStatus: 400, debug: '{"error_code":190}' }).kind,
    ).toBe('failed');
    expect(
      classifyPhotoSend({ ok: false, code: 'failed', sendHttpStatus: 400, debug: '(#100) Invalid parameter' }).kind,
    ).toBe('failed');
    // Facebook refusing the image because the chat is closed: wait for the customer.
    expect(
      classifyPhotoSend({
        ok: false,
        code: 'failed',
        sendHttpStatus: 200,
        sendMessageCode: 'invalid_upload_fb_attachments_result',
      }).kind,
    ).toBe('wait_reply');
  });
});

describe('Computation First status (its own wording, never Screenshot First text)', () => {
  const line = (ms: string | null, text: string | null, photo: string | null) =>
    sequenceStatusLines('computation_first', ms, text, photo)?.lines.join(' · ') ?? null;

  it('shows exactly the three Owner states', () => {
    expect(line('pending', 'sent', null)).toBe('Computation sent ✓ · Sending screenshot...');
    expect(line('sending', 'sent', 'sending')).toBe('Computation sent ✓ · Sending screenshot...');
    expect(line('pending', 'sent', 'pending')).toBe('Computation sent ✓ · Sending screenshot...');
    expect(line('sent', 'sent', 'sent')).toBe('Computation sent ✓ · Screenshot sent ✓');
    expect(line('link_sent', 'sent', 'waiting_reply')).toBe(
      'Computation sent ✓ · Waiting for customer reply to send screenshot',
    );
  });

  it('the computation itself: sending / waiting / not sent / unconfirmed', () => {
    expect(line('pending', 'sending', null)).toBe('Sending computation...');
    expect(line('link_sent', 'waiting_reply', null)).toBe('Waiting for customer reply to send computation');
    expect(line('failed', 'failed', null)).toBe('Computation not sent · open chat');
    expect(line('failed', 'unconfirmed', null)).toBe('Computation may not have sent · check chat');
    expect(line('pending', null, null)).toBeNull(); // not started: the card keeps its wording
  });

  it('a failed screenshot after the computation: the line says the computation went (the card names the failure)', () => {
    expect(line('failed', 'sent', 'failed')).toBe('Computation sent ✓');
    expect(line('failed', 'sent', 'unconfirmed')).toBe('Computation sent ✓');
  });

  it('never shows Screenshot First wording', () => {
    const states = [null, 'pending', 'sending', 'sent', 'waiting_reply', 'failed', 'unconfirmed'];
    const all = ['pending', 'sending', 'sent', 'link_sent', 'failed'].flatMap((ms) =>
      states.flatMap((t) => states.map((p) => line(ms, t, p) ?? '')),
    );
    for (const l of all) {
      expect(l).not.toMatch(/Screenshot sent ✓ · (Computation|Sending computation|Waiting for customer reply to send computation)/);
      expect(l).not.toContain('Waiting for customer to message');
    }
    expect(computationFirstRouteReason('photo_pending')).toBe('Computation sent ✓ · Sending screenshot...');
    expect(computationFirstRouteReason('photo_sent')).toBe('Computation sent ✓ · Screenshot sent ✓');
    expect(computationFirstRouteReason('photo_waiting_reply')).toBe(
      'Computation sent ✓ · Waiting for customer reply to send screenshot',
    );
  });

  it('Screenshot First wording is unchanged', () => {
    expect(sequenceStatusLines('screenshot_first', 'sent', 'sent')?.lines).toEqual([
      'Screenshot sent ✓',
      'Computation sent ✓',
    ]);
    expect(sequenceStatusLines('screenshot_first', 'sent', 'sent', 'sent')?.lines).toEqual([
      'Screenshot sent ✓',
      'Computation sent ✓',
    ]);
    expect(sequenceStatusLines('classic', 'sent', null, null)).toBeNull();
  });
});

describe('migration 20260925120000 — Computation First enforced in the database', () => {
  const RAW = readFileSync(
    join(__dirname, '..', '..', 'supabase', 'migrations', '20260925120000_capture_computation_first_sequence.sql'),
    'utf8',
  );
  const SQL = RAW.split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('--'))
    .join(String.fromCharCode(10))
    .toLowerCase();
  const fn = (name: string) => {
    const start = SQL.indexOf(`create or replace function ${name}(`);
    const end = SQL.indexOf('create or replace function', start + 10);
    return SQL.slice(start, end === -1 ? undefined : end);
  };

  it('is additive: nothing dropped except the two widened check constraints; no data changes', () => {
    expect(SQL).not.toMatch(/drop (table|column|function|index|trigger|policy)/);
    expect(SQL.match(/drop constraint if exists/g)).toHaveLength(2);
    expect(SQL).not.toMatch(/rename|delete from|truncate/);
    const topLevel = SQL.split(/\$(?:function)?\$/)
      .filter((_, i) => i % 2 === 0)
      .join(' ');
    expect(topLevel).not.toMatch(/update public\./);
    expect(SQL).toContain(
      "check (message_sequence is null or message_sequence in ('screenshot_first', 'computation_first', 'classic'))",
    );
  });

  it('HARD GATE: the shared screenshot claim refuses Computation First until the computation is sent', () => {
    const claim = fn('public.claim_capture_photo_send');
    expect(claim).toContain("c.message_sequence = 'computation_first'");
    expect(claim).toContain("return 'computation_first';");
    expect(claim.indexOf("return 'computation_first';")).toBeLessThan(claim.indexOf("set message_status = 'sending'"));
  });

  it('the screenshot leg claim requires the computation, and keeps the photo lock, budget and lease', () => {
    const leg = fn('public.claim_capture_photo_leg');
    expect(leg).toContain("return 'text_not_sent'");
    expect(leg.indexOf("return 'text_not_sent'")).toBeLessThan(leg.indexOf("set message_status = 'sending'"));
    expect(leg).toContain("interval '2 minutes'");
    expect(leg).toContain('r.photo_attempts >= coalesce(r.photo_max_attempts, 3)');
    expect(leg).toContain("if v_status = 'waiting_reply' and p_trigger <> 'reply' then return 'waiting_reply'");
    expect(leg).toContain("return 'unconfirmed'");
  });

  it('the Private Reply claim never repeats a computation that started in Messenger', () => {
    const share = fn('public.claim_share_link_send');
    expect(share).toContain("return 'screenshot_first';"); // the Screenshot First gate is kept
    expect(share).toContain("c.message_sequence = 'computation_first'");
    expect(share).toContain('c.text_send_status is not null');
    expect(share.indexOf("return 'computation_sent';")).toBeLessThan(
      share.indexOf("set private_reply_status = 'sending'"),
    );
  });

  it('the text claim keeps IMAGE THEN TEXT for Screenshot First only', () => {
    const t = fn('public.claim_capture_text_send');
    expect(t).toContain("if r.message_sequence = 'screenshot_first' and coalesce(r.message_status, '') <> 'sent' then");
    expect(t).toContain("r.message_sequence not in ('screenshot_first', 'computation_first')");
  });

  it('snapshots the sequence and attempt limits at insert', () => {
    const stamp = fn('app_private.stamp_capture_message_sequence');
    expect(stamp).toContain("if v_mode in ('screenshot_first', 'computation_first', 'classic') then");
    expect(stamp).toContain("when v_mode = 'computation_first' then greatest(1, least(coalesce(v_shots, 3), 3))");
  });

  it('closes every new function to PUBLIC, anon and authenticated (service role only)', () => {
    for (const sig of [
      'public.set_capture_sequence_conversation(uuid, text)',
      'public.claim_capture_photo_leg(uuid, text, text)',
      'public.finalize_capture_photo_leg(uuid, text, text, text, integer)',
      'public.park_capture_photo_leg(uuid, text)',
      'public.list_due_capture_photo_legs(integer)',
      'public.list_waiting_capture_photos(integer)',
    ]) {
      expect(SQL).toContain(`revoke all on function ${sig} from public, anon, authenticated;`);
      expect(SQL).toContain(`grant execute on function ${sig} to service_role;`);
    }
  });

  it('keeps the Screenshot First branches of the sweep guard and the due list', () => {
    const guard = fn('public.has_capture_routing_work');
    expect(guard).toContain("coalesce(c.message_status, '') in ('pending', 'awaiting_inbox')");
    expect(guard).toContain("c.message_sequence = 'screenshot_first'");
    const due = fn('public.list_due_capture_text_legs');
    expect(due).toMatch(/c\.message_sequence = 'screenshot_first'\s+and c\.message_status = 'sent'/);
  });
});
