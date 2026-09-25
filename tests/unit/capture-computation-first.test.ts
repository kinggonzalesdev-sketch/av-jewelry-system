import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reactivatePhotoForConversationSystem,
  resumeTextForConversationSystem,
  routePendingCapturesSystem,
  runWaitingTextReplyFallbackSystem,
} from '@/lib/capture/auto-router';
import * as mediaWindow from '@/lib/capture/media-window';
import * as routeB from '@/lib/capture/route-b';
import * as pancake from '@/lib/integrations/pancake';

/**
 * COMPUTATION FIRST (Owner 2026-09-25) — end to end through the real router, against an in-memory
 * copy of the database state machine of migration 20260925120000 (text claim with the
 * computation_first branch, the screenshot leg claim / finalize / park, the hard gate in the shared
 * photo claim, the due / waiting lists). The SQL itself is dry-run separately in the live database.
 */

type Cap = {
  id: string;
  ocr: Record<string, unknown>;
  screenshot_path: string | null;
  pancake_conversation_id: string | null;
  message_status: string | null;
  canonical_grams: string | null;
  source: string;
  is_test: boolean;
  official_order_id: string | null;
  confirmed: unknown;
  created_at: string;
  captured_at: string;
  message_sequence: string | null;
  text_send_status: string | null;
  text_attempts: number;
  text_max_attempts: number | null;
  text_next_at: number | null;
  text_claimed_at: number | null;
  text_waiting_since: string | null;
  private_reply_kind: string | null;
  send_claimed_at: number | null;
  photo_send_status: string | null;
  photo_attempts: number;
  photo_max_attempts: number | null;
  photo_next_at: number | null;
  photo_waiting_since: string | null;
  route_reason: string | null;
};

let db: Map<string, Cap>;
let queue: string[];
let settingsRow: Record<string, unknown> | null;
/** capture ids whose comment Private Reply is recorded 'sent' in capture_share_links */
let shareLinkSent: Set<string>;
/** conversations with an open Messenger window (a genuine inbox message) */
let openChats: Set<string>;
/** conversation → time of the customer's latest genuine inbox message */
let replyAt: Map<string, number>;
const sends: Array<{ conv: string; kind: 'photo' | 'text'; message: string }> = [];

const NOW = () => Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const SEQ = new Set(['screenshot_first', 'computation_first']);

function newCap(id: string, over: Partial<Cap> = {}): Cap {
  return {
    id,
    ocr: { fbName: 'King Gonzales', itemQuery: '0.55' },
    screenshot_path: `${id}.jpg`,
    pancake_conversation_id: `PAGE_${id}psid`,
    message_status: 'pending',
    canonical_grams: null,
    source: 'floating',
    is_test: false,
    official_order_id: null,
    confirmed: null,
    created_at: iso(NOW()),
    captured_at: iso(NOW()),
    message_sequence: null,
    text_send_status: null,
    text_attempts: 0,
    text_max_attempts: null,
    text_next_at: null,
    text_claimed_at: null,
    text_waiting_since: null,
    private_reply_kind: null,
    send_claimed_at: null,
    photo_send_status: null,
    photo_attempts: 0,
    photo_max_attempts: null,
    photo_next_at: null,
    photo_waiting_since: null,
    route_reason: null,
    ...over,
  };
}

const clamp = (n: unknown) => Math.max(1, Math.min(3, typeof n === 'number' ? n : 3));
const textSent = (c: Cap) =>
  c.text_send_status === 'sent' ||
  ((c.private_reply_kind ?? 'computation') === 'computation' && shareLinkSent.has(c.id));

/* ---- The database functions of migration 20260925120000, mirrored ------------------------- */
function claimText(c: Cap, trigger: string): string {
  if (!c.message_sequence || !SEQ.has(c.message_sequence)) return 'not_applicable';
  const status = c.text_send_status ?? 'pending';
  if (status === 'sent') return 'already_sent';
  if (
    (c.private_reply_kind ?? 'computation') === 'computation' &&
    shareLinkSent.has(c.id)
  ) {
    c.text_send_status = 'sent';
    return 'already_sent';
  }
  if (c.message_sequence === 'screenshot_first' && c.message_status !== 'sent')
    return 'not_ready';
  if (status === 'failed' || status === 'unconfirmed') return status;
  if (status === 'sending') {
    if (c.text_claimed_at !== null && c.text_claimed_at > NOW() - 120_000)
      return 'in_progress';
    c.text_send_status = 'unconfirmed';
    c.text_claimed_at = null;
    return 'unconfirmed';
  }
  if (status === 'waiting_reply' && trigger !== 'reply') return 'waiting_reply';
  if (status === 'pending' && trigger === 'auto') {
    if (c.text_next_at !== null && c.text_next_at > NOW()) return 'not_due';
    if (c.text_attempts >= (c.text_max_attempts ?? 3)) {
      c.text_send_status = 'waiting_reply';
      c.text_waiting_since = iso(NOW());
      return 'waiting_reply';
    }
  }
  c.text_send_status = 'sending';
  c.text_claimed_at = NOW();
  c.text_attempts += 1;
  return 'claimed';
}

