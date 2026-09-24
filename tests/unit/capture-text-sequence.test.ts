import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  reactivatePhotoForConversationSystem,
  resumeTextForConversationSystem,
  routePendingCapturesSystem,
  runCaptureTextSequence,
  runWaitingTextReplyFallbackSystem,
} from '@/lib/capture/auto-router';
import * as mediaWindow from '@/lib/capture/media-window';
import * as routeB from '@/lib/capture/route-b';
import * as pancake from '@/lib/integrations/pancake';

/**
 * SCREENSHOT-FIRST SEQUENCE (Owner 2026-09-24) — the orchestration, end to end, against an
 * in-memory copy of the database state machine. The copy mirrors migration 20260924120000
 * (claim / finalize / set-once stamp / private-reply mark) and the live photo claim; the SQL
 * itself is proven separately in a throwaway PostgreSQL with the same scenarios.
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
  route_reason: string | null;
  private_reply_kind: string | null;
};

let db: Map<string, Cap>;
let settingsRow: { private_reply_sequence: string; text_send_attempts: number } | null;
let queue: string[];
/** capture ids whose Private Reply is recorded as sent in capture_share_links */
let shareLinkSent: Set<string>;
/** capture ids whose Private Reply is stuck 'sending' or 'failed' after contacting Pancake */
let shareLinkUncertain: Set<string>;
/** a read error to return for the settings row (null = read succeeds) */
let settingsError: unknown = null;
const sends: Array<{ conv: string; kind: 'photo' | 'text'; message: string }> = [];

const NOW = () => Date.now();

function newCap(id: string, over: Partial<Cap> = {}): Cap {
  const iso = new Date(NOW()).toISOString();
  return {
    id,
    ocr: { fbName: 'King Gonzales', itemQuery: '0.55' },
    screenshot_path: `${id}.jpg`,
    pancake_conversation_id: `PAGE_${id}psid`,
    message_status: 'awaiting_inbox',
    canonical_grams: null,
    source: 'floating',
    is_test: false,
    official_order_id: null,
    confirmed: null,
    created_at: iso,
    captured_at: iso,
    message_sequence: null,
    text_send_status: null,
    text_attempts: 0,
    text_max_attempts: null,
    text_next_at: null,
    text_claimed_at: null,
    text_waiting_since: null,
    route_reason: null,
    private_reply_kind: null,
    ...over,
  };
}

/* ---- The database functions, mirrored ---------------------------------------------------- */
function claimText(id: string, trigger: string): string {
  const c = db.get(id);
  if (!c) return 'not_found';
  if (c.message_sequence !== 'screenshot_first') return 'not_applicable';
  const status = c.text_send_status ?? 'pending';
  if (status === 'sent') return 'already_sent';
  if ((c.private_reply_kind ?? 'computation') === 'computation') {
    if (shareLinkSent.has(id)) {
      c.text_send_status = 'sent';
      return 'already_sent';
    }
    if (shareLinkUncertain.has(id)) {
      c.text_send_status = 'unconfirmed';
      return 'unconfirmed';
    }
  }
  if (c.message_status !== 'sent') return 'not_ready';
  if (status === 'failed' || status === 'unconfirmed') return status;
  if (status === 'sending') {
    if (c.text_claimed_at !== null && c.text_claimed_at > NOW() - 120_000) return 'in_progress';
    c.text_send_status = 'unconfirmed';
    c.text_claimed_at = null;
    return 'unconfirmed';
  }
  if (status === 'waiting_reply' && trigger !== 'reply') return 'waiting_reply';
  if (status === 'pending') {
    if (trigger === 'auto' && c.text_next_at !== null && c.text_next_at > NOW()) return 'not_due';
    if (trigger === 'auto' && c.text_attempts >= (c.text_max_attempts ?? 3)) {
      c.text_send_status = 'waiting_reply';
      c.text_waiting_since = new Date(NOW()).toISOString();
      return 'waiting_reply';
    }
  }
  c.text_send_status = 'sending';
  c.text_claimed_at = NOW();
  c.text_attempts += 1;
  return 'claimed';
}

