import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// listPendingCaptures reads its Supabase client from createClient(); each test swaps it in here.
const holder = vi.hoisted((): { client: unknown } => ({ client: null }));
vi.mock('@/lib/authz/guard', () => ({
  requirePermission: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => Promise.resolve(holder.client)),
}));

import {
  createClient as createSupabaseJs,
  type SupabaseClient,
} from '@supabase/supabase-js';

import {
  conversationsMediaEligibility,
  isConversationMediaEligible,
} from '@/lib/capture/media-window';
import { listPendingCaptures } from '@/lib/capture/pending';

/*
 * Incoming Captures strip reader: proves the per-row fan-out (1 Storage sign + 1
 * pancake_webhook_events query PER ROW, every 5s poll) is now ONE sign request + ONE
 * eligibility query for the whole list, and that every row's screenshot URL and "Photo ready"
 * flag are identical to what the per-row functions return for the same fixture.
 *
 * Storage runs through the REAL supabase-js / storage-js client over a fake storage server
 * (so path handling, URL building and error mapping are the library's own); the database is an
 * in-memory PostgREST-style builder that honours eq / in / is / gt / order / limit + max_rows.
 */

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
type QueryLog = { table: string; ops: string[]; limit: number | null };
type Result = { data: Row[] | null; error: { message: string } | null };

interface Builder extends PromiseLike<Result> {
  select(cols?: string): Builder;
  eq(col: string, v: unknown): Builder;
  in(col: string, vs: readonly unknown[]): Builder;
  is(col: string, v: null): Builder;
  gt(col: string, v: string): Builder;
  order(col: string, o: { ascending: boolean }): Builder;
  limit(n: number): Builder;
}

function fakeDb(
  tables: Record<string, Row[]>,
  opts: { maxRows?: number | undefined; failTables?: string[] } = {},
) {
  const queries: QueryLog[] = [];
  const from = (table: string): Builder => {
    let rows = [...(tables[table] ?? [])];
    let cap = opts.maxRows ?? 1000; // PostgREST max_rows (supabase/config.toml)
    const log: QueryLog = { table, ops: [], limit: null };
    queries.push(log);
    const time = (v: unknown) => Date.parse(String(v));
    const b: Builder = {
      select: () => b,
      eq: (c, v) => {
        log.ops.push(`eq ${c}`);
        rows = rows.filter((r) => r[c] === v);
        return b;
      },
      in: (c, vs) => {
        log.ops.push(`in ${c}`);
        const set = new Set(vs);
        rows = rows.filter((r) => set.has(r[c]));
        return b;
      },
      is: (c, v) => {
        log.ops.push(`is ${c}`);
        rows = rows.filter((r) => (r[c] ?? null) === v);
        return b;
      },
      gt: (c, v) => {
        log.ops.push(`gt ${c}`);
        rows = rows.filter((r) => time(r[c]) > time(v));
        return b;
      },
      order: (c, o) => {
        log.ops.push(`order ${c}`);
        rows.sort((a, z) => (o.ascending ? 1 : -1) * (time(a[c]) - time(z[c])));
        return b;
      },
      limit: (n) => {
        log.limit = n;
        cap = Math.min(cap, n);
        return b;
      },
      then: (ok, bad) =>
        Promise.resolve<Result>(
          opts.failTables?.includes(table)
            ? { data: null, error: { message: 'unavailable' } }
            : { data: rows.slice(0, cap), error: null },
        ).then(ok, bad),
    };
    return b;
  };
  const count = (table: string) => queries.filter((q) => q.table === table).length;
  return { from, queries, count };
}

const SUPABASE_URL = 'http://supabase.test';
const SIGN_BASE = `${SUPABASE_URL}/storage/v1/object/sign/attachments`;

