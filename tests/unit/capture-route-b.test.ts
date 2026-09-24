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
function mockSupabase(handlers: Handlers, pricePerGram = '7100') {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) =>
    Promise.resolve({ data: handlers[name] ? handlers[name](args) : null, error: null }),
  );
  // The mode-aware AUTO TEXT reads the shared sticker rate for GRAMS captures.
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: { price_per_gram: pricePerGram }, error: null }),
      }),
    }),
  }));
  return { supabase: { rpc, from } as unknown as SupabaseClient, rpc };
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

  it('existing FAILED link → terminal reply_failed (never retries / re-sends the same comment)', async () => {
    // Owner 2026-08-24: a Private Reply that Pancake did not accept is terminal for that comment
    // (one reply per comment). Route B must surface a FINITE reply_failed, not loop the capture in
    // "sending…" against the dead link.
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({
        found: true,
        id: 'L1',
        private_reply_status: 'failed',
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
    expect(r).toMatchObject({ ok: false, code: 'reply_failed' });
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

  it('no encryption key → still sends the LINK-FREE AUTO TEXT (secure /m link decoupled)', async () => {
    // Owner 2026-08-24: the AUTO TEXT carries business details, no /m link — a missing
    // CAPTURE_LINK_ENC_KEY (null token ciphertext) must NOT block delivery. Idempotency (the
    // share-link row) is still created; only the optional /m token is absent.
    const prev = process.env.CAPTURE_LINK_ENC_KEY;
    delete process.env.CAPTURE_LINK_ENC_KEY;
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => RESOLVED,
      upsert_capture_share_link: () => ({
        id: 'L1',
        private_reply_status: 'pending',
        token_ciphertext: null,
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
    process.env.CAPTURE_LINK_ENC_KEY = prev;
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

/**
 * Owner 2026-08-28 — value-only canonical safety net. On the PSID-exact single match, an exact comment
 * that proves a LEADING decimal Android OCR dropped ("mine .33" read as "33") canonicalizes grams to
 * "0.33"; the AUTO TEXT then computes from 0.33. Whole numbers, mismatches, and the name-fallback path
 * NEVER canonicalize. Raw OCR is preserved.
 */
describe('Route B — value-only canonical safety net (leading-decimal)', () => {
  function harness(commentText: string | null, extra: Handlers = {}) {
    const setCanon = vi.fn();
    const commentRead = vi.fn();
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => RESOLVED,
      resolve_capture_comment_text: () => {
        commentRead();
        return commentText;
      },
      set_capture_canonical_grams: (a) => {
        setCanon(a);
        return true;
      },
      upsert_capture_share_link: () => ({
        id: 'L1',
        private_reply_status: 'pending',
        token_ciphertext: CT(),
      }),
      claim_share_link_send: () => 'claimed',
      finalize_share_link_send: () => null,
      ...extra,
    });
    return { supabase, setCanon, commentRead };
  }
  const sentMessage = () =>
    (vi.mocked(pancake.sendPancakePrivateReply).mock.calls[0]![0] as { message: string }).message;

  it('OCR "33" + exact comment ".33" (PSID match) → persists 0.33 AND AUTO TEXT uses 0.33', async () => {
    const { supabase, setCanon } = harness('<div>mine .33</div>');
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '33',
      screenshotPath: 'p.jpg',
      psid: 'PSID',
    });
    expect(r).toMatchObject({ ok: true, code: 'sent' });
    expect(setCanon).toHaveBeenCalledWith(
      expect.objectContaining({ p_grams: '0.33', p_source: 'pancake_exact_comment', p_comment_id: 'C1' }),
    );
    // AUTO TEXT rendered the corrected grams, not the raw "33".
    expect(sentMessage()).toContain('0.33');
    expect(sentMessage()).not.toContain('234,300'); // 33 × 7100 would be ₱234,300
  });

  it('OCR "33" + comment "mine 33" (real whole grams) → NO canonicalization', async () => {
    const { supabase, setCanon } = harness('<div>mine 33</div>');
    await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '33',
      screenshotPath: 'p.jpg',
      psid: 'PSID',
    });
    expect(setCanon).not.toHaveBeenCalled();
    expect(sentMessage()).toContain('33'); // raw grams preserved
  });

  it('OCR "33" + comment ".44" (mismatch) → NO canonicalization (fails safe)', async () => {
    const { supabase, setCanon } = harness('<div>mine .44</div>');
    await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '33',
      screenshotPath: 'p.jpg',
      psid: 'PSID',
    });
    expect(setCanon).not.toHaveBeenCalled();
  });

  it('NO PSID (name-fallback path) → canonicalization MUST NOT run at all', async () => {
    const { supabase, setCanon, commentRead } = harness('<div>mine .33</div>');
    // No `psid` in the input → the gate excludes the name-fallback from canonicalization.
    await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '33',
      screenshotPath: 'p.jpg',
    });
    expect(commentRead).not.toHaveBeenCalled();
    expect(setCanon).not.toHaveBeenCalled();
  });

  it('ambiguous resolution (matchCount > 1, resolved:false) → no canonicalization, no send', async () => {
    const setCanon = vi.fn();
    const { supabase } = mockSupabase({
      find_capture_share_link_for_capture: () => ({ found: false }),
      resolve_exact_live_comment: () => ({ resolved: false, reason: 'ambiguous_identity', matchCount: 2 }),
      set_capture_canonical_grams: (a) => {
        setCanon(a);
        return true;
      },
    });
    const r = await attemptSecureLinkPrivateReply({
      supabase,
      captureRecordId: 'cap1',
      fbName: 'King',
      value: '33',
      screenshotPath: 'p.jpg',
      psid: 'PSID',
    });
    expect(r).toMatchObject({ ok: false, code: 'no_exact_comment' });
    expect(setCanon).not.toHaveBeenCalled();
  });
});