function finalizeText(c: Cap, outcome: string, retryAfter: number | null): string {
  if (c.text_send_status !== 'sending') return 'not_claimed';
  const next =
    outcome === 'retry'
      ? c.text_attempts < (c.text_max_attempts ?? 3)
        ? 'pending'
        : 'waiting_reply'
      : outcome;
  c.text_send_status = next;
  c.text_claimed_at = null;
  c.text_next_at =
    next === 'pending' ? NOW() + Math.max(0, retryAfter ?? 0) * 1000 : null;
  c.text_waiting_since = next === 'waiting_reply' ? iso(NOW()) : null;
  return next;
}

function claimPhotoLeg(c: Cap, conv: string, trigger: string): string {
  if (c.message_sequence !== 'computation_first') return 'not_applicable';
  if (c.message_status === 'sent') {
    c.photo_send_status = 'sent';
    return 'already_sent';
  }
  if (!textSent(c)) return 'text_not_sent';
  c.text_send_status = 'sent';
  if (c.message_status === 'sending') {
    if (c.send_claimed_at !== null && c.send_claimed_at > NOW() - 120_000)
      return 'in_progress';
    c.photo_send_status = 'unconfirmed';
    c.message_status = 'failed';
    c.send_claimed_at = null;
    return 'unconfirmed';
  }
  const status = c.photo_send_status ?? 'pending';
  if (status === 'failed' || status === 'unconfirmed') return status;
  if (status === 'sending') {
    c.photo_send_status = 'unconfirmed';
    c.message_status = 'failed';
    return 'unconfirmed';
  }
  if (status === 'waiting_reply' && trigger !== 'reply') return 'waiting_reply';
  if (status === 'pending' && trigger === 'auto') {
    if (c.photo_next_at !== null && c.photo_next_at > NOW()) return 'not_due';
    if (c.photo_attempts >= (c.photo_max_attempts ?? 3)) {
      c.photo_send_status = 'waiting_reply';
      c.photo_waiting_since = iso(NOW());
      c.message_status = 'link_sent';
      return 'waiting_reply';
    }
  }
  c.message_status = 'sending';
  c.send_claimed_at = NOW();
  c.pancake_conversation_id = c.pancake_conversation_id || conv;
  c.photo_send_status = 'sending';
  c.photo_attempts += 1;
  c.photo_next_at = null;
  return 'claimed';
}

function finalizePhotoLeg(c: Cap, outcome: string, retryAfter: number | null): string {
  if (c.photo_send_status !== 'sending' || c.message_status !== 'sending')
    return 'not_claimed';
  const next =
    outcome === 'retry'
      ? c.photo_attempts < (c.photo_max_attempts ?? 3)
        ? 'pending'
        : 'waiting_reply'
      : outcome;
  c.photo_send_status = next;
  c.message_status =
    next === 'sent'
      ? 'sent'
      : next === 'pending'
        ? 'pending'
        : next === 'waiting_reply'
          ? 'link_sent'
          : 'failed';
  c.send_claimed_at = null;
  c.photo_next_at =
    next === 'pending' ? NOW() + Math.max(0, retryAfter ?? 0) * 1000 : null;
  c.photo_waiting_since = next === 'waiting_reply' ? iso(NOW()) : null;
  return next;
}