function finalizeText(id: string, outcome: string, retryAfter: number | null): string {
  const c = db.get(id);
  if (!c) return 'not_found';
  if (c.text_send_status !== 'sending') return 'not_claimed';
  const next =
    outcome === 'retry'
      ? c.text_attempts < (c.text_max_attempts ?? 3)
        ? 'pending'
        : 'waiting_reply'
      : outcome;
  c.text_send_status = next;
  c.text_claimed_at = null;
  c.text_next_at = next === 'pending' ? NOW() + Math.max(0, retryAfter ?? 0) * 1000 : null;
  c.text_waiting_since = next === 'waiting_reply' ? new Date(NOW()).toISOString() : null;
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
          a.p_mode === 'screenshot_first' ? Math.max(1, Math.min(3, a.p_max_attempts as number)) : null;
      }
      if (
        c.message_sequence === 'screenshot_first' &&
        c.text_send_status === null &&
        (c.private_reply_kind ?? 'computation') === 'computation' &&
        shareLinkSent.has(id)
      ) {
        c.text_send_status = 'sent';
      }
      return c.message_sequence;
    case 'claim_capture_photo_send':
      if (!c) return 'not_found';
      if (c.message_status === 'sent') return 'already_sent';
      if (c.message_status === 'sending') return 'in_progress';
      c.message_status = 'sending';
      return 'claimed';
    case 'finalize_capture_photo_send':
      if (c && c.message_status === 'sending') c.message_status = a.p_ok ? 'sent' : 'failed';
      return c?.message_status ?? null;
    case 'mark_capture_photo_state':
      if (c && !['sent', 'sending', 'link_sent'].includes(c.message_status ?? '')) {
        c.message_status = a.p_status as string;
      }
      return a.p_status;
    case 'mark_capture_text_sent_by_private_reply':
      if (
        c &&
        c.message_sequence === 'screenshot_first' &&
        (c.private_reply_kind ?? 'computation') === 'computation' &&
        c.text_send_status !== 'sent'
      ) {
        c.text_send_status = 'sent';
      }
      return c?.text_send_status ?? null;
    case 'mark_capture_private_reply_prompt':
      if (!c) return null;
      if (
        c.message_sequence === 'screenshot_first' &&
        c.private_reply_kind === null &&
        c.text_send_status !== 'sent' &&
        !shareLinkSent.has(id) &&
        !shareLinkUncertain.has(id)
      ) {
        c.private_reply_kind = 'prompt';
      }
      return c.private_reply_kind ?? 'computation';
    case 'claim_capture_text_send':
      return claimText(id, a.p_trigger as string);
    case 'list_due_capture_text_legs':
      return [...db.values()]
        .filter(
          (x) =>
            x.message_sequence === 'screenshot_first' &&
            x.message_status === 'sent' &&
            x.confirmed === null &&
            (x.text_send_status === null ||
              (x.text_send_status === 'pending' && (x.text_next_at === null || x.text_next_at <= NOW())) ||
              (x.text_send_status === 'sending' && (x.text_claimed_at === null || x.text_claimed_at < NOW() - 120_000))),
        )
        .map((x) => x.id);
    case 'list_waiting_capture_texts':
      return [...db.values()]
        .filter((x) => x.message_sequence === 'screenshot_first' && x.text_send_status === 'waiting_reply')
        .map((x) => ({ id: x.id, pancake_conversation_id: x.pancake_conversation_id, text_waiting_since: x.text_waiting_since }));
    case 'finalize_capture_text_send':
      return finalizeText(id, a.p_outcome as string, (a.p_retry_after_seconds as number | null) ?? null);
    default:
      return null;
  }
}

