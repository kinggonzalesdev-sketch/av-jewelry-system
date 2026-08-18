import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Configurable mocks for the capture screenshot-delivery path.
const H = vi.hoisted(() => {
  const cfg = {
    captureRow: null as Record<string, unknown> | null,
    signedUrl: 'https://signed.example/x?token=SECRET' as string | null,
    claimResult: 'claimed' as string,
    claimQueue: null as string[] | null,
    mediaEligible: true,
    resolveResult: {
      conversationId: null as string | null,
      matchCount: 0,
      source: 'none',
    },
    activePageId: '588622885161430',
    sendResult: {
      ok: true,
      code: 'sent',
      message: 'ok',
      pancakeMessageId: 'm1',
    } as Record<string, unknown>,
  };
  const rpc = vi.fn((name: string, _args?: unknown) => {
    void _args;
    if (name === 'claim_capture_photo_send') {
      const q = cfg.claimQueue;
      const val = q && q.length ? q.shift() : cfg.claimResult;
      return Promise.resolve({ data: val, error: null });
    }
    if (name === 'finalize_capture_photo_send')
      return Promise.resolve({ data: 'sent', error: null });
    if (name === 'mark_capture_photo_state')
      return Promise.resolve({ data: 'ok', error: null });
    return Promise.resolve({ data: null, error: null });
  });
  const createSignedUrl = vi.fn(() =>
    Promise.resolve({ data: cfg.signedUrl ? { signedUrl: cfg.signedUrl } : null }),
  );
  const captureBuilder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(() => Promise.resolve({ data: cfg.captureRow, error: null })),
  };
  captureBuilder.select.mockReturnValue(captureBuilder);
  captureBuilder.eq.mockReturnValue(captureBuilder);
  const supabase = {
    from: vi.fn(() => captureBuilder),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
    rpc,
  };
  const sendMock = vi.fn((..._a: unknown[]) => Promise.resolve(cfg.sendResult));
  const resolveMock = vi.fn((..._a: unknown[]) => Promise.resolve(cfg.resolveResult));
  const eligibleMock = vi.fn((..._a: unknown[]) => Promise.resolve(cfg.mediaEligible));
  return { cfg, rpc, createSignedUrl, supabase, sendMock, resolveMock, eligibleMock };
});

vi.mock('@/lib/authz/guard', () => ({
  requirePermission: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(H.supabase)),
}));
vi.mock('@/lib/audit/log', () => ({
  recordAuditEvent: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/lib/capture/media-window', () => ({
  isConversationMediaEligible: (...a: unknown[]) => H.eligibleMock(...a),
}));
vi.mock('@/lib/integrations/pancake', () => ({
  getActivePancakePageId: () => Promise.resolve(H.cfg.activePageId),
  conversationBelongsToPage: (id: string | null, page: string) =>
    Boolean(id) && Boolean(page) && (id as string).startsWith(`${page}_`),
  resolveConversationForName: (...a: unknown[]) => H.resolveMock(...a),
  sendPancakeConversationMessage: (...a: unknown[]) => H.sendMock(...a),
}));

import { sendPendingCaptureToMessenger } from '@/lib/capture/pc-send';

const INBOX_CONV = '588622885161430_27782810028035237';

function rpcCalls(name: string) {
  return H.rpc.mock.calls.filter((c) => c[0] === name);
}
/** The exact `message` field handed to Pancake on every send this test made. */
function sentMessages(): unknown[] {
  return H.sendMock.mock.calls.map((c) => (c[0] as { message?: unknown })?.message);
}

beforeEach(() => {
  H.rpc.mockClear();
  H.sendMock.mockClear();
  H.resolveMock.mockClear();
  H.eligibleMock.mockClear();
  H.createSignedUrl.mockClear();
  H.cfg.captureRow = {
    id: 'cap-1',
    screenshot_path: 'captures/dev/shot.jpg',
    ocr: { fbName: 'King Gonzales' },
    message_status: 'pending',
    pancake_conversation_id: INBOX_CONV,
  };
  H.cfg.signedUrl = 'https://signed.example/x?token=SECRET';
  H.cfg.claimResult = 'claimed';
  H.cfg.claimQueue = null;
  H.cfg.mediaEligible = true;
  H.cfg.resolveResult = { conversationId: null, matchCount: 0, source: 'none' };
  H.cfg.activePageId = '588622885161430';
  H.cfg.sendResult = { ok: true, code: 'sent', message: 'ok', pancakeMessageId: 'm1' };
});

