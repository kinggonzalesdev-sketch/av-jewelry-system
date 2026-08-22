import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routePendingCapturesSystem } from '@/lib/capture/auto-router';
import * as mediaWindow from '@/lib/capture/media-window';
import * as routeB from '@/lib/capture/route-b';
import * as pancake from '@/lib/integrations/pancake';

// The router builds an admin client + calls RPCs on it; capture the rpc calls to assert routing.
const rpcCalls: Array<{ name: string; args: unknown }> = [];
let claimedBatch: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      if (name === 'claim_captures_to_route') return Promise.resolve({ data: claimedBatch, error: null });
      if (name === 'mark_captures_route_exhausted') return Promise.resolve({ data: 0, error: null });
      if (name === 'claim_capture_photo_send') return Promise.resolve({ data: 'claimed', error: null });
      return Promise.resolve({ data: null, error: null });
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
  conversationBelongsToPage: vi.fn(() => true),
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
    vi.mocked(pancake.sendPancakeConversationMessage).mockClear();
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockReset();
    vi.mocked(mediaWindow.isConversationMediaEligible).mockReset();
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

  it('always finalizes the sweep by moving budget-exhausted captures to a finite state', async () => {
    claimedBatch = [];
    const summary = await routePendingCapturesSystem();
    expect(rpcCalls.some((c) => c.name === 'mark_captures_route_exhausted')).toBe(true);
    expect(summary.claimed).toBe(0);
  });
});