/* ---- A tiny query builder over the in-memory rows ----------------------------------------- */
function queryBuilder(table: string) {
  const filters: Array<(c: Cap) => boolean> = [];
  let limitN = 1000;
  const run = (): Cap[] => [...db.values()].filter((c) => filters.every((f) => f(c))).slice(0, limitN);
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (col: keyof Cap, val: unknown) => (filters.push((c) => c[col] === val), b),
    is: (col: keyof Cap, val: unknown) => (filters.push((c) => (c[col] ?? null) === val), b),
    not: (col: keyof Cap) => (filters.push((c) => (c[col] ?? null) !== null), b),
    in: (col: keyof Cap, vals: unknown[]) => (filters.push((c) => vals.includes(c[col])), b),
    or: (expr: string) => {
      // Only the one OR this module uses: text_send_status null or in (pending,sending,waiting_reply).
      expect(expr).toBe('text_send_status.is.null,text_send_status.in.(pending,sending,waiting_reply)');
      filters.push((c) => [null, 'pending', 'sending', 'waiting_reply'].includes(c.text_send_status));
      return b;
    },
    like: (col: keyof Cap, pattern: string) => {
      const suffix = pattern.replace(/^%/, '');
      filters.push((c) => { const v = c[col]; return typeof v === 'string' && v.endsWith(suffix); });
      return b;
    },
    gt: () => b,
    order: () => b,
    limit: (n: number) => {
      limitN = n;
      return Promise.resolve({ data: run(), error: null });
    },
    maybeSingle: () => {
      if (table === 'pancake_integration_config') {
        return Promise.resolve(settingsError ? { data: null, error: settingsError } : { data: settingsRow, error: null });
      }
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
        createSignedUrl: (p: string) => Promise.resolve({ data: { signedUrl: `https://signed/${p}` } }),
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
    isConversationMediaEligible: vi.fn(() => Promise.resolve(true)),
    genuineInboxDmSinceBatch: vi.fn(() => Promise.resolve(new Set<string>())),
  };
});

const COMPUTATION = ['King', '0.55g × ₱7,700/g', 'Total: ₱4,235'].join(String.fromCharCode(10));