/** A fake Storage server behind the REAL supabase-js storage client. */
function fakeStorage(stored: ReadonlySet<string>, mode: 'up' | 'down' = 'up') {
  const calls = {
    batch: 0,
    single: 0,
    batchBodies: [] as Array<{ expiresIn: number; paths: string[] }>,
  };
  const token = (p: string, exp: number) =>
    `t${exp}x${[...p].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)}`;
  const signedURL = (p: string, exp: number) =>
    `/object/sign/attachments/${p}?token=${token(p, exp)}`;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const respond = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      expiresIn: number;
      paths?: string[];
    };
    if (url === SIGN_BASE) {
      calls.batch += 1;
      calls.batchBodies.push({ expiresIn: body.expiresIn, paths: body.paths ?? [] });
      if (mode === 'down')
        return json({ statusCode: '500', error: 'down', message: 'down' }, 500);
      return json(
        (body.paths ?? []).map((p) =>
          stored.has(p)
            ? { error: null, path: p, signedURL: signedURL(p, body.expiresIn) }
            : {
                error: 'Either the object does not exist or you do not have access to it',
                path: p,
                signedURL: null,
              },
        ),
      );
    }
    if (url.startsWith(`${SIGN_BASE}/`)) {
      calls.single += 1;
      if (mode === 'down')
        return json({ statusCode: '500', error: 'down', message: 'down' }, 500);
      const p = url.slice(SIGN_BASE.length + 1);
      return stored.has(p)
        ? json({ signedURL: signedURL(p, body.expiresIn) })
        : json(
            { statusCode: '404', error: 'not_found', message: 'Object not found' },
            400,
          );
    }
    return json({ message: `unexpected ${url}` }, 404);
  };
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(respond(input, init));
  const client = createSupabaseJs(SUPABASE_URL, 'anon-test-key', {
    global: { fetch: fetchImpl },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { storage: client.storage, calls };
}

// ---- Fixture ------------------------------------------------------------------------------
const PAGE = '588622885161430';
const PAGE2 = '111122223333444';
const conv = (psid: string, page = PAGE) => `${page}_${psid}`;
const secondsAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();

const dm = (psid: string) => ({
  data: { message: { mid: `m_${psid}`, from: { id: psid }, text: 'Hi' } },
});
const liveComment = (psid: string) => ({
  data: {
    post: { id: `${PAGE}_1561919158756882` },
    message: { from: { id: psid }, attachments: [{ type: 'image' }] },
  },
});
const inboxEmptyPost = (psid: string) => ({
  data: { post: {}, message: { type: 'INBOX', from: { id: psid } } },
});
const pageEcho = () => ({
  data: { message: { mid: 'm_e', is_echo: true, from: { id: PAGE }, text: 'reply' } },
});
const event = (
  psid: string,
  raw: unknown,
  ts: string,
  postType: string | null = null,
) => ({
  facebook_psid: psid,
  post_type: postType,
  event_timestamp: ts,
  raw,
});

const P = {
  DM: '1000000000000001', // genuine DM 1 min ago → eligible
  COMMENTS: '1000000000000002', // Live comments only → not
  OLD_DM: '1000000000000003', // genuine DM 48h ago → outside window
  DEEP_DM: '1000000000000004', // 50 newer comments bury a DM at #51 → the single read's limit(50) misses it
  ECHO: '1000000000000005', // Page echo only → not
  POST_TYPE: '1000000000000006', // DM stored with a post_type → filtered out
  EMPTY_POST: '1000000000000007', // genuine INBOX reply with empty data.post → eligible
  NONE: '1000000000000008', // no events at all
  OTHER_FROM: '1000000000000009', // message stored under this PSID but sent by someone else
  SHARED: '1000000000000010', // one PSID reached through two pages → both eligible
  NOISE: '1000000000000099', // events for a customer with no capture in the list
};

const EVENTS: Row[] = [
  event(P.DM, dm(P.DM), secondsAgo(60)),
  event(P.DM, liveComment(P.DM), secondsAgo(30)),
  event(P.COMMENTS, liveComment(P.COMMENTS), secondsAgo(45)),
  event(P.COMMENTS, liveComment(P.COMMENTS), secondsAgo(90)),
  event(P.OLD_DM, dm(P.OLD_DM), secondsAgo(48 * 3600)),
  ...Array.from({ length: 50 }, (_, i) =>
    event(P.DEEP_DM, liveComment(P.DEEP_DM), secondsAgo(100 + i)),
  ),
  event(P.DEEP_DM, dm(P.DEEP_DM), secondsAgo(400)),
  event(P.ECHO, pageEcho(), secondsAgo(20)),
  event(P.POST_TYPE, dm(P.POST_TYPE), secondsAgo(20), 'livestream'),
  event(P.EMPTY_POST, inboxEmptyPost(P.EMPTY_POST), secondsAgo(500)),
  event(P.OTHER_FROM, dm('4000000000000004'), secondsAgo(25)),
  event(P.SHARED, dm(P.SHARED), secondsAgo(700)),
  event(P.NOISE, dm(P.NOISE), secondsAgo(5)),
];

const capture = (i: number, over: Row = {}): Row => ({
  id: `cap-${i}`,
  source: 'floating',
  captured_at: secondsAgo(i),
  screenshot_path: `captures/${i}.jpg`,
  ocr: { fbName: `Buyer ${i}`, itemQuery: '18' },
  is_test: false,
  link_status: 'unlinked',
  customer_id: null,
  pancake_conversation_id: null,
  message_status: null,
  route_reason: null,
  canonical_grams: null,
  customers: null,
  ...over,
});
const linked = (c: string | null) => ({
  link_status: 'linked',
  pancake_conversation_id: c,
});

const CAPTURES: Row[] = [
  capture(0, linked(conv(P.DM))),
  capture(1, linked(conv(P.COMMENTS))),
  capture(2, linked(conv(P.OLD_DM))),
  capture(3, { ...linked(conv(P.DEEP_DM)), screenshot_path: null }),
  capture(4, linked(conv(P.ECHO))),
  capture(5, { ...linked(conv(P.POST_TYPE)), screenshot_path: 'captures/missing.jpg' }),
  capture(6, linked(conv(P.EMPTY_POST))),
  capture(7, { ...linked(conv(P.NONE)), screenshot_path: '/captures/7.jpg' }), // leading slash
  capture(8, { ...linked(conv(P.OTHER_FROM)), screenshot_path: 'captures/shared.jpg' }),
  capture(9, { ...linked(conv(P.SHARED)), screenshot_path: 'captures/shared.jpg' }), // same file
  capture(10, linked(conv(P.SHARED, PAGE2))),
  capture(11, { ...linked(conv(P.DM)), screenshot_path: '' }), // same conversation as row 0
  capture(12, linked('bad-id')), // no {page}_{psid} shape
  capture(13, linked(null)),
  capture(14, linked('   ')),
  capture(15, { link_status: 'needs_confirmation', pancake_conversation_id: conv(P.DM) }),
  capture(16, { link_status: 'unlinked', pancake_conversation_id: conv(P.DM) }),
  capture(17, { link_status: null }),
  capture(18, linked(`  ${conv(P.DM)}  `)), // padded id → trimmed
  capture(19, linked(conv(P.EMPTY_POST, PAGE2))),
];

const STORED = new Set([
  ...Array.from({ length: 20 }, (_, i) => `captures/${i}.jpg`),
  'captures/shared.jpg',
]);

const tablesFor = (captures: Row[], events: Row[] = EVENTS) => ({
  capture_records: captures,
  pancake_webhook_events: events,
});

/** What the strip got BEFORE: the per-row expressions listPendingCaptures used to run. */
async function perRowReference(
  captures: Row[],
  storageMode: 'up' | 'down' = 'up',
  failDb = false,
) {
  const storage = fakeStorage(STORED, storageMode);
  const db = fakeDb(tablesFor(captures), {
    failTables: failDb ? ['pancake_webhook_events'] : [],
  });
  const client = { from: db.from, storage: storage.storage } as unknown as SupabaseClient;
  const out: Array<{ screenshotUrl: string | null; photoEligible: boolean }> = [];
  for (const r of captures) {
    const path = r.screenshot_path as string | null;
    const screenshotUrl = path
      ? await client.storage
          .from('attachments')
          .createSignedUrl(path, 600)
          .then((res) => res.data?.signedUrl ?? null)
          .catch(() => null)
      : null;
    const c = str(r.pancake_conversation_id).trim();
    const photoEligible =
      r.link_status === 'linked' && c
        ? await isConversationMediaEligible(client, c).catch(() => false)
        : false;
    out.push({ screenshotUrl, photoEligible });
  }
  return {
    out,
    signCalls: storage.calls.single,
    eligibilityQueries: db.count('pancake_webhook_events'),
  };
}

async function runStrip(
  captures: Row[],
  opts: { storageMode?: 'up' | 'down'; failDb?: boolean; events?: Row[] } = {},
) {
  const storage = fakeStorage(STORED, opts.storageMode ?? 'up');
  const db = fakeDb(tablesFor(captures, opts.events), {
    failTables: opts.failDb ? ['pancake_webhook_events'] : [],
  });
  holder.client = { from: db.from, storage: storage.storage };
  const rows = await listPendingCaptures();
  return { rows, storage, db };
}

// ---- listPendingCaptures ------------------------------------------------------------------
describe('listPendingCaptures — batched signing + eligibility', () => {
  it('20 rows → 1 signing call and 1 eligibility query (was 18 + 14 for this fixture)', async () => {
    const before = await perRowReference(CAPTURES);
    expect(before.signCalls).toBe(18);
    expect(before.eligibilityQueries).toBe(14);

    const { rows, storage, db } = await runStrip(CAPTURES);
    expect(rows).toHaveLength(20);
    expect(storage.calls.batch).toBe(1);
    expect(storage.calls.single).toBe(0);
    expect(db.count('pancake_webhook_events')).toBe(1);
    expect(db.count('capture_records')).toBe(1);

    // Same bucket (URL) + TTL as before; each distinct object signed once, leading slash normalised.
    const body = storage.calls.batchBodies[0] ?? { expiresIn: -1, paths: [] };
    expect(body.expiresIn).toBe(600);
    expect(new Set(body.paths).size).toBe(body.paths.length);
    expect(body.paths).toContain('captures/7.jpg');
    expect(body.paths).not.toContain('/captures/7.jpg');
    expect(body.paths.filter((p) => p === 'captures/shared.jpg')).toHaveLength(1);

    // Same filters as the single-row read, one IN over the distinct PSIDs.
    const q = db.queries.find((x) => x.table === 'pancake_webhook_events');
    expect(q?.ops).toEqual([
      'in facebook_psid',
      'is post_type',
      'gt event_timestamp',
      'order event_timestamp',
    ]);
    expect(q?.limit).toBe(50 * 10); // 10 distinct PSIDs, 50 newest events each
  });

  it('each row’s screenshot URL and Photo-ready flag equal the per-row functions’ answers', async () => {
    const before = await perRowReference(CAPTURES);
    const { rows } = await runStrip(CAPTURES);
    const after = rows.map((r) => ({
      screenshotUrl: r.screenshotUrl,
      photoEligible: r.photoEligible,
    }));
    expect(after).toEqual(before.out);

    // The fixture exercises both outcomes of both fields (the equality is not vacuous).
    expect(after.map((r) => r.photoEligible)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    const nullUrls = after.flatMap((r, i) => (r.screenshotUrl === null ? [i] : []));
    expect(nullUrls).toEqual([3, 5, 11]); // no path, object missing, empty path
    expect(after[7]?.screenshotUrl).toContain(
      '/object/sign/attachments/captures/7.jpg?token=',
    );
    expect(after[8]?.screenshotUrl).toBeTruthy();
    expect(after[8]?.screenshotUrl).toBe(after[9]?.screenshotUrl);
  });

  it.each([1, 20, 50])(
    '%i rows → still exactly 1 signing call and 1 eligibility query',
    async (n) => {
      const psid = (i: number) => String(3000000000000000 + i);
      const captures = Array.from({ length: n }, (_, i) =>
        capture(i, linked(conv(psid(i)))),
      );
      const events = captures.map((_, i) =>
        event(psid(i), i % 2 ? dm(psid(i)) : liveComment(psid(i)), secondsAgo(10 + i)),
      );
      const { rows, storage, db } = await runStrip(captures, { events });
      expect(storage.calls.batch).toBe(1);
      expect(storage.calls.single).toBe(0);
      expect(db.count('pancake_webhook_events')).toBe(1);
      expect(rows.map((r) => r.photoEligible)).toEqual(
        captures.map((_, i) => i % 2 === 1),
      );
      // The request never asks past PostgREST's max_rows (50 PSIDs × 50 = 2500 → 1000).
      expect(db.queries.find((x) => x.table === 'pancake_webhook_events')?.limit).toBe(
        Math.min(50 * n, 1000),
      );
    },
  );

  it('no linked conversations and no screenshots → no signing call and no eligibility query', async () => {
    const captures = [
      capture(0, { screenshot_path: null }),
      capture(1, { ...linked('bad-id'), screenshot_path: null }),
    ];
    const { rows, storage, db } = await runStrip(captures);
    expect(storage.calls.batch + storage.calls.single).toBe(0);
    expect(db.count('pancake_webhook_events')).toBe(0);
    expect(rows.map((r) => [r.screenshotUrl, r.photoEligible])).toEqual([
      [null, false],
      [null, false],
    ]);
  });

  it('Storage down + webhook store unreadable → every URL null and every flag false, as before', async () => {
    const before = await perRowReference(CAPTURES, 'down', true);
    const { rows } = await runStrip(CAPTURES, { storageMode: 'down', failDb: true });
    const after = rows.map((r) => ({
      screenshotUrl: r.screenshotUrl,
      photoEligible: r.photoEligible,
    }));
    expect(after).toEqual(before.out);
    expect(
      after.every((r) => r.screenshotUrl === null && r.photoEligible === false),
    ).toBe(true);
  });
});

// ---- conversationsMediaEligibility --------------------------------------------------------
describe('conversationsMediaEligibility — batch twin of isConversationMediaEligible', () => {
  const client = (events: Row[], maxRows?: number) => {
    const db = fakeDb({ pancake_webhook_events: events }, { maxRows });
    return { db, supabase: { from: db.from } as unknown as SupabaseClient };
  };

  it('matches the single-row answer for every conversation, windowHours included', async () => {
    const convs = CAPTURES.map((r) => str(r.pancake_conversation_id).trim()).filter(
      Boolean,
    );
    for (const windowHours of [undefined, 1, 72]) {
      const opts = windowHours ? { windowHours } : undefined;
      const { db, supabase } = client(EVENTS);
      const batch = await conversationsMediaEligibility(supabase, convs, opts);
      expect(db.queries).toHaveLength(1);
      for (const c of convs) {
        const single = await isConversationMediaEligible(
          client(EVENTS).supabase,
          c,
          opts,
        );
        expect([c, batch.get(c)]).toEqual([c, single]);
      }
    }
  });

  it('keys every id as passed and returns false without querying when no id has a PSID', async () => {
    const { db, supabase } = client(EVENTS);
    const map = await conversationsMediaEligibility(supabase, ['bad-id', `${PAGE}_`, '']);
    expect([...map.entries()]).toEqual([
      ['bad-id', false],
      [`${PAGE}_`, false],
      ['', false],
    ]);
    expect(db.queries).toHaveLength(0);
  });

  it('re-checks ONLY an undecided PSID alone when the shared limit may have cut off older rows', async () => {
    const X = '2000000000000001'; // 200 recent Live comments — floods the shared limit
    const Y = '2000000000000002'; // one genuine DM, older than all of X's comments
    const Z = '2000000000000003'; // genuine DM, newest of all
    const events = [
      event(Z, dm(Z), secondsAgo(1)),
      ...Array.from({ length: 200 }, (_, i) =>
        event(X, liveComment(X), secondsAgo(10 + i)),
      ),
      event(Y, dm(Y), secondsAgo(3600)),
    ];
    const convs = [conv(X), conv(Y), conv(Z)];
    const { db, supabase } = client(events);
    const batch = await conversationsMediaEligibility(supabase, convs);

    // 1 batch query (limit 150, filled → possibly truncated) + 1 fallback for Y only:
    // X is decided by its own newest 50, Z by its DM already in the batch.
    expect(db.queries.map((q) => [q.ops[0], q.limit])).toEqual([
      ['in facebook_psid', 150],
      ['eq facebook_psid', 50],
    ]);
    for (const c of convs) {
      expect(batch.get(c)).toBe(
        await isConversationMediaEligible(client(events).supabase, c),
      );
    }
    expect(convs.map((c) => batch.get(c))).toEqual([false, true, true]);
  });

  it('detects truncation at the PostgREST max_rows cap too (limit clamps to 1000)', async () => {
    const FLOOD = '5000000000000000'; // 1000 recent Live comments fill max_rows on their own
    const late = Array.from({ length: 20 }, (_, i) => String(5000000000000001 + i));
    const psids = [FLOOD, ...late];
    const events = [
      ...Array.from({ length: 1000 }, (_, i) =>
        event(FLOOD, liveComment(FLOOD), secondsAgo(10 + i)),
      ),
      ...late.map((p, i) => event(p, dm(p), secondsAgo(5000 + i))),
    ];
    const { db, supabase } = client(events);
    const batch = await conversationsMediaEligibility(
      supabase,
      psids.map((p) => conv(p)),
    );
    expect(db.queries[0]?.limit).toBe(1000);
    expect(db.queries).toHaveLength(1 + 20); // the 20 PSIDs pushed out get their own read
    for (const p of psids) {
      expect(batch.get(conv(p))).toBe(
        await isConversationMediaEligible(client(events).supabase, conv(p)),
      );
    }
  });
});