function rpc(name: string, a: Record<string, unknown>): unknown {
  const id = a.p_capture_id as string;
  const c = id ? db.get(id) : undefined;
  switch (name) {
    case 'has_capture_routing_work':
      return true;
    case 'claim_captures_to_route': {
      const out = queue.map((q) => db.get(q)).filter(Boolean);
      queue = [];
      return out;
    }
    case 'mark_captures_route_exhausted':
      return 0;
    case 'set_capture_route_reason':
      if (c) c.route_reason = a.p_reason as string;
      return null;
    case 'start_capture_message_sequence':
      if (!c) return null;
      if (c.message_sequence === null) {
        c.message_sequence = a.p_mode as string;
        c.text_max_attempts =
          a.p_mode === 'screenshot_first'
            ? clamp(a.p_max_attempts)
            : a.p_mode === 'computation_first'
              ? 3
              : null;
        c.photo_max_attempts =
          a.p_mode === 'computation_first' ? clamp(a.p_max_attempts) : null;
      }
      if (
        SEQ.has(c.message_sequence ?? '') &&
        c.text_send_status === null &&
        shareLinkSent.has(id)
      ) {
        c.text_send_status = 'sent';
      }
      return c.message_sequence;
    case 'set_capture_sequence_conversation':
      if (c && (a.p_conversation_id as string))
        c.pancake_conversation_id = a.p_conversation_id as string;
      return c?.pancake_conversation_id ?? null;
    case 'claim_capture_text_send':
      return c ? claimText(c, a.p_trigger as string) : 'not_found';
    case 'finalize_capture_text_send':
      return c
        ? finalizeText(
            c,
            a.p_outcome as string,
            (a.p_retry_after_seconds as number | null) ?? null,
          )
        : 'not_found';
    case 'claim_capture_photo_leg':
      return c
        ? claimPhotoLeg(c, a.p_conversation_id as string, a.p_trigger as string)
        : 'not_found';
    case 'finalize_capture_photo_leg':
      return c
        ? finalizePhotoLeg(
            c,
            a.p_outcome as string,
            (a.p_retry_after_seconds as number | null) ?? null,
          )
        : 'not_found';
    case 'park_capture_photo_leg':
      if (
        c &&
        c.message_sequence === 'computation_first' &&
        c.text_send_status === 'sent' &&
        !['sent', 'sending'].includes(c.message_status ?? '') &&
        [null, 'pending', 'waiting_reply'].includes(c.photo_send_status)
      ) {
        c.photo_waiting_since =
          c.photo_send_status === 'waiting_reply'
            ? (c.photo_waiting_since ?? iso(NOW()))
            : iso(NOW());
        c.photo_send_status = 'waiting_reply';
        c.photo_next_at = null;
        c.message_status = 'link_sent';
      }
      return c?.photo_send_status ?? null;
    case 'claim_capture_photo_send':
      if (!c) return 'not_found';
      // HARD GATE: Computation First sends nothing before the computation.
      if (
        c.message_sequence === 'computation_first' &&
        c.message_status !== 'sent' &&
        !textSent(c)
      ) {
        return 'computation_first';
      }
      if (c.message_status === 'sent') return 'already_sent';
      if (c.message_status === 'sending') return 'in_progress';
      c.message_status = 'sending';
      return 'claimed';
    case 'finalize_capture_photo_send':
      if (c && c.message_status === 'sending')
        c.message_status = a.p_ok ? 'sent' : 'failed';
      return c?.message_status ?? null;
    case 'mark_capture_photo_state':
      if (c && !['sent', 'sending', 'link_sent'].includes(c.message_status ?? '')) {
        c.message_status = a.p_status as string;
      }
      return a.p_status;
    case 'mark_capture_text_sent_by_private_reply':
      if (c && SEQ.has(c.message_sequence ?? '') && c.text_send_status !== 'sent') {
        c.text_send_status = 'sent';
        shareLinkSent.add(c.id);
      }
      return c?.text_send_status ?? null;
    case 'list_due_capture_text_legs':
      return [...db.values()]
        .filter(
          (x) =>
            x.message_sequence === 'computation_first' &&
            ((x.text_send_status === 'pending' &&
              (x.text_next_at === null || x.text_next_at <= NOW())) ||
              (x.text_send_status === 'sending' &&
                (x.text_claimed_at ?? 0) < NOW() - 120_000)),
        )
        .map((x) => x.id);
    case 'list_due_capture_photo_legs':
      return [...db.values()]
        .filter(
          (x) =>
            x.message_sequence === 'computation_first' &&
            x.text_send_status === 'sent' &&
            x.message_status !== 'sent' &&
            (x.photo_send_status === null ||
              (x.photo_send_status === 'pending' &&
                (x.photo_next_at === null || x.photo_next_at <= NOW())) ||
              (x.photo_send_status === 'sending' &&
                (x.send_claimed_at ?? 0) < NOW() - 120_000)),
        )
        .map((x) => x.id);
    case 'list_waiting_capture_texts':
      return [...db.values()]
        .filter(
          (x) =>
            SEQ.has(x.message_sequence ?? '') && x.text_send_status === 'waiting_reply',
        )
        .map((x) => ({
          id: x.id,
          pancake_conversation_id: x.pancake_conversation_id,
          text_waiting_since: x.text_waiting_since,
        }));
    case 'list_waiting_capture_photos':
      return [...db.values()]
        .filter(
          (x) =>
            x.message_sequence === 'computation_first' &&
            x.photo_send_status === 'waiting_reply' &&
            x.message_status !== 'sent',
        )
        .map((x) => ({
          id: x.id,
          pancake_conversation_id: x.pancake_conversation_id,
          photo_waiting_since: x.photo_waiting_since,
        }));
    case 'reset_capture_for_retry':
      if (!c || !['failed', 'awaiting_inbox', 'pending'].includes(c.message_status ?? ''))
        return 'not_retryable';
      c.message_status = 'awaiting_inbox';
      if (
        c.message_sequence === 'computation_first' &&
        ['failed', 'unconfirmed'].includes(c.photo_send_status ?? '')
      ) {
        c.photo_send_status = null;
        c.photo_attempts = 0;
        c.photo_next_at = null;
        c.photo_waiting_since = null;
      }
      return 'reset';
    default:
      return null;
  }
}

