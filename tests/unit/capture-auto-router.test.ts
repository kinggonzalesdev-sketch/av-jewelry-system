import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reactivatePhotoForConversationSystem,
  routePendingCapturesSystem,
} from '@/lib/capture/auto-router';
import * as mediaWindow from '@/lib/capture/media-window';
import * as routeB from '@/lib/capture/route-b';
import * as pancake from '@/lib/integrations/pancake';

// The router builds an admin client + calls RPCs on it; capture the rpc calls to assert routing.
const rpcCalls: Array<{ name: string; args: unknown }> = [];
let claimedBatch: Array<Record<string, unknown>> = [];
// Rows the .from('capture_records') query resolves to (used by the reactivation path).
let captureRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_captures_to_route') return Promise.resolve({ data: claimedBatch, error: null });
      if (name === 'mark_captures_route_exhausted') return Promise.resolve({ data: 0, error: null });
      if (name === 'claim_capture_photo_send') return Promise.resolve({ data: 'claimed', error: null });
      return Promise.resolve({ data: null, error: null });
    },
    // Chainable query builder whose terminal .limit() resolves to captureRows (reactivation path).
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'not', 'in', 'gt', 'order']) b[m] = () => b;
      b.limit = () => Promise.resolve({ data: captureRows, error: null });
      return b;
    },
    storage: {
      from: () => ({
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://signed/ss.jpg' } }),
      }),
    },
  }),
}));

vi.mock('@/lib/integrations/pancake', () => ({
  getActivePancakePageId: vi.fn(() => Promise.resolve('PAGE')),
  conversationBelongsToPage: vi.fn((id: string) => (id ?? '').startsWith('PAGE_')),
  resolveConversationForName: vi.fn(() =>
    Promise.resolve({ conversationId: null, matchCount: 0, source: 'none' }),
  ),
  sendPancakeConversationMessage: vi.fn(() =>
    Promise.resolve({ ok: true, code: 'sent', message: 'ok', pancakeMessageId: 'MID' }),
  ),
}));

vi.mock('@/lib/capture/media-window', async () => {
  const actual = await vi.importActual<typeof mediaWindow>('@/lib/capture/media-window');
  return { ...actual, isConversationMediaEligible: vi.fn() };
});

vi.mock('@/lib/capture/route-b', () => ({
  attemptSecureLinkPrivateReply: vi.fn(),
}));

const cap = (over: Record<string, unknown> = {}) => ({
  id: 'cap1',
  ocr: { fbName: 'King Gonzales', itemQuery: '1.5' },
  screenshot_path: 'p.jpg',
  pancake_conversation_id: 'PAGE_2825',
  message_status: 'awaiting_inbox',
  ...over,
});

const reasonOf = () =>
  (rpcCalls.find((c) => c.name === 'set_capture_route_reason')?.args as { p_reason?: string } | undefined)
    ?.p_reason ?? '';
const photoStateOf = () =>
  (rpcCalls.find((c) => c.name === 'mark_capture_photo_state')?.args as { p_status?: string } | undefined)
    ?.p_status ?? '';

