import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { attemptSecureLinkPrivateReply } from '@/lib/capture/route-b';
import { encryptShareToken } from '@/lib/capture/share-link';
import * as pancake from '@/lib/integrations/pancake';

vi.mock('@/lib/integrations/pancake', () => ({
  getActivePancakePageId: vi.fn(() => Promise.resolve('PAGE')),
  sendPancakePrivateReply: vi.fn(() =>
    Promise.resolve({
      ok: true,
      code: 'sent',
      message: 'ok',
      privateConversationId: null,
      pancakeMessageId: 'MID',
    }),
  ),
}));

// Audit is best-effort + session-scoped (no request context in unit tests) — stub it to a no-op so
// the pipeline-stage audit calls don't reach into Supabase/next headers here.
vi.mock('@/lib/audit/log', () => ({
  recordAuditEvent: vi.fn(() => Promise.resolve()),
}));

beforeAll(() => {
  process.env.CAPTURE_LINK_ENC_KEY = Buffer.alloc(32, 9).toString('base64');
});

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;
function mockSupabase(handlers: Handlers) {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) =>
    Promise.resolve({ data: handlers[name] ? handlers[name](args) : null, error: null }),
  );
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

const CT = () => encryptShareToken('rawtok')!; // decryptable ciphertext → a real /m URL
const RESOLVED = {
  resolved: true,
  page_id: 'PAGE',
  post_id: 'POST',
  comment_id: 'C1',
  facebook_psid: 'PSID',
  conversation_id: 'PAGE_PSID',
  event_timestamp: new Date().toISOString(),
  matchCount: 1,
};

beforeEach(() => {
  vi.mocked(pancake.sendPancakePrivateReply).mockClear();
});

describe('Route B — secure link Private Reply', () => {
  it('exact comment → creates a link and sends ONE Private Reply TEXT', async () => {
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => RESOLVED,
      upsert_capture_share_link: () => ({
        id: 'L1',
        private_reply_status: 'pending',
        token_ciphertext: CT(),
      }),
      claim_share_link_send: () => 'claimed',
      finalize_share_link_send: () => null,
    });
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King Gonzales',
      value: '1.5',
      screenshotPath: 'p.jpg',
    });
    expect(r).toMatchObject({ ok: true, code: 'sent' });
    expect(vi.mocked(pancake.sendPancakePrivateReply)).toHaveBeenCalledTimes(1);
    // TEXT only — no contentId (no Private Reply PHOTO).
    expect(vi.mocked(pancake.sendPancakePrivateReply).mock.calls[0]![0]).not.toHaveProperty(
      'contentId',
    );
  });

  it('concurrency: a worker that LOSES the claim does not send', async () => {
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => RESOLVED,
      upsert_capture_share_link: () => ({
        id: 'L1',
        private_reply_status: 'pending',
        token_ciphertext: CT(),
      }),
      claim_share_link_send: () => 'in_progress',
    });
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '1.5',
      screenshotPath: 'p.jpg',
    });
    expect(r).toMatchObject({ ok: false, code: 'in_progress' });
    expect(vi.mocked(pancake.sendPancakePrivateReply)).not.toHaveBeenCalled();
  });

  it('already sent → same link reused, NO second reply', async () => {
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({
        found: true,
        id: 'L1',
        private_reply_status: 'sent',
        token_ciphertext: CT(),
        page_id: 'PAGE',
        post_id: 'POST',
        comment_id: 'C1',
        facebook_psid: 'PSID',
        conversation_id: 'PAGE_PSID',
      }),
    });
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '1.5',
      screenshotPath: 'p.jpg',
    });
    expect(r.ok).toBe(true);
    expect(r.code).toBe('already_sent');
    if (r.ok) expect(r.url).toMatch(/\/m\//);
    expect(vi.mocked(pancake.sendPancakePrivateReply)).not.toHaveBeenCalled();
  });

  it('no exact comment → Needs Review, no send', async () => {
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => ({ resolved: false, reason: 'ambiguous_identity', matchCount: 2 }),
    });
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '1.5',
      screenshotPath: 'p.jpg',
    });
    expect(r).toMatchObject({ ok: false, code: 'no_exact_comment' });
    expect(vi.mocked(pancake.sendPancakePrivateReply)).not.toHaveBeenCalled();
  });

  it('outside the 7-day window → no doomed send', async () => {
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => ({
        ...RESOLVED,
        event_timestamp: new Date(Date.now() - 8 * 86400_000).toISOString(),
      }),
    });
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '1.5',
      screenshotPath: 'p.jpg',
    });
    expect(r).toMatchObject({ ok: false, code: 'outside_window' });
    expect(vi.mocked(pancake.sendPancakePrivateReply)).not.toHaveBeenCalled();
  });

  it('no screenshot → no send', async () => {
    const { supabase } = mockSupabase({});
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '1.5',
      screenshotPath: null,
    });
    expect(r.ok).toBe(false);
    expect(vi.mocked(pancake.sendPancakePrivateReply)).not.toHaveBeenCalled();
  });
});