/* ---- A tiny query builder over the in-memory rows ----------------------------------------- */
function queryBuilder(table: string) {
  const filters: Array<(c: Cap) => boolean> = [];
  let limitN = 1000;
  const run = (): Cap[] =>
    [...db.values()].filter((c) => filters.every((f) => f(c))).slice(0, limitN);
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: keyof Cap, val: unknown) => (filters.push((c) => c[col] === val), b),
    is: (col: keyof Cap, val: unknown) => (
      filters.push((c) => (c[col] ?? null) === val),
      b
    ),
    not: (col: keyof Cap) => (filters.push((c) => (c[col] ?? null) !== null), b),
    in: (col: keyof Cap, vals: unknown[]) => (
      filters.push((c) => vals.includes(c[col])),
      b
    ),
    like: (col: keyof Cap, pattern: string) => {
      const suffix = pattern.replace(/^%/, '');
      filters.push((c) => {
        const v = c[col];
        return typeof v === 'string' && v.endsWith(suffix);
      });
      return b;
    },
    gt: () => b,
    order: () => b,
    limit: (n: number) => {
      limitN = n;
      return Promise.resolve({ data: run(), error: null });
    },
    maybeSingle: () => {
      if (table === 'pancake_integration_config')
        return Promise.resolve({ data: settingsRow, error: null });
      return Promise.resolve({ data: run()[0] ?? null, error: null });
    },
  };
  return b;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) =>
      Promise.resolve({ data: rpc(name, args ?? {}), error: null }),
    from: (table: string) => queryBuilder(table),
    storage: {
      from: () => ({
        createSignedUrl: (p: string) =>
          Promise.resolve({ data: { signedUrl: `https://signed/${p}` } }),
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
  sendPancakeConversationMessage: vi.fn(),
  findConversationMessageByText: vi.fn(() => Promise.resolve('unknown')),
}));

vi.mock('@/lib/capture/media-window', async () => {
  const actual = await vi.importActual<typeof mediaWindow>('@/lib/capture/media-window');
  return {
    ...actual,
    isConversationMediaEligible: vi.fn(),
    genuineInboxDmSinceBatch: vi.fn(),
  };
});

const COMPUTATION = ['King', '0.55g × ₱7,700/g', 'Total: ₱4,235'].join(
  String.fromCharCode(10),
);

vi.mock('@/lib/capture/route-b', () => ({
  attemptSecureLinkPrivateReply: vi.fn(),
  buildAutoTextMessage: vi.fn(() => Promise.resolve(COMPUTATION)),
  buildAutoTextMessageDetailed: vi.fn(() =>
    Promise.resolve({ message: COMPUTATION, readError: false }),
  ),
}));

type SendResult = Awaited<ReturnType<typeof pancake.sendPancakeConversationMessage>>;
const OK: SendResult = { ok: true, code: 'sent', message: 'ok', pancakeMessageId: 'MID' };
const HTTP = (status: number, extra: Partial<SendResult> = {}): SendResult => ({
  ok: false,
  code: 'failed',
  message: 'rejected',
  pancakeMessageId: null,
  sendHttpStatus: status,
  ...extra,
});
const NEEDS_REPLY: SendResult = {
  ok: false,
  code: 'outside_window',
  message: 'x',
  pancakeMessageId: null,
  sendHttpStatus: 400,
};