describe('durable auto-router — routing decisions', () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    claimedBatch = [];
    captureRows = [];
    vi.mocked(pancake.sendPancakeConversationMessage).mockClear();
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockReset();
    vi.mocked(mediaWindow.isConversationMediaEligible).mockReset();
    // Default: no Inbox conversation discoverable by name (Part-1 tests override this).
    vi.mocked(pancake.resolveConversationForName).mockResolvedValue({
      conversationId: null,
      matchCount: 0,
      source: 'none',
    });
  });

  it('ROUTE A — media-eligible → sends the ACTUAL photo, never a secure link', async () => {
    claimedBatch = [cap()];
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    const summary = await routePendingCapturesSystem();
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(routeB.attemptSecureLinkPrivateReply)).not.toHaveBeenCalled();
    expect(reasonOf()).toContain('AUTO SS Sent to Messenger ✓');
    expect(summary.outcomes.photo_sent).toBe(1);
  });

  it('ROUTE B — not eligible + resolvable comment → ONE secure-link TEXT, marks link_sent', async () => {
    claimedBatch = [cap()];
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({ ok: true, code: 'sent', url: 'u' });
    const summary = await routePendingCapturesSystem();
    // The secure-link path resolves by the capture's EXACT PSID (from its linked conversation).
    const arg = vi.mocked(routeB.attemptSecureLinkPrivateReply).mock.calls[0]![0];
    expect(arg.psid).toBe('2825');
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).not.toHaveBeenCalled();
    expect(photoStateOf()).toBe('link_sent');
    expect(reasonOf()).toContain('AUTO TEXT Sent to Messenger ✓');
    expect(summary.outcomes.text_sent).toBe(1);
  });

  it('WAITING — not eligible + no resolvable comment → parked awaiting_inbox with a finite reason', async () => {
    claimedBatch = [cap()];
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({
      ok: false,
      code: 'no_exact_comment',
      message: 'Needs Review',
    });
    const summary = await routePendingCapturesSystem();
    expect(photoStateOf()).toBe('awaiting_inbox');
    expect(reasonOf()).toContain('awaiting comment context');
    expect(summary.outcomes.awaiting).toBe(1);
  });

  // PART 1 (Owner 2026-08-22, "Ruby Rosé"): the actual screenshot PHOTO must win even when the
  // capture has NO stored pancake_conversation_id — the router resolves the customer's real Inbox
  // conversation by name and, if it is media-eligible, sends the PHOTO instead of the AUTO TEXT.
  it('SCREENSHOT PRIORITY — no stored conversation, name resolves to a media-eligible Inbox → sends the PHOTO, not AUTO TEXT', async () => {
    claimedBatch = [cap({ pancake_conversation_id: null, ocr: { fbName: 'Ruby Rosé', itemQuery: '1.5' } })];
    vi.mocked(pancake.resolveConversationForName).mockResolvedValue({
      conversationId: 'PAGE_777',
      matchCount: 1,
      source: 'customer',
    });
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    const summary = await routePendingCapturesSystem();
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(routeB.attemptSecureLinkPrivateReply)).not.toHaveBeenCalled();
    expect(reasonOf()).toContain('AUTO SS Sent to Messenger ✓');
    expect(summary.outcomes.photo_sent).toBe(1);
  });

  it('no stored conversation, name resolves but NOT media-eligible → Route B, keyed off the discovered PSID', async () => {
    claimedBatch = [cap({ pancake_conversation_id: null, ocr: { fbName: 'Ruby Rosé', itemQuery: '1.5' } })];
    vi.mocked(pancake.resolveConversationForName).mockResolvedValue({
      conversationId: 'PAGE_777',
      matchCount: 1,
      source: 'customer',
    });
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({ ok: true, code: 'sent', url: 'u' });
    const summary = await routePendingCapturesSystem();
    const arg = vi.mocked(routeB.attemptSecureLinkPrivateReply).mock.calls[0]![0];
    expect(arg.psid).toBe('777');
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).not.toHaveBeenCalled();
    expect(photoStateOf()).toBe('link_sent');
    expect(summary.outcomes.text_sent).toBe(1);
  });

  it('TERMINAL Route B failure (reply_failed) → capture marked FAILED immediately, no "Preparing" loop', async () => {
    claimedBatch = [cap()];
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({
      ok: false,
      code: 'reply_failed',
      message: 'not accepted',
    });
    const summary = await routePendingCapturesSystem();
    expect(photoStateOf()).toBe('failed');
    expect(reasonOf()).toContain('AUTO TEXT not sent');
    expect(summary.outcomes.text_failed).toBe(1);
  });

  it('always finalizes the sweep by moving budget-exhausted captures to a finite state', async () => {
    claimedBatch = [];
    const summary = await routePendingCapturesSystem();
    expect(rpcCalls.some((c) => c.name === 'mark_captures_route_exhausted')).toBe(true);
    expect(summary.claimed).toBe(0);
  });
});

describe('reactivatePhotoForConversationSystem — genuine reply → AUTO SS (Case B)', () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    captureRows = [];
    vi.mocked(pancake.sendPancakeConversationMessage).mockClear();
    vi.mocked(mediaWindow.isConversationMediaEligible).mockReset();
  });

  it('customer now eligible + their waiting link_sent capture → sends the actual PHOTO', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    captureRows = [
      { id: 'capX', screenshot_path: 'p.jpg', pancake_conversation_id: 'PAGE_777' },
    ];
    const r = await reactivatePhotoForConversationSystem('PAGE_777');
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).toHaveBeenCalledTimes(1);
    expect(rpcCalls.some((c) => c.name === 'claim_capture_photo_send')).toBe(true);
    expect(r.sent).toBe(1);
  });

  it('NOT eligible (a mere comment, window not open) → sends nothing', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    captureRows = [{ id: 'capX', screenshot_path: 'p.jpg', pancake_conversation_id: 'PAGE_777' }];
    const r = await reactivatePhotoForConversationSystem('PAGE_777');
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).not.toHaveBeenCalled();
    expect(r.eligible).toBe(false);
    expect(r.sent).toBe(0);
  });

  it('exact identity only — a different-PSID capture is NOT woken', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    captureRows = [{ id: 'other', screenshot_path: 'p.jpg', pancake_conversation_id: 'PAGE_999' }];
    const r = await reactivatePhotoForConversationSystem('PAGE_777');
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).not.toHaveBeenCalled();
    expect(r.considered).toBe(0);
  });

  it('off-page conversation → no-op', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    const r = await reactivatePhotoForConversationSystem('OTHERPAGE_1');
    expect(r.eligible).toBe(false);
    expect(vi.mocked(pancake.sendPancakeConversationMessage)).not.toHaveBeenCalled();
  });
});
