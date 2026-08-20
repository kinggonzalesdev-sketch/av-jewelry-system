import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Controlled Test C harness locks: it uploads the screenshot, attaches the content id to the
// COMMENT private reply (never text, never a synthesized id), records one diagnostic, and
// classifies A/B/C/D. Fully mocked — no network.
const H = vi.hoisted(() => {
  const cfg = { crp: true, alreadyReplied: false, hasScreenshot: true };
  const rpc = vi.fn().mockResolvedValue({ data: 'diag', error: null });
  const uploadMock = vi.fn();
  const prMock = vi.fn();
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: 'https://x.supabase.co/sign?token=SECRET' },
  });
  function rawFor() {
    const message: Record<string, unknown> = { can_reply_privately: cfg.crp };
    if (cfg.alreadyReplied) message.private_reply_conversation = { id: 'prev_conv' };
    return { data: { message } };
  }
  function builder(table: string) {
    const b: Record<string, unknown> = {};
    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({
        data:
          table === 'pancake_webhook_events'
            ? {
                livestream_post_id: '588622885161430_1561919158756882',
                comment_id: '1561919158756882_1745968732977872',
                facebook_psid: '27782810028035237',
                conversation_id: '1561919158756882_1745968732977872',
                raw: rawFor(),
              }
            : { screenshot_path: cfg.hasScreenshot ? 'captures/dev/shot.jpg' : null },
        error: null,
      }),
    );
    return b;
  }
  const supabase = {
    from: vi.fn((t: string) => builder(t)),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
    rpc,
  };
  return { cfg, rpc, uploadMock, prMock, supabase };
});

vi.mock('@/lib/authz/guard', () => ({
  requirePrimarySuperAdmin: vi.fn(() => Promise.resolve()),
  AuthorizationError: class AuthorizationError extends Error {},
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(H.supabase)),
}));
vi.mock('@/lib/integrations/pancake', () => ({
  uploadPancakeImageContent: (...a: unknown[]) => H.uploadMock(...a) as Promise<unknown>,
  sendPancakePrivateReply: (...a: unknown[]) => H.prMock(...a) as Promise<unknown>,
  findPancakeInboxConversationByPsid: vi.fn(),
  getSelectedPancakePage: vi.fn(),
  getSelectedPancakeSender: vi.fn(),
  sendPancakeConversationMessage: vi.fn(),
}));

import { runControlledPrivateReplyMediaTest } from '@/lib/integrations/private-reply-test';

const UP_DIAG = {
  endpoint: 'https://pages.fm/api/public_api/v1/pages/{page_id}/upload_contents',
  apiVersion: 'v1',
  httpStatus: 200,
  httpOk: true,
  success: true,
  contentIdPresent: true,
  contentIdSuffix: '…abc123',
  type: 'PHOTO',
  messageCode: null,
};

function diagCalls() {
  return H.rpc.mock.calls.filter((c) => c[0] === 'record_controlled_photo_diagnostic');
}

describe('runControlledPrivateReplyMediaTest — Test C (comment-media private reply)', () => {
  beforeEach(() => {
    H.cfg.crp = true;
    H.cfg.alreadyReplied = false;
    H.cfg.hasScreenshot = true;
    H.rpc.mockClear();
    H.uploadMock.mockReset();
    H.prMock.mockReset();
    H.uploadMock.mockResolvedValue({ ok: true, contentId: 'CID_xyz', diag: UP_DIAG });
    H.prMock.mockResolvedValue({
      ok: true,
      code: 'sent',
      message: 'Private reply sent.',
      privateConversationId: 'conv',
      pancakeMessageId: 'm1',
      debug: 'HTTP 200 · private_replies · {"success":true}',
    });
  });

  it('attaches the content id + a REQUIRED non-empty message → ONE call, no fallback, classification C', async () => {
    const res = await runControlledPrivateReplyMediaTest({
      webhookEventId: 'wh1',
      screenshotCaptureId: '5543c409-21d6-4a04-9610-da3b3b2e3e71',
    });
    expect(res.ok).toBe(true);
    expect(H.uploadMock).toHaveBeenCalledTimes(1);
    // Exactly ONE private_replies call — no separate/fallback text send.
    expect(H.prMock).toHaveBeenCalledTimes(1);
    const sent = H.prMock.mock.calls[0]?.[0] as Record<string, unknown>;
    // media (content id) + a NON-EMPTY message on the SAME comment identity — never a synthetic id,
    // never text-only. private_replies requires the message even WITH media (Test C-A, error 100).
    expect(sent).toMatchObject({
      contentId: 'CID_xyz',
      messageId: '1561919158756882_1745968732977872',
      postId: '588622885161430_1561919158756882',
      fromId: '27782810028035237',
    });
    expect(typeof sent.message).toBe('string');
    expect((sent.message as string).length).toBeGreaterThan(0);
    const calls = diagCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0]?.[1] as Record<string, unknown>).p_classification).toBe('C');
  });

  it('upload valid but the media reply is rejected → classification B', async () => {
    H.prMock.mockResolvedValue({
      ok: false,
      code: 'failed',
      message: 'Pancake rejected the private reply.',
      privateConversationId: null,
      pancakeMessageId: null,
      debug: 'HTTP 200 · private_replies · {"success":false,"message_code":"x"}',
    });
    const res = await runControlledPrivateReplyMediaTest({
      webhookEventId: 'wh1',
      screenshotCaptureId: 'c',
    });
    expect(res.ok).toBe(false);
    expect((diagCalls()[0]?.[1] as Record<string, unknown>).p_classification).toBe('B');
  });

  it('upload staging failure → classification A, and NO private reply is attempted', async () => {
    H.uploadMock.mockResolvedValue({
      ok: false,
      code: 'failed',
      message: 'Pancake rejected the image upload.',
      diag: { ...UP_DIAG, success: false, contentIdPresent: false },
    });
    const res = await runControlledPrivateReplyMediaTest({
      webhookEventId: 'wh1',
      screenshotCaptureId: 'c',
    });
    expect(res.ok).toBe(false);
    expect(H.prMock).not.toHaveBeenCalled();
    expect((diagCalls()[0]?.[1] as Record<string, unknown>).p_classification).toBe('A');
  });

  it('a not-privately-replyable comment → no upload, no send (safe stop)', async () => {
    H.cfg.crp = false;
    const res = await runControlledPrivateReplyMediaTest({
      webhookEventId: 'wh1',
      screenshotCaptureId: 'c',
    });
    expect(res.ok).toBe(false);
    expect(H.uploadMock).not.toHaveBeenCalled();
    expect(H.prMock).not.toHaveBeenCalled();
  });

  it('an already-privately-replied comment → no upload, no send (#10900 guard)', async () => {
    H.cfg.alreadyReplied = true;
    const res = await runControlledPrivateReplyMediaTest({
      webhookEventId: 'wh1',
      screenshotCaptureId: 'c',
    });
    expect(res.ok).toBe(false);
    expect(H.uploadMock).not.toHaveBeenCalled();
    expect(H.prMock).not.toHaveBeenCalled();
  });
});
