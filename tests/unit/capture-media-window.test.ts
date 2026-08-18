import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isConversationMediaEligible,
  isGenuineInboxDmEvent,
  psidFromConversationId,
} from '@/lib/capture/media-window';

const PSID = '27782810028035237';
const PAGE = '588622885161430';
const CONV = `${PAGE}_${PSID}`;

describe('psidFromConversationId', () => {
  it('extracts the PSID after the first underscore of {page_id}_{psid}', () => {
    expect(psidFromConversationId(CONV)).toBe(PSID);
  });
  it('returns null for a shape with no underscore or an empty psid', () => {
    expect(psidFromConversationId('nounderscore')).toBeNull();
    expect(psidFromConversationId(`${PAGE}_`)).toBeNull();
    expect(psidFromConversationId('')).toBeNull();
    expect(psidFromConversationId(null)).toBeNull();
  });
});

// ---- Raw webhook payload builders (STRUCTURE only — no PII, no message text of real people) ----
/** Genuine customer → Page Inbox DM (text). */
const dmText = (psid = PSID) => ({
  data: { message: { mid: 'm_hi', from: { id: psid }, text: 'Hi' } },
});
/** Genuine customer Inbox DM that is photo-only (no text) — still a real DM. */
const dmPhotoOnly = (psid = PSID) => ({
  data: { message: { mid: 'm_ph', from: { id: psid }, attachments: [{ type: 'image' }] } },
});
/** A Facebook LIVE comment (post-linked) that ALSO carries a message block — the Bavelyn shape
 *  (data keys: post, message, conversation; from = customer; attachment; no text). */
const liveComment = (psid = PSID) => ({
  data: {
    post: { id: `${PAGE}_1561919158756882` },
    message: { from: { id: psid }, attachments: [{ type: 'image' }] },
    conversation: { id: `${psid}_x` },
  },
});
/** A comment reply whose comment id lives ON the message object. */
const commentReplyOnMessage = (psid = PSID) => ({
  data: { message: { from: { id: psid }, comment_id: 'cmt_1', text: 'nice' } },
});
/** A reaction / post activity — no message block at all. */
const reaction = () => ({ data: { reaction: { type: 'like' }, post: { id: 'p_1' } } });
/** A Page echo (an outbound Page message mirrored back into the stream). */
const pageEcho = () => ({
  data: { message: { mid: 'm_e', is_echo: true, from: { id: PAGE }, text: 'reply' } },
});
/** A Page-originated Inbox message (from = Page, not the customer). */
const pageMessage = () => ({
  data: { message: { mid: 'm_p', from: { id: PAGE }, text: 'hello' } },
});
/** Ambiguous: from the customer but with NO id/text/attachments payload. */
const ambiguousEmpty = (psid = PSID) => ({ data: { message: { from: { id: psid } } } });
/** Ambiguous: a message with no `from` at all. */
const ambiguousNoFrom = () => ({ data: { message: { text: 'Hi' } } });
/** A `data.comment` payload variant (comment-originated). */
const dataComment = (psid = PSID) => ({
  data: { comment: { id: 'c1' }, message: { from: { id: psid }, text: 'x' } },
});

describe('isGenuineInboxDmEvent (pure structure gate)', () => {
  it('TRUE for a genuine customer Inbox text DM (case 5)', () => {
    expect(isGenuineInboxDmEvent(dmText(), PSID)).toBe(true);
  });
  it('TRUE for a genuine customer Inbox photo-only DM', () => {
    expect(isGenuineInboxDmEvent(dmPhotoOnly(), PSID)).toBe(true);
  });
  it('FALSE for a Facebook Live comment carrying a message block (case 1)', () => {
    expect(isGenuineInboxDmEvent(liveComment(), PSID)).toBe(false);
  });
  it('FALSE for a comment reply whose comment_id is on the message (case 1)', () => {
    expect(isGenuineInboxDmEvent(commentReplyOnMessage(), PSID)).toBe(false);
  });
  it('FALSE for reaction / post activity with no message (case 3)', () => {
    expect(isGenuineInboxDmEvent(reaction(), PSID)).toBe(false);
  });
  it('FALSE for a Page echo (case 6)', () => {
    expect(isGenuineInboxDmEvent(pageEcho(), PSID)).toBe(false);
  });
  it('FALSE for a Page-originated message — from = page (case 6)', () => {
    expect(isGenuineInboxDmEvent(pageMessage(), PSID)).toBe(false);
  });
  it('FALSE for ambiguous / malformed shapes (case 9)', () => {
    expect(isGenuineInboxDmEvent(ambiguousEmpty(), PSID)).toBe(false);
    expect(isGenuineInboxDmEvent(ambiguousNoFrom(), PSID)).toBe(false);
    expect(isGenuineInboxDmEvent({}, PSID)).toBe(false);
    expect(isGenuineInboxDmEvent(null, PSID)).toBe(false);
  });
  it('FALSE for a data.comment payload', () => {
    expect(isGenuineInboxDmEvent(dataComment(), PSID)).toBe(false);
  });
  it('FALSE when the psid is empty (fail-safe)', () => {
    expect(isGenuineInboxDmEvent(dmText(), '')).toBe(false);
  });
});