/** Script results per request kind (and optionally per conversation); unscripted requests succeed. */
function scriptSends(
  script: {
    text?: SendResult[];
    photo?: SendResult[];
    photoByConv?: Record<string, SendResult[]>;
  } = {},
) {
  const texts = [...(script.text ?? [])];
  const photos = [...(script.photo ?? [])];
  const byConv = Object.fromEntries(
    Object.entries(script.photoByConv ?? {}).map(([k, v]) => [k, [...v]]),
  );
  vi.mocked(pancake.sendPancakeConversationMessage).mockImplementation((input) => {
    const kind = input.attachmentUrl ? 'photo' : 'text';
    sends.push({ conv: input.conversationId, kind, message: input.message });
    if (kind === 'photo') {
      // Separate requests: the image never travels with text.
      expect(input.message).toBe('');
      const own = byConv[input.conversationId];
      return Promise.resolve((own ? own.shift() : photos.shift()) ?? OK);
    }
    expect(input.attachmentUrl ?? null).toBeNull();
    return Promise.resolve(texts.shift() ?? OK);
  });
}

const count = (kind: 'photo' | 'text', conv?: string) =>
  sends.filter((s) => s.kind === kind && (!conv || s.conv === conv)).length;
const kinds = (conv?: string) =>
  sends.filter((s) => !conv || s.conv === conv).map((s) => s.kind);

async function settle<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}
/** One cron run: the same single 50s deadline the every-minute cron route passes. */
const sweep = () =>
  settle(routePendingCapturesSystem(15, { deadlineAt: Date.now() + 50_000 }));
/** The customer genuinely messages the page now (the webhook stores the event, then reacts). */
async function customerReplies(conv: string) {
  vi.advanceTimersByTime(1000);
  openChats.add(conv);
  replyAt.set(conv, Date.now());
  await settle(reactivatePhotoForConversationSystem(conv));
  await settle(resumeTextForConversationSystem(conv));
}

