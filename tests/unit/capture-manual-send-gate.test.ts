import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * The manual Incoming Captures "Send" now respects photo eligibility (Owner request 2026-08-20):
 * `sendCaptureToMessengerAction` gates on the SAME media window as the auto path — it delegates to
 * `sendPendingCaptureToMessenger(id, { requireMediaWindow: true })`. A "Photo waiting" customer is
 * therefore parked 'awaiting_inbox' by the shared guard (proven in capture-photo-send.test.ts) and
 * the manual button never fires a doomed reply_inbox PHOTO / "Pancake rejected". These tests pin
 * the delegation contract and the clean pass-through of the parked result.
 */
const H = vi.hoisted(() => ({
  send: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...a: unknown[]) => {
    H.revalidate(...a);
  },
}));
vi.mock('@/lib/capture/pc-send', () => ({
  sendPendingCaptureToMessenger: (...a: unknown[]) => H.send(...a) as Promise<unknown>,
}));
// The other pending-actions imports are unrelated to this action — stub them so the module loads
// hermetically (no heavy orders/matching graph, no real Supabase/token).
vi.mock('@/lib/capture/pending-link', () => ({
  resolveAndPersistCaptureLink: vi.fn(),
  persistCaptureLink: vi.fn(),
  listCaptureCandidates: vi.fn(),
  resolveChosenCustomer: vi.fn(),
}));
vi.mock('@/lib/orders/for-invoice', () => ({ autoSendCaptureForOrder: vi.fn() }));
vi.mock('@/lib/capture/pending', () => ({ listPendingCaptures: vi.fn() }));
vi.mock('@/lib/capture/media-window', () => ({ isConversationMediaEligible: vi.fn() }));
vi.mock('@/lib/authz/guard', () => ({ requirePermission: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { sendCaptureToMessengerAction } from '@/lib/capture/pending-actions';

beforeEach(() => {
  H.send.mockReset();
  H.revalidate.mockClear();
});

describe('sendCaptureToMessengerAction — manual Send respects the media window', () => {
  it('always delegates with requireMediaWindow:true (same gate as auto-send)', async () => {
    H.send.mockResolvedValue({ ok: true, code: 'sent', message: 'Sent to Messenger ✓' });
    const res = await sendCaptureToMessengerAction('cap-ready');
    expect(H.send).toHaveBeenCalledTimes(1);
    expect(H.send).toHaveBeenCalledWith('cap-ready', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: true, code: 'sent' });
  });

  it('Photo ready → the underlying PHOTO send result passes through and /orders revalidates', async () => {
    H.send.mockResolvedValue({ ok: true, code: 'sent', message: 'Sent to Messenger ✓' });
    const res = await sendCaptureToMessengerAction('cap-ready');
    expect(res.ok).toBe(true);
    expect(H.revalidate).toHaveBeenCalledWith('/orders');
  });

  it('Photo waiting → parked awaiting_inbox passes through cleanly (no rejection, no revalidate)', async () => {
    H.send.mockResolvedValue({
      ok: false,
      code: 'awaiting_inbox',
      error: 'Waiting for the customer to message first — screenshot not auto-sent.',
    });
    const res = await sendCaptureToMessengerAction('cap-waiting');
    // Gated the same way, then returned the clean parked code — never a doomed send.
    expect(H.send).toHaveBeenCalledWith('cap-waiting', { requireMediaWindow: true });
    expect(res).toMatchObject({ ok: false, code: 'awaiting_inbox' });
    if (!res.ok) expect(res.error).not.toMatch(/pancake rejected/i);
    // A parked (not-ok) result must NOT revalidate as if something was sent.
    expect(H.revalidate).not.toHaveBeenCalled();
  });
});