// ---- Windowed eligibility over the webhook store ----------------------------------------------
const recentIso = () => new Date(Date.now() - 60_000).toISOString(); // 1 min ago (in window)
const oldIso = () => new Date(Date.now() - 48 * 3600_000).toISOString(); // 48h ago (outside 24h)

/** Minimal chainable Supabase mock whose terminal `.limit()` resolves to `{ data }`. */
function supabaseReturning(events: Array<Record<string, unknown>>): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    gt: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: events, error: null }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}
/** Wrap a raw payload as a stored webhook row. */
const ev = (raw: unknown, ts: string = recentIso()) => ({ raw, event_timestamp: ts });

describe('isConversationMediaEligible — genuine-Inbox-DM gate', () => {
  it('TRUE: genuine customer Inbox "Hi" inside the window (cases 5 & 8)', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([ev(dmText())]), CONV, {
      windowHours: 24,
    });
    expect(ok).toBe(true);
  });

  it('TRUE: a genuine DM inside window even amid Live-comment noise (case 8)', async () => {
    const ok = await isConversationMediaEligible(
      supabaseReturning([ev(liveComment()), ev(dmText()), ev(reaction())]),
      CONV,
      { windowHours: 24 },
    );
    expect(ok).toBe(true);
  });

  it('FALSE: genuine customer Inbox DM but OUTSIDE the window (case 7)', async () => {
    const ok = await isConversationMediaEligible(
      supabaseReturning([ev(dmText(), oldIso())]),
      CONV,
      { windowHours: 24 },
    );
    expect(ok).toBe(false);
  });

  it('FALSE: a single Live comment only (case 1)', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([ev(liveComment())]), CONV);
    expect(ok).toBe(false);
  });

  it('FALSE: multiple Live comments (case 2)', async () => {
    const ok = await isConversationMediaEligible(
      supabaseReturning([ev(liveComment()), ev(liveComment()), ev(liveComment())]),
      CONV,
    );
    expect(ok).toBe(false);
  });

  it('FALSE: reaction / post-linked activity (case 3)', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([ev(reaction())]), CONV);
    expect(ok).toBe(false);
  });

  it('FALSE: a private-reply-created conversation with NO customer DM (case 4)', async () => {
    // Only comment + page-echo events exist — never a genuine customer Inbox DM.
    const ok = await isConversationMediaEligible(
      supabaseReturning([ev(liveComment()), ev(pageEcho())]),
      CONV,
    );
    expect(ok).toBe(false);
  });

  it('FALSE: a Page-originated Inbox message only (case 6)', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([ev(pageMessage())]), CONV);
    expect(ok).toBe(false);
  });

  it('FALSE: ambiguous event structures (case 9)', async () => {
    const ok = await isConversationMediaEligible(
      supabaseReturning([ev(ambiguousEmpty()), ev({}), ev(ambiguousNoFrom())]),
      CONV,
    );
    expect(ok).toBe(false);
  });

  it('FALSE: Bavelyn-like 11 comment/post-linked events + zero DMs (case 10)', async () => {
    const events = Array.from({ length: 11 }, () => ev(liveComment()));
    const ok = await isConversationMediaEligible(supabaseReturning(events), CONV);
    expect(ok).toBe(false);
  });

  it('FALSE: no events at all for the PSID', async () => {
    expect(await isConversationMediaEligible(supabaseReturning([]), CONV)).toBe(false);
  });

  it('FALSE (fail-safe): the conversation id has no extractable PSID', async () => {
    expect(await isConversationMediaEligible(supabaseReturning([ev(dmText())]), 'bad-id')).toBe(
      false,
    );
  });
});