vi.mock('@/lib/capture/route-b', () => ({
  attemptSecureLinkPrivateReply: vi.fn(),
  buildAutoTextMessage: vi.fn(() => Promise.resolve(COMPUTATION)),
  buildAutoTextMessageDetailed: vi.fn(() => Promise.resolve({ message: COMPUTATION, readError: false })),
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

/** Script the text results in order; every photo succeeds unless told otherwise. */
function scriptSends(textResults: SendResult[], photoOk = true) {
  const queueTexts = [...textResults];
  vi.mocked(pancake.sendPancakeConversationMessage).mockImplementation((input) => {
    const kind = input.attachmentUrl ? 'photo' : 'text';
    sends.push({ conv: input.conversationId, kind, message: input.message });
    if (kind === 'photo') {
      // Never text and image together in one request.
      expect(input.message).toBe('');
      return Promise.resolve(photoOk ? OK : HTTP(400));
    }
    expect(input.attachmentUrl ?? null).toBeNull();
    return Promise.resolve(queueTexts.shift() ?? OK);
  });
}

const count = (kind: 'photo' | 'text', conv?: string) =>
  sends.filter((s) => s.kind === kind && (!conv || s.conv === conv)).length;

/** One cron run: the same single 50s deadline the every-minute cron route passes. */
async function sweep() {
  const p = routePendingCapturesSystem(15, { deadlineAt: Date.now() + 50_000 });
  await vi.runAllTimersAsync();
  return p;
}

describe('screenshot-first sequence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    db = new Map();
    queue = [];
    sends.length = 0;
    settingsRow = { private_reply_sequence: 'screenshot_first', text_send_attempts: 3 };
    vi.mocked(pancake.findConversationMessageByText).mockResolvedValue('unknown');
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    vi.mocked(mediaWindow.genuineInboxDmSinceBatch).mockResolvedValue(new Set<string>());
    shareLinkSent = new Set();
    shareLinkUncertain = new Set();
    vi.mocked(routeB.buildAutoTextMessageDetailed).mockResolvedValue({ message: COMPUTATION, readError: false });
    settingsError = null;
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TEST 1 — screenshot then text on attempt 1: exactly 1 screenshot + 1 text, in that order', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    const summary = await sweep();
    expect(sends.map((s) => s.kind)).toEqual(['photo', 'text']);
    expect(sends[1]?.message).toBe(COMPUTATION);
    // The text followed the screenshot IMMEDIATELY (inline), not later via the due-work fallback.
    expect(summary.outcomes.photo_sent).toBe(1);
    expect(summary.outcomes.due_text_sent).toBeUndefined();
    expect(db.get('A')?.message_status).toBe('sent');
    expect(db.get('A')?.text_send_status).toBe('sent');
    expect(db.get('A')?.route_reason).toBe('Screenshot sent ✓ · Computation sent ✓');
  });

  it('TEST 2 — text fails once (HTTP 503) then succeeds: the screenshot is not duplicated', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), OK]);
    await sweep();
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(2);
    expect(db.get('A')?.text_send_status).toBe('sent');
    expect(db.get('A')?.text_attempts).toBe(2);
  });

  it('TEST 3 — text succeeds on attempt 3: one screenshot, one delivered text', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), HTTP(429, { retryAfterSeconds: 1 }), OK]);
    await sweep();
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(3);
    expect(db.get('A')?.text_send_status).toBe('sent');
  });

  it('TEST 4 — every allowed attempt fails: exactly 3 attempts, then Waiting for customer reply', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), HTTP(503), HTTP(503), OK]);
    await sweep();
    expect(count('text')).toBe(3); // 3 total attempts, not 3 retries after the first
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');
    expect(db.get('A')?.route_reason).toBe('Screenshot sent ✓ · Waiting for customer reply');
  });

  it('honours the Owner setting: 1 attempt means one try only', async () => {
    settingsRow = { private_reply_sequence: 'screenshot_first', text_send_attempts: 1 };
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), OK]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');
  });

  it('TEST 5 — a genuine reply afterwards sends the text exactly once', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), HTTP(503), HTTP(503), OK, OK]);
    await sweep();
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');

    const first = resumeTextForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    expect((await first).sent).toBe(1);
    const again = resumeTextForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    expect((await again).sent).toBe(0);
    expect(count('text')).toBe(4); // 3 failed attempts + 1 after the reply
    expect(count('photo')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('sent');
  });

  it('TEST 6 — a reply after the text already succeeded sends nothing', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    const r = resumeTextForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    expect((await r).sent).toBe(0);
    expect(count('text')).toBe(1);
  });

  it('TEST 7 — refresh / replay / restart / reconnect never duplicate the screenshot or the text', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    // A replayed webhook, a second cron, a reconnect: the same capture is offered again.
    queue = ['A'];
    await sweep();
    await sweep();
    const reply = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await reply;
    const direct = runCaptureTextSequence(
      (await import('@/lib/supabase/admin')).createAdminClient(),
      'A',
      { trigger: 'auto', deadlineAt: Date.now() + 40_000 },
    );
    await vi.runAllTimersAsync();
    expect(await direct).toBe('already_sent');
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(1);
  });

  it('a worker lost mid-send (stale claim) becomes "unconfirmed" and is never re-sent automatically', async () => {
    db.set(
      'A',
      newCap('A', {
        message_status: 'sent',
        message_sequence: 'screenshot_first',
        text_max_attempts: 3,
        text_send_status: 'sending',
        text_claimed_at: Date.now() - 5 * 60_000,
        text_attempts: 1,
      }),
    );
    scriptSends([OK]);
    await sweep();
    expect(count('text')).toBe(0);
    expect(db.get('A')?.text_send_status).toBe('unconfirmed');
  });

  it('an ambiguous timeout is checked before anything: found → sent, never re-sent', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    vi.mocked(pancake.findConversationMessageByText).mockResolvedValue('found');
    scriptSends([{ ok: false, code: 'unavailable', message: 'x', pancakeMessageId: null, transport: 'timeout' }]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('sent');
  });

  it('an ambiguous timeout that cannot be confirmed stays "unconfirmed" — no blind resend', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([{ ok: false, code: 'unavailable', message: 'x', pancakeMessageId: null, transport: 'timeout' }, OK]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('unconfirmed');
  });

  it('TEST 8 — "customer reply required" stops at once (no pointless retries)', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([{ ok: false, code: 'outside_window', message: 'x', pancakeMessageId: null }]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');
  });

  it('an authentication failure is never retried', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(401), OK]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('failed');
  });

  it('a screenshot failure never proceeds to text', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK], false);
    await sweep();
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(0);
    expect(db.get('A')?.message_status).toBe('failed');
  });

  it('TEST 9 — several captures keep independent state', async () => {
    db.set('A', newCap('A'));
    db.set('B', newCap('B'));
    db.set('C', newCap('C'));
    queue = ['A', 'B', 'C'];
    // A: all three fail → waiting. B: first try succeeds. C: second try succeeds.
    scriptSends([HTTP(503), HTTP(503), HTTP(503), OK, HTTP(503), OK]);
    await sweep();
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');
    expect(db.get('B')?.text_send_status).toBe('sent');
    expect(db.get('C')?.text_send_status).toBe('sent');
    expect(count('photo')).toBe(3);
  });

  it('a capture that cannot finish inside the remaining time is not started — the next run sends it', async () => {
    db.set('A', newCap('A'));
    db.set('B', newCap('B'));
    queue = ['A', 'B'];
    // A uses ~7s of backoff; with a 40s budget B no longer has a whole screenshot send left.
    scriptSends([HTTP(503), HTTP(503), HTTP(503), OK]);
    const p = routePendingCapturesSystem(15, { deadlineAt: Date.now() + 40_000 });
    await vi.runAllTimersAsync();
    await p;
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');
    expect(count('photo', 'PAGE_Bpsid')).toBe(0);
    expect(db.get('B')?.message_status).not.toBe('sent');
    expect(db.get('B')?.text_send_status).toBeNull();
    queue = ['B'];
    await sweep();
    expect(count('photo', 'PAGE_Bpsid')).toBe(1);
    expect(db.get('B')?.text_send_status).toBe('sent');
  });

  it('comment-only customer: the one Private Reply only asks them to reply; screenshot THEN computation follow the reply', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    // The real Route B records the prompt in the database before sending it; mirror that.
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockImplementation(async (input) => {
      const marked = input.prompt
        ? ((await input.supabase.rpc('mark_capture_private_reply_prompt', { p_capture_id: input.captureRecordId }))
            .data as 'prompt' | 'computation')
        : 'computation';
      shareLinkSent.add(input.captureRecordId);
      return { ok: true, code: 'sent', url: null, kind: marked };
    });
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    expect(vi.mocked(routeB.attemptSecureLinkPrivateReply).mock.calls[0]![0].prompt).toBe(true);
    expect(count('photo')).toBe(0);
    expect(count('text')).toBe(0);
    expect(db.get('A')?.message_status).toBe('link_sent');
    expect(db.get('A')?.private_reply_kind).toBe('prompt');
    expect(db.get('A')?.text_send_status).toBeNull(); // the computation is still to come
    expect(db.get('A')?.route_reason).toBe('Reply request sent ✓ · Screenshot + computation after reply');

    // The customer replies in Messenger: the SCREENSHOT goes first, then the computation.
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    const r = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await r;
    expect(sends.map((s) => s.kind)).toEqual(['photo', 'text']);
    expect(sends[1]!.message).toBe(COMPUTATION);
    expect(db.get('A')?.text_send_status).toBe('sent');
    expect(db.get('A')?.route_reason).toBe('Screenshot sent ✓ · Computation sent ✓');

    // A second reply (or a replayed webhook) sends nothing more.
    const again = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await again;
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(1);
  });

  it('classic sequence: the one Private Reply still carries the computation (no prompt)', async () => {
    settingsRow = { private_reply_sequence: 'classic', text_send_attempts: 3 };
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({ ok: true, code: 'sent', url: null, kind: 'computation' });
    db.set('A', newCap('A'));
    queue = ['A'];
    await sweep();
    expect(vi.mocked(routeB.attemptSecureLinkPrivateReply).mock.calls[0]![0].prompt).toBe(false);
    expect(db.get('A')?.route_reason).toBe('AUTO TEXT Sent to Messenger ✓');
    expect(db.get('A')?.private_reply_kind).toBeNull();
  });

  it('a capture whose one Private Reply already carried the computation never gets it twice', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockResolvedValue({ ok: true, code: 'sent', url: null, kind: 'computation' });
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    expect(count('photo')).toBe(0);
    expect(db.get('A')?.message_status).toBe('link_sent');
    expect(db.get('A')?.text_send_status).toBe('sent');
    expect(db.get('A')?.route_reason).toBe('Computation sent ✓ · Screenshot after customer replies');

    // The customer replies: the screenshot follows, and NO second computation.
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    const r = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await r;
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(0);
    expect(db.get('A')?.route_reason).toBe('Screenshot sent ✓ · Computation sent ✓');
  });

  it('classic sequence keeps the previous behaviour: screenshot only, no computation text', async () => {
    settingsRow = { private_reply_sequence: 'classic', text_send_attempts: 3 };
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    expect(sends.map((s) => s.kind)).toEqual(['photo']);
    expect(db.get('A')?.route_reason).toBe('AUTO SS Sent to Messenger ✓');
  });

  it('a settings change never rewrites a capture already in flight (set-once stamp)', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), HTTP(503), HTTP(503)]);
    await sweep();
    expect(db.get('A')?.message_sequence).toBe('screenshot_first');
    settingsRow = { private_reply_sequence: 'classic', text_send_attempts: 1 };
    queue = ['A'];
    await sweep();
    expect(db.get('A')?.message_sequence).toBe('screenshot_first');
    expect(db.get('A')?.text_max_attempts).toBe(3);
  });

  it('the every-minute missed-reply fallback only sends when a genuine reply came SINCE the wait', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([HTTP(503), HTTP(503), HTTP(503), OK]);
    await sweep();
    expect(db.get('A')?.text_send_status).toBe('waiting_reply');

    let r = runWaitingTextReplyFallbackSystem();
    await vi.runAllTimersAsync();
    expect((await r).sent).toBe(0); // no genuine reply since the wait → nothing sent
    expect(count('text')).toBe(3);

    vi.mocked(mediaWindow.genuineInboxDmSinceBatch).mockResolvedValue(new Set(['A']));
    r = runWaitingTextReplyFallbackSystem();
    await vi.runAllTimersAsync();
    expect((await r).sent).toBe(1);
    expect(count('text')).toBe(4);
    expect(db.get('A')?.text_send_status).toBe('sent');
  });

  it('REVIEW B1 — a Private Reply sent by the OLD code is never followed by a second computation', async () => {
    // Before the migration: the capture got its computation as the Private Reply and is 'link_sent'
    // with NO sequence stamped. After go-live the customer replies.
    db.set('A', newCap('A', { message_status: 'link_sent' }));
    shareLinkSent.add('A');
    scriptSends([OK]);
    const r = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await r;
    expect(count('photo')).toBe(1); // the screenshot follows the reply
    expect(count('text')).toBe(0); // the computation is NOT sent again
    expect(db.get('A')?.text_send_status).toBe('sent');
  });

  it('REVIEW M1 — if recording the Private Reply failed, the ledger still blocks a second computation', async () => {
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(false);
    vi.mocked(routeB.attemptSecureLinkPrivateReply).mockImplementation(() => {
      shareLinkSent.add('A'); // the Private Reply went out and the ledger says so …
      return Promise.resolve({ ok: true, code: 'sent', url: null, kind: 'computation' as const });
    });
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    db.get('A')!.text_send_status = null; // … but recording it as the text never happened
    vi.mocked(mediaWindow.isConversationMediaEligible).mockResolvedValue(true);
    const r = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await r;
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(0);
  });

  it('REVIEW M2 — a reply is never missed because other customers have many waiting captures', async () => {
    for (let i = 0; i < 30; i += 1) {
      db.set(
        `X${i}`,
        newCap(`X${i}`, {
          message_status: 'sent',
          message_sequence: 'screenshot_first',
          text_max_attempts: 3,
          text_send_status: 'waiting_reply',
        }),
      );
    }
    db.set(
      'A',
      newCap('A', {
        message_status: 'sent',
        message_sequence: 'screenshot_first',
        text_max_attempts: 3,
        text_send_status: 'waiting_reply',
      }),
    );
    scriptSends([OK]);
    const r = resumeTextForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    expect((await r).sent).toBe(1);
    expect(sends.filter((s) => s.kind === 'text').map((s) => s.conv)).toEqual(['PAGE_Apsid']);
  });

  it('REVIEW M3 — a gateway 502/504 is checked before any retry: delivered → no resend', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    vi.mocked(pancake.findConversationMessageByText).mockResolvedValue('found');
    scriptSends([HTTP(504), OK]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('sent');
    // Only a message NEWER than the attempt may confirm it.
    const call = vi.mocked(pancake.findConversationMessageByText).mock.calls[0];
    expect(typeof call?.[2]).toBe('number');
  });

  it('REVIEW N1 — a gateway 502 not (yet) visible in the chat is NOT resent: it becomes unconfirmed', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    vi.mocked(pancake.findConversationMessageByText).mockResolvedValue('not_found');
    scriptSends([HTTP(502), OK]);
    await sweep();
    expect(count('text')).toBe(1);
    expect(db.get('A')?.text_send_status).toBe('unconfirmed');
  });

  it('REVIEW M4 — never starts an attempt that could outlive the time budget', async () => {
    db.set(
      'A',
      newCap('A', { message_status: 'sent', message_sequence: 'screenshot_first', text_max_attempts: 3 }),
    );
    scriptSends([OK]);
    const admin = (await import('@/lib/supabase/admin')).createAdminClient();
    const t = runCaptureTextSequence(admin, 'A', { trigger: 'auto', deadlineAt: Date.now() + 1000 });
    await vi.runAllTimersAsync();
    expect(await t).toBe('deferred');
    expect(count('text')).toBe(0);
    expect(db.get('A')?.text_send_status).toBe(null); // nothing claimed, still due
  });

  it('the backoff is persisted, so no other worker can make the next attempt early', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    // Attempt 1 fails; the inline loop then runs out of time before attempt 2.
    scriptSends([HTTP(503)]);
    const admin = (await import('@/lib/supabase/admin')).createAdminClient();
    db.get('A')!.message_status = 'sent';
    db.get('A')!.message_sequence = 'screenshot_first';
    db.get('A')!.text_max_attempts = 3;
    const t = runCaptureTextSequence(admin, 'A', { trigger: 'auto', deadlineAt: Date.now() + 26_000 });
    await vi.runAllTimersAsync();
    expect(await t).toBe('deferred');
    const next = db.get('A')?.text_next_at ?? 0;
    expect(next).toBeGreaterThan(Date.now()); // not due yet — another worker would get 'not_due'
  });

  it('a settings read that fails transiently sends nothing and stamps nothing', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    settingsError = { code: 'XX000', message: 'canceling statement due to statement timeout' };
    scriptSends([OK]);
    await sweep();
    expect(sends).toEqual([]);
    expect(db.get('A')?.message_sequence).toBeNull();
    expect(db.get('A')?.message_status).toBe('awaiting_inbox'); // retried on the next sweep
  });

  it('before the migration (missing column) the previous behaviour is kept exactly', async () => {
    db.set('A', newCap('A'));
    queue = ['A'];
    settingsError = { code: '42703', message: 'column pancake_integration_config.private_reply_sequence does not exist' };
    scriptSends([OK]);
    await sweep();
    expect(sends.map((s) => s.kind)).toEqual(['photo']);
    expect(db.get('A')?.route_reason).toBe('AUTO SS Sent to Messenger ✓');
  });
  it('a Private Reply stuck sending / failed after contacting Pancake blocks a second computation', async () => {
    db.set('A', newCap('A', { message_status: 'link_sent' }));
    shareLinkUncertain.add('A');
    scriptSends([OK]);
    const r = reactivatePhotoForConversationSystem('PAGE_Apsid');
    await vi.runAllTimersAsync();
    await r;
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(0);
    expect(db.get('A')?.text_send_status).toBe('unconfirmed');
  });

  it('a transient read of the price rate claims nothing (retried next sweep, never failed for good)', async () => {
    vi.mocked(routeB.buildAutoTextMessageDetailed).mockResolvedValue({ message: null, readError: true });
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    expect(count('photo')).toBe(1);
    expect(count('text')).toBe(0);
    expect(db.get('A')?.text_send_status).toBeNull();
    expect(db.get('A')?.text_attempts).toBe(0);
  });

  it('genuinely incomplete price data is a finite, visible failure (never a guessed computation)', async () => {
    vi.mocked(routeB.buildAutoTextMessageDetailed).mockResolvedValue({ message: null, readError: false });
    db.set('A', newCap('A'));
    queue = ['A'];
    scriptSends([OK]);
    await sweep();
    expect(count('text')).toBe(0);
    expect(db.get('A')?.text_send_status).toBe('failed');
  });
});