describe('Computation First sequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    db = new Map();
    queue = [];
    sends.length = 0;
    settingsRow = {
      private_reply_sequence: 'computation_first',
      text_send_attempts: 3,
      screenshot_send_attempts: 3,
    };
    shareLinkSent = new Set();
    openChats = new Set();
    replyAt = new Map();
    vi.mocked(mediaWindow.isConversationMediaEligible).mockImplementation(
      (_a, conv: string) => Promise.resolve(openChats.has(conv)),
    );
    vi.mocked(mediaWindow.genuineInboxDmSinceBatch).mockImplementation((_a, items) =>
      Promise.resolve(
        new Set(
          items
            .filter(
              (i) =>
                (replyAt.get(i.conversationId) ?? -Infinity) > Date.parse(i.sinceIso),
            )
            .map((i) => i.key),
        ),
      ),
    );
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockReset();
    vi.mocked(pancake.findConversationMessageByText).mockResolvedValue('unknown');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A capture whose customer has an open Messenger chat. */
  function openChatCapture(id: string, over: Partial<Cap> = {}) {
    const cap = newCap(id, over);
    db.set(id, cap);
    openChats.add(cap.pancake_conversation_id ?? '');
    queue.push(id);
    return cap;
  }

  it('TEST 1 — computation, then the screenshot on attempt 1: exactly 1 text + 1 screenshot, in that order', async () => {
    openChatCapture('A');
    scriptSends();
    await sweep();
    expect(kinds()).toEqual(['text', 'photo']);
    expect(sends[0]?.message).toBe(COMPUTATION);
    const a = db.get('A');
    expect(a?.message_sequence).toBe('computation_first');
    expect(a?.text_send_status).toBe('sent');
    expect(a?.message_status).toBe('sent');
    expect(a?.photo_send_status).toBe('sent');
    expect(a?.photo_attempts).toBe(1);
    expect(a?.route_reason).toBe('Computation sent ✓ · Screenshot sent ✓');
  });

  it('TEST 2 — screenshot attempt 1 fails transiently, attempt 2 succeeds: the computation stays ONE copy', async () => {
    openChatCapture('A');
    scriptSends({ photo: [HTTP(503), OK] });
    await sweep();
    expect(count('text')).toBe(1);
    expect(count('photo')).toBe(2);
    expect(kinds()).toEqual(['text', 'photo', 'photo']);
    expect(db.get('A')?.message_status).toBe('sent');
    expect(db.get('A')?.photo_attempts).toBe(2);
  });

  it('TEST 3 — screenshot succeeds on attempt 3 (after 503 and 429 + Retry-After): one text, one delivered screenshot', async () => {
    openChatCapture('A');
    scriptSends({ photo: [HTTP(503), HTTP(429, { retryAfterSeconds: 1 }), OK] });
    await sweep();
    expect(count('text')).toBe(1);
    expect(count('photo')).toBe(3);
    expect(db.get('A')?.message_status).toBe('sent');
    expect(db.get('A')?.photo_send_status).toBe('sent');
  });

  it('a temporary UPLOAD failure (nothing reached the customer) is retried like any transient failure', async () => {
    openChatCapture('A');
    scriptSends({
      photo: [
        {
          ok: false,
          code: 'unavailable',
          message: 'x',
          pancakeMessageId: null,
          stage: 'upload',
        },
        OK,
      ],
    });
    await sweep();
    expect(count('photo')).toBe(2);
    expect(db.get('A')?.message_status).toBe('sent');
  });

  it('TEST 4 — Facebook needs the customer to message first: remaining attempts are skipped, the capture waits', async () => {
    openChatCapture('A');
    scriptSends({ photo: [NEEDS_REPLY, OK, OK] });
    await sweep();
    expect(count('photo')).toBe(1);
    const a = db.get('A');
    expect(a?.photo_send_status).toBe('waiting_reply');
    expect(a?.message_status).toBe('link_sent');
    expect(a?.text_send_status).toBe('sent');
    expect(a?.route_reason).toBe(
      'Computation sent ✓ · Waiting for customer reply to send screenshot',
    );
  });

  it('a comment-only customer: the computation goes as the ONE Private Reply, the screenshot waits (no doomed request)', async () => {
    db.set('B', newCap('B'));
    queue.push('B');
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({
      ok: true,
      code: 'sent',
      url: null,
    });
    scriptSends();
    await sweep();
    expect(routeB.attemptSecureLinkPrivateReply).toHaveBeenCalledTimes(1);
    expect(sends).toHaveLength(0); // no Messenger text, no screenshot attempt into a closed chat
    const b = db.get('B');
    expect(b?.text_send_status).toBe('sent');
    expect(b?.photo_send_status).toBe('waiting_reply');
    expect(b?.message_status).toBe('link_sent');
    expect(b?.route_reason).toBe(
      'Computation sent ✓ · Waiting for customer reply to send screenshot',
    );

    // They message the page: the screenshot goes ONCE, the computation is never repeated.
    await customerReplies('PAGE_Bpsid');
    expect(count('photo', 'PAGE_Bpsid')).toBe(1);
    expect(count('text', 'PAGE_Bpsid')).toBe(0);
    expect(routeB.attemptSecureLinkPrivateReply).toHaveBeenCalledTimes(1);
    expect(db.get('B')?.message_status).toBe('sent');
  });

  it('a screenshot is never attempted into a closed chat: it waits for the customer without any request', async () => {
    db.set(
      'A',
      newCap('A', {
        message_sequence: 'computation_first',
        text_max_attempts: 3,
        photo_max_attempts: 3,
        text_send_status: 'sent', // the computation went; the screenshot is due
      }),
    );
    scriptSends();
    await sweep();
    expect(sends).toHaveLength(0);
    expect(db.get('A')?.photo_send_status).toBe('waiting_reply');
    expect(db.get('A')?.photo_attempts).toBe(0);
    expect(db.get('A')?.message_status).toBe('link_sent');
  });

  it('TEST 5 — all safe attempts fail: exactly 3 screenshot attempts (not 3 retries), then it waits for the customer', async () => {
    openChatCapture('A');
    scriptSends({ photo: [HTTP(503), HTTP(503), HTTP(503), OK] });
    await sweep();
    expect(count('photo')).toBe(3);
    expect(count('text')).toBe(1);
    expect(db.get('A')?.photo_send_status).toBe('waiting_reply');
    expect(db.get('A')?.message_status).toBe('link_sent');
  });

  it('honours Screenshot Send Attempts = 1: one try only', async () => {
    settingsRow = {
      private_reply_sequence: 'computation_first',
      text_send_attempts: 3,
      screenshot_send_attempts: 1,
    };
    openChatCapture('A');
    scriptSends({ photo: [HTTP(503), OK] });
    await sweep();
    expect(db.get('A')?.photo_max_attempts).toBe(1);
    expect(count('photo')).toBe(1);
    expect(db.get('A')?.photo_send_status).toBe('waiting_reply');
  });

  it('TEST 6 — the customer replies later: the screenshot is sent exactly once', async () => {
    openChatCapture('A');
    scriptSends({ photo: [HTTP(503), HTTP(503), HTTP(503)] });
    await sweep();
    expect(db.get('A')?.photo_send_status).toBe('waiting_reply');

    await customerReplies('PAGE_Apsid');
    expect(count('photo')).toBe(4); // 3 failed attempts + 1 after the reply
    expect(db.get('A')?.message_status).toBe('sent');

    // The same reply seen again (webhook replay, cron fallback, reconnect): nothing more.
    await settle(reactivatePhotoForConversationSystem('PAGE_Apsid'));
    await settle(runWaitingTextReplyFallbackSystem({ deadlineAt: Date.now() + 50_000 }));
    await sweep();
    expect(count('photo')).toBe(4);
    expect(count('text')).toBe(1);
  });

  it('a reply OLDER than the wait never unlocks the screenshot (only a genuine new reply does)', async () => {
    replyAt.set('PAGE_Apsid', Date.now() - 60_000); // the message that opened the chat earlier
    openChatCapture('A');
    scriptSends({ photo: [NEEDS_REPLY] });
    await sweep();
    expect(db.get('A')?.photo_send_status).toBe('waiting_reply');
    await settle(reactivatePhotoForConversationSystem('PAGE_Apsid'));
    await settle(runWaitingTextReplyFallbackSystem({ deadlineAt: Date.now() + 50_000 }));
    expect(count('photo')).toBe(1);
  });

  it('the missed-reply fallback (webhook lost) also sends the waiting screenshot exactly once', async () => {
    openChatCapture('A');
    scriptSends({ photo: [NEEDS_REPLY] });
    await sweep();
    vi.advanceTimersByTime(1000);
    replyAt.set('PAGE_Apsid', Date.now()); // the reply arrived, its webhook reaction did not run
    const r1 = await settle(
      runWaitingTextReplyFallbackSystem({ deadlineAt: Date.now() + 50_000 }),
    );
    const r2 = await settle(
      runWaitingTextReplyFallbackSystem({ deadlineAt: Date.now() + 50_000 }),
    );
    expect(r1.sent).toBe(1);
    expect(r2.sent).toBe(0);
    expect(count('photo')).toBe(2);
    expect(db.get('A')?.message_status).toBe('sent');
  });

  it('TEST 7 — a reply after the screenshot already succeeded duplicates nothing', async () => {
    openChatCapture('A');
    scriptSends();
    await sweep();
    await customerReplies('PAGE_Apsid');
    await customerReplies('PAGE_Apsid');
    expect(count('text')).toBe(1);
    expect(count('photo')).toBe(1);
  });

  it('TEST 8 — refresh / webhook replay / realtime reconnect / server restart: no duplicate computation or screenshot', async () => {
    openChatCapture('A');
    scriptSends();
    await sweep();
    // The same capture offered again by every path, repeatedly.
    queue = ['A', 'A'];
    await sweep();
    await sweep();
    await settle(reactivatePhotoForConversationSystem('PAGE_Apsid'));
    await settle(resumeTextForConversationSystem('PAGE_Apsid'));
    await settle(runWaitingTextReplyFallbackSystem({ deadlineAt: Date.now() + 50_000 }));
    expect(count('text')).toBe(1);
    expect(count('photo')).toBe(1);
  });

  it('a worker lost mid-screenshot (server restart) becomes "unconfirmed" and is never re-sent automatically', async () => {
    db.set(
      'A',
      newCap('A', {
        message_sequence: 'computation_first',
        text_max_attempts: 3,
        photo_max_attempts: 3,
        text_send_status: 'sent',
        message_status: 'sending',
        send_claimed_at: Date.now() - 5 * 60_000,
        photo_send_status: 'sending',
        photo_attempts: 1,
      }),
    );
    openChats.add('PAGE_Apsid');
    scriptSends();
    await sweep();
    await sweep();
    expect(sends).toHaveLength(0);
    expect(db.get('A')?.photo_send_status).toBe('unconfirmed');
    expect(db.get('A')?.message_status).toBe('failed');
  });

  it('an ambiguous screenshot timeout is never blindly re-sent', async () => {
    openChatCapture('A');
    scriptSends({
      photo: [
        {
          ok: false,
          code: 'unavailable',
          message: 'x',
          pancakeMessageId: null,
          transport: 'timeout',
        },
      ],
    });
    await sweep();
    await sweep();
    expect(count('photo')).toBe(1);
    expect(db.get('A')?.photo_send_status).toBe('unconfirmed');
    expect(db.get('A')?.route_reason).toBe(
      'Computation sent ✓ · Screenshot may not have sent · check chat',
    );
  });

  it('only the operator’s explicit Retry gives a failed screenshot new attempts — the computation is never resent', async () => {
    openChatCapture('A');
    scriptSends({ photo: [HTTP(401)] }); // an auth failure is never retried automatically
    await sweep();
    expect(db.get('A')?.photo_send_status).toBe('failed');
    await sweep();
    expect(count('photo')).toBe(1);
    // Retry (reset_capture_for_retry), then the router routes it again.
    rpc('reset_capture_for_retry', { p_capture_id: 'A' });
    queue = ['A'];
    await sweep();
    expect(count('photo')).toBe(2);
    expect(count('text')).toBe(1);
    expect(db.get('A')?.message_status).toBe('sent');
  });

  it('TEXT ALWAYS FIRST: no screenshot while the computation is failed, unconfirmed or waiting', async () => {
    openChatCapture('A');
    openChatCapture('B');
    openChatCapture('C');
    scriptSends({
      text: [
        HTTP(401), // A: failed
        {
          ok: false,
          code: 'unavailable',
          message: 'x',
          pancakeMessageId: null,
          transport: 'timeout',
        }, // B: unconfirmed
        NEEDS_REPLY, // C: waiting for a reply
      ],
    });
    await sweep();
    await sweep();
    expect(count('photo')).toBe(0);
    expect(db.get('A')?.text_send_status).toBe('failed');
    expect(db.get('B')?.text_send_status).toBe('unconfirmed');
    expect(db.get('C')?.text_send_status).toBe('waiting_reply');
    // The shared photo claim (manual Send, any build) refuses too.
    expect(
      rpc('claim_capture_photo_send', {
        p_capture_id: 'C',
        p_conversation_id: 'PAGE_Cpsid',
      }),
    ).toBe('computation_first');
    // C's reply unlocks the computation, THEN the screenshot.
    await customerReplies('PAGE_Cpsid');
    expect(kinds('PAGE_Cpsid')).toEqual(['text', 'text', 'photo']);
    expect(db.get('C')?.message_status).toBe('sent');
  });

  it('a computation that started in Messenger is never repeated as a Private Reply', async () => {
    openChatCapture('A');
    scriptSends({ text: [NEEDS_REPLY] });
    await sweep();
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');
    // The chat closes; the capture is routed again as comment-only.
    openChats.delete('PAGE_Apsid');
    db.get('A')!.message_status = 'awaiting_inbox';
    queue = ['A'];
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({
      ok: true,
      code: 'sent',
      url: null,
    });
    await sweep();
    expect(routeB.attemptSecureLinkPrivateReply).not.toHaveBeenCalled();
    expect(count('text')).toBe(1);
  });

  it('TEST 9 — Screenshot First is unchanged: screenshot, then computation', async () => {
    settingsRow = {
      private_reply_sequence: 'screenshot_first',
      text_send_attempts: 3,
      screenshot_send_attempts: 3,
    };
    openChatCapture('S');
    scriptSends();
    await sweep();
    expect(kinds()).toEqual(['photo', 'text']);
    expect(db.get('S')?.message_sequence).toBe('screenshot_first');
    expect(db.get('S')?.photo_send_status).toBeNull();
    expect(db.get('S')?.route_reason).toBe('Screenshot sent ✓ · Computation sent ✓');
  });

  it('a capture keeps the sequence it started with when the Owner changes the setting', async () => {
    openChatCapture('A');
    scriptSends({ photo: [NEEDS_REPLY] });
    await sweep();
    settingsRow = {
      private_reply_sequence: 'screenshot_first',
      text_send_attempts: 3,
      screenshot_send_attempts: 3,
    };
    await customerReplies('PAGE_Apsid');
    expect(db.get('A')?.message_sequence).toBe('computation_first');
    expect(kinds('PAGE_Apsid')).toEqual(['text', 'photo', 'photo']);
  });

  it('TEST 10 — several captures at once keep independent states', async () => {
    openChatCapture('A');
    openChatCapture('B');
    openChatCapture('C');
    scriptSends({
      photoByConv: {
        PAGE_Apsid: [NEEDS_REPLY], // A: blocked → waits for the customer
        PAGE_Bpsid: [OK], // B: done
        PAGE_Cpsid: [HTTP(429, { retryAfterSeconds: 30 }), OK], // C: attempt 2 later
      },
    });
    await sweep();
    expect(db.get('A')?.route_reason).toBe(
      'Computation sent ✓ · Waiting for customer reply to send screenshot',
    );
    expect(db.get('B')?.route_reason).toBe('Computation sent ✓ · Screenshot sent ✓');
    const c = db.get('C');
    expect(c?.photo_send_status).toBe('pending');
    expect(c?.photo_attempts).toBe(1);
    expect(c?.route_reason).toBe('Computation sent ✓ · Sending screenshot...');
    expect(count('text')).toBe(3);

    // 30 seconds later the next sweep makes C's attempt 2; A still waits; B is untouched.
    vi.advanceTimersByTime(31_000);
    await sweep();
    expect(db.get('C')?.message_status).toBe('sent');
    expect(db.get('C')?.photo_attempts).toBe(2);
    expect(db.get('A')?.photo_send_status).toBe('waiting_reply');
    expect(count('photo', 'PAGE_Bpsid')).toBe(1);
    expect(count('text')).toBe(3);
  });
});
