import { beforeEach, describe, expect, it, vi } from 'vitest';

// server-only is a no-op under vitest.
vi.mock('server-only', () => ({}));

// Shared mocks (hoisted so the vi.mock factories can reference them).
const h = vi.hoisted(() => {
  const rpc = vi.fn().mockResolvedValue({ data: 'diag-id', error: null });
  const sendMock = vi.fn();
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { screenshot_path: 'captures/dev-inst/file-cap-1.jpg' } });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: 'https://proj.supabase.co/storage/v1/object/sign/x?token=SECRET_TOKEN' },
  });
  const captureBuilder = { select: vi.fn(), eq: vi.fn(), maybeSingle };
  captureBuilder.select.mockReturnValue(captureBuilder);
  captureBuilder.eq.mockReturnValue(captureBuilder);
  const supabase = {
    from: vi.fn().mockReturnValue(captureBuilder),
    storage: { from: vi.fn().mockReturnValue({ createSignedUrl }) },
    rpc,
  };
  return { rpc, sendMock, supabase };
});

vi.mock('@/lib/authz/guard', () => ({
  requirePrimarySuperAdmin: vi.fn(() => Promise.resolve()),
  AuthorizationError: class AuthorizationError extends Error {},
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(h.supabase)),
}));
vi.mock('@/lib/integrations/pancake', () => ({
  sendPancakeConversationMessage: (...args: unknown[]) =>
    h.sendMock(...args) as Promise<unknown>,
  findPancakeInboxConversationByPsid: vi.fn(),
  getSelectedPancakePage: vi.fn(),
  getSelectedPancakeSender: vi.fn(),
  sendPancakePrivateReply: vi.fn(),
}));

import {
  buildControlledPhotoDiagnostic,
  classifyControlledPhoto,
  sendControlledTestPhoto,
} from '@/lib/integrations/private-reply-test';

type Up = NonNullable<Parameters<typeof classifyControlledPhoto>[0]>;
function upDiag(over: Partial<Up> = {}): Up {
  return {
    endpoint: 'https://pages.fm/api/public_api/v1/pages/{page_id}/upload_contents',
    apiVersion: 'v1',
    httpStatus: 200,
    httpOk: true,
    success: true,
    contentIdPresent: true,
    contentIdSuffix: '…abc123',
    type: 'PHOTO',
    messageCode: null,
    ...over,
  };
}

describe('classifyControlledPhoto — A/B/C/D', () => {
  it('D when no upload diagnostics were captured', () => {
    expect(classifyControlledPhoto(undefined, { ok: false })).toBe('D');
  });
  it('A when upload success=false (staging failure)', () => {
    expect(
      classifyControlledPhoto(upDiag({ success: false, contentIdPresent: false }), { ok: false }),
    ).toBe('A');
  });
  it('A when no content id even with success=true', () => {
    expect(classifyControlledPhoto(upDiag({ contentIdPresent: false }), { ok: false })).toBe('A');
  });
  it('A when the returned type is not PHOTO', () => {
    expect(classifyControlledPhoto(upDiag({ type: 'VIDEO' }), { ok: false })).toBe('A');
  });
  it('B when upload is fully valid but the send was rejected', () => {
    expect(classifyControlledPhoto(upDiag(), { ok: false })).toBe('B');
  });
  it('C when upload is valid and the send succeeded', () => {
    expect(classifyControlledPhoto(upDiag(), { ok: true })).toBe('C');
  });
});

describe('buildControlledPhotoDiagnostic — one sanitized row', () => {
  it('emits last-6 refs and never a full id / PSID / page id', () => {
    const row = buildControlledPhotoDiagnostic({
      captureId: '5543c409-21d6-4a04-9610-da3b3b2e3e71',
      conversationId: '588622885161430_27782810028035237',
      photo: {
        ok: false,
        uploadDiagnostics: upDiag(),
        sendHttpStatus: 200,
        sendSuccess: false,
        sendMessageCode: 'invalid_upload_fb_attachments_result',
      },
    });
    expect(row.captureRef).toBe('2e3e71');
    expect(row.conversationRef).toBe('035237');
    expect(row.classification).toBe('B');
    expect(row.uploadApiVersion).toBe('v1');
    expect(row.uploadSuccess).toBe(true);
    expect(row.sendSuccess).toBe(false);
    expect(row.sendMessageCode).toBe('invalid_upload_fb_attachments_result');
    const blob = JSON.stringify(row);
    expect(blob).not.toContain('5543c409'); // no full capture id
    expect(blob).not.toContain('27782810028035237'); // no full PSID
    expect(blob).not.toContain('588622885161430'); // no page id
  });

  it('D + null upload fields when no diagnostics were captured', () => {
    const row = buildControlledPhotoDiagnostic({
      captureId: 'abc',
      conversationId: 'xyz',
      // uploadDiagnostics + sendSuccess intentionally OMITTED (no upload happened).
      photo: { ok: false, sendHttpStatus: null, sendMessageCode: null },
    });
    expect(row.classification).toBe('D');
    expect(row.uploadSuccess).toBeNull();
    expect(row.uploadApiVersion).toBeNull();
  });
});

describe('sendControlledTestPhoto — one click = exactly one durable row', () => {
  beforeEach(() => {
    h.rpc.mockClear();
    h.sendMock.mockReset();
    h.sendMock.mockResolvedValue({
      ok: false,
      code: 'failed',
      message: 'Pancake rejected the message.',
      pancakeMessageId: null,
      debug: 'HTTP 200 · path ... · {"success":false,"message_code":"invalid_upload_fb_attachments_result"}',
      uploadDiagnostics: upDiag(),
      sentForm: 'action=reply_inbox&content_ids[]=…abc123&attachment_type=PHOTO',
      sendHttpStatus: 200,
      sendSuccess: false,
      sendMessageCode: 'invalid_upload_fb_attachments_result',
    });
  });

  it('records EXACTLY ONE sanitized diagnostic per attempt', async () => {
    await sendControlledTestPhoto({
      conversationId: '588622885161430_27782810028035237',
      screenshotCaptureId: '5543c409-21d6-4a04-9610-da3b3b2e3e71',
    });
    const calls = h.rpc.mock.calls.filter(
      (c) => c[0] === 'record_controlled_photo_diagnostic',
    );
    expect(calls).toHaveLength(1);
    const args = (calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(args.p_classification).toBe('B'); // upload valid, send rejected
    expect(args.p_capture_ref).toBe('2e3e71');
    expect(args.p_conversation_ref).toBe('035237');
    expect(args.p_send_message_code).toBe('invalid_upload_fb_attachments_result');
    // Nothing sensitive is ever handed to the writer RPC.
    const blob = JSON.stringify(args);
    expect(blob).not.toContain('5543c409'); // no full capture id
    expect(blob).not.toContain('27782810028035237'); // no full PSID
    expect(blob.toLowerCase()).not.toContain('token'); // no token
    expect(blob).not.toContain('signed'); // no signed URL
  });
});
