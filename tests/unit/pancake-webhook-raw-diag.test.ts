import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * TEMPORARY pin-signal raw-capture net (Owner request 2026-08-20, instrumentation only). These
 * tests pin the safety contract: OFF by default (no admin client, no DB), ON copies the full body
 * to the append-only diagnostic writer with best-effort field extraction, credential keys are
 * redacted while pin/rank/order keys survive the diff, and it NEVER throws into the webhook path.
 */
const H = vi.hoisted(() => {
  const rpc = vi.fn((_fn: string, _args: Record<string, unknown>) =>
    Promise.resolve({ data: 'diag-id', error: null }),
  );
  return { rpc, createAdminClient: vi.fn(() => ({ rpc })) };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => H.createAdminClient(),
}));

import { captureWebhookRawDiag, isRawDiagCaptureEnabled } from '@/lib/integrations/pancake-webhook';

/** The args of the most recent diagnostic RPC call. */
function lastArgs(): Record<string, unknown> {
  const call = H.rpc.mock.calls.at(-1);
  if (!call) throw new Error('webhook_capture_raw_diag was not called');
  return call[1];
}

const ENV = process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE;
const TAG = process.env.PANCAKE_WEBHOOK_DIAG_TAG;

// A realistic pages.fm live-comment envelope, plus a credential-looking key and a hypothetical
// pin key to prove redaction is scoped and the signal hunt is preserved.
const BODY = {
  page_id: 'PAGE_1',
  data: {
    post: { id: 'POST_9', type: 'livestream' },
    message: {
      id: 'COMMENT_7',
      type: 'comment',
      message: 'PINTEST-A Mine 1.5',
      is_pinned: true, // hypothetical — must survive redaction so the diff can see it
      from: { id: 'PSID_3', name: 'Gen Gonz' },
    },
    conversation: { id: 'CONV_2' },
  },
  access_token: 'SHOULD_BE_REDACTED',
};

beforeEach(() => {
  H.rpc.mockClear();
  H.createAdminClient.mockClear();
  delete process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE;
  delete process.env.PANCAKE_WEBHOOK_DIAG_TAG;
});
afterEach(() => {
  if (ENV === undefined) delete process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE;
  else process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE = ENV;
  if (TAG === undefined) delete process.env.PANCAKE_WEBHOOK_DIAG_TAG;
  else process.env.PANCAKE_WEBHOOK_DIAG_TAG = TAG;
});

describe('captureWebhookRawDiag — temporary pin-signal net', () => {
  it('is OFF by default → no admin client, no DB write (production untouched)', async () => {
    expect(isRawDiagCaptureEnabled()).toBe(false);
    await captureWebhookRawDiag(BODY);
    expect(H.createAdminClient).not.toHaveBeenCalled();
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('treats any value other than "on" as disabled', async () => {
    process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE = 'true';
    expect(isRawDiagCaptureEnabled()).toBe(false);
    await captureWebhookRawDiag(BODY);
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('ON → appends via the append-only writer with best-effort extracted identity', async () => {
    process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE = 'on';
    process.env.PANCAKE_WEBHOOK_DIAG_TAG = 'PINTEST-820';
    expect(isRawDiagCaptureEnabled()).toBe(true);
    await captureWebhookRawDiag(BODY);
    expect(H.rpc).toHaveBeenCalledTimes(1);
    expect(H.rpc.mock.calls.at(-1)?.[0]).toBe('webhook_capture_raw_diag');
    expect(lastArgs()).toMatchObject({
      p_page_id: 'PAGE_1',
      p_comment_id: 'COMMENT_7',
      p_post_id: 'POST_9',
      p_event_type: 'comment',
      p_tag: 'PINTEST-820',
    });
  });

  it('redacts credential-looking keys but PRESERVES pin/signal keys for the diff', async () => {
    process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE = 'on';
    await captureWebhookRawDiag(BODY);
    const raw = lastArgs().p_raw as Record<string, unknown>;
    // credential redacted…
    expect(raw.access_token).toBe('[redacted]');
    // …but the (hypothetical) pin signal and real comment identity survive untouched.
    const data = raw.data as Record<string, unknown>;
    const message = data.message as Record<string, unknown>;
    expect(message.is_pinned).toBe(true);
    expect(message.id).toBe('COMMENT_7');
    expect(message.message).toBe('PINTEST-A Mine 1.5');
  });

  it('never throws even if the diagnostic insert rejects', async () => {
    process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE = 'on';
    H.rpc.mockReturnValueOnce(Promise.reject(new Error('db down')));
    await expect(captureWebhookRawDiag(BODY)).resolves.toBeUndefined();
  });

  it('tolerates a non-object / empty body without throwing', async () => {
    process.env.PANCAKE_WEBHOOK_DIAG_CAPTURE = 'on';
    await expect(captureWebhookRawDiag(null)).resolves.toBeUndefined();
    const args = lastArgs();
    expect(args.p_page_id).toBeNull();
    expect(args.p_comment_id).toBeNull();
  });
});