describe('MineFlow Capture screenshot delivery — hardened send path', () => {
  it('1. screenshot exists + eligible conversation → exactly ONE PHOTO send', async () => {
    const res = await sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true });
    expect(res.ok).toBe(true);
    expect(res).toMatchObject({ code: 'sent' });
    expect(H.sendMock).toHaveBeenCalledTimes(1);
    expect(H.sendMock.mock.calls[0]?.[0]).toMatchObject({
      conversationId: INBOX_CONV,
      message: '', // PHOTO only — never text
      attachmentUrl: 'https://signed.example/x?token=SECRET',
    });
    expect(rpcCalls('claim_capture_photo_send')).toHaveLength(1);
    expect(rpcCalls('finalize_capture_photo_send')).toHaveLength(1);
    expect(rpcCalls('finalize_capture_photo_send')[0]?.[1]).toMatchObject({ p_ok: true });
    expect(rpcCalls('mark_capture_photo_state')).toHaveLength(0);
    // used the stored conversation directly — no name-only resolution, no synthetic id
    expect(H.resolveMock).not.toHaveBeenCalled();
  });

  it('2. screenshot missing → ZERO Messenger sends and ZERO "Reserved" fallback', async () => {
    H.cfg.captureRow!.screenshot_path = null;
    const res = await sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: false, code: 'no_screenshot' });
    expect(H.sendMock).not.toHaveBeenCalled(); // nothing sent at all
    expect(sentMessages().join('|')).not.toMatch(/reserved/i);
    expect(rpcCalls('mark_capture_photo_state')[0]?.[1]).toMatchObject({ p_status: 'failed' });
    expect(rpcCalls('claim_capture_photo_send')).toHaveLength(0);
  });

  it('3. upload failure → ZERO text fallback; capture stays reviewable (failed)', async () => {
    H.cfg.sendResult = {
      ok: false,
      code: 'failed',
      message: 'rejected',
      pancakeMessageId: null,
      debug: 'HTTP 200 ... invalid_upload_fb_attachments_result',
    };
    const res = await sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: false, code: 'failed' });
    // it DID attempt a PHOTO (message empty) — and did NOT fall back to any text
    expect(H.sendMock).toHaveBeenCalledTimes(1);
    expect(sentMessages()).toEqual(['']);
    expect(rpcCalls('finalize_capture_photo_send')[0]?.[1]).toMatchObject({ p_ok: false });
  });

  it('4. comment-only customer, no qualifying inbox → PHOTO deferred (awaiting_inbox)', async () => {
    H.cfg.mediaEligible = false;
    const res = await sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: false, code: 'awaiting_inbox' });
    expect(H.sendMock).not.toHaveBeenCalled();
    expect(rpcCalls('mark_capture_photo_state')[0]?.[1]).toMatchObject({
      p_status: 'awaiting_inbox',
    });
    expect(rpcCalls('claim_capture_photo_send')).toHaveLength(0);
  });

  it('5. qualified customer-initiated inbox exists → PHOTO becomes eligible + sends once', async () => {
    H.cfg.mediaEligible = true;
    const res = await sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: true, code: 'sent' });
    expect(H.eligibleMock).toHaveBeenCalledTimes(1);
    expect(H.sendMock).toHaveBeenCalledTimes(1);
  });

  it('6. auto-send + manual-send race → ONE outbound send only', async () => {
    H.cfg.claimQueue = ['claimed', 'in_progress'];
    const [a, b] = await Promise.all([
      sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true }), // auto
      sendPendingCaptureToMessenger('cap-1'), // manual
    ]);
    expect(H.sendMock).toHaveBeenCalledTimes(1);
    const codes = [a.ok ? a.code : a.code, b.ok ? b.code : b.code];
    expect(codes).toContain('sent');
    expect(codes).toContain('in_progress');
  });

  it('7. double click → ONE outbound send only', async () => {
    H.cfg.claimQueue = ['claimed', 'in_progress'];
    await Promise.all([
      sendPendingCaptureToMessenger('cap-1'),
      sendPendingCaptureToMessenger('cap-1'),
    ]);
    expect(H.sendMock).toHaveBeenCalledTimes(1);
  });

  it('8. already-sent capture → duplicate blocked (no send, no claim)', async () => {
    H.cfg.captureRow!.message_status = 'sent';
    const res = await sendPendingCaptureToMessenger('cap-1');
    expect(res).toMatchObject({ ok: true, code: 'already_sent' });
    expect(H.sendMock).not.toHaveBeenCalled();
    expect(rpcCalls('claim_capture_photo_send')).toHaveLength(0);
  });

  it('9. failed capture → explicit MANUAL retry still sends once', async () => {
    H.cfg.captureRow!.message_status = 'failed';
    const res = await sendPendingCaptureToMessenger('cap-1'); // manual retry
    expect(res).toMatchObject({ ok: true, code: 'sent' });
    expect(H.sendMock).toHaveBeenCalledTimes(1);
  });

  it('10. no synthetic conversation id + no name-only recipient (ambiguous → no send)', async () => {
    H.cfg.captureRow!.pancake_conversation_id = null; // force name resolution
    H.cfg.resolveResult = { conversationId: null, matchCount: 2, source: 'none' }; // ambiguous
    const res = await sendPendingCaptureToMessenger('cap-1', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: false, code: 'ambiguous' });
    expect(H.resolveMock).toHaveBeenCalledTimes(1); // used the unique-match resolver
    expect(H.sendMock).not.toHaveBeenCalled(); // never a name-only / synthetic-id send
  });
});
