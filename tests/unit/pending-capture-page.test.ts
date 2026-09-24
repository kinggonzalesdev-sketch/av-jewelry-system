import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The server side of "Capture Pending = Incoming Captures (N)" (Owner 2026-09-24): ONE pending
 * filter for the count and the list, the EXACT total (not the page length), newest-first keyset
 * pages, and only safe values inside PostgREST filter strings.
 */
vi.mock('server-only', () => ({}));

type Call = { table: string; select?: string; options?: unknown; ops: string[]; limit?: number };
const H = vi.hoisted(() => ({ calls: [] as Call[], total: 70, rows: [] as unknown[] }));

function builder(table: string) {
  const call: Call = { table, ops: [] };
  H.calls.push(call);
  const b: Record<string, unknown> = {};
  const op = (name: string) => (...args: unknown[]) => {
    call.ops.push(`${name} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`);
    return b;
  };
  Object.assign(b, {
    select: (cols: string, options?: unknown) => {
      call.select = cols;
      call.options = options;
      return b;
    },
    eq: op('eq'),
    is: op('is'),
    not: op('not'),
    or: op('or'),
    in: op('in'),
    order: op('order'),
    limit: (n: number) => {
      call.limit = n;
      return b;
    },
    then: (ok: (v: unknown) => unknown) => {
      const head = (call.options as { head?: boolean } | undefined)?.head === true;
      const counted = (call.options as { count?: string } | undefined)?.count === 'exact';
      return Promise.resolve({
        data: head ? null : H.rows,
        error: null,
        count: counted ? H.total : null,
      }).then(ok);
    },
  });
  return b;
}

vi.mock('@/lib/authz/guard', () => ({ requirePermission: vi.fn(() => Promise.resolve()) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      from: (t: string) => builder(t),
      storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [] }) }) },
    }),
  ),
}));
vi.mock('@/lib/capture/auto-router', () => ({
  conversationsMediaEligibilitySystem: () => Promise.resolve(new Map()),
}));

import {
  countPendingCaptures,
  listPendingCapturesPage,
  stillPendingCaptureIds,
} from '@/lib/capture/pending';

const PENDING_FILTER = ['eq source floating', 'is official_order_id null', 'is confirmed null'];
const ID = '6d9115f5-33a5-447d-9a32-ac272b553941';
const AT = '2026-09-24T15:06:23.469687+00:00';

beforeEach(() => {
  H.calls = [];
  H.total = 70;
  H.rows = Array.from({ length: 50 }, (_, i) => ({
    id: `id-${i}`,
    captured_at: AT,
    ocr: null,
    customers: null,
  }));
});

describe('one pending definition, exact total', () => {
  it('the pill count and the list use the SAME filter', async () => {
    await countPendingCaptures();
    await listPendingCapturesPage();
    const [count, list] = H.calls.filter((c) => c.table === 'capture_records');
    expect(count?.ops.slice(0, 3)).toEqual(PENDING_FILTER);
    expect(list?.ops.slice(0, 3)).toEqual(PENDING_FILTER);
    expect(count?.options).toEqual({ count: 'exact', head: true });
  });

  it('first page: 50 rows newest first, the EXACT total from the same request (70, not 50)', async () => {
    const page = await listPendingCapturesPage();
    expect(page.rows).toHaveLength(50);
    expect(page.total).toBe(70);
    const list = H.calls.filter((c) => c.table === 'capture_records');
    expect(list).toHaveLength(1); // one request: rows + count together
    expect(list[0]?.options).toEqual({ count: 'exact' });
    expect(list[0]?.ops).toEqual([
      ...PENDING_FILTER,
      'order captured_at {"ascending":false}',
      'order id {"ascending":false}',
    ]);
    expect(list[0]?.limit).toBe(50);
  });

  it('older page: keyset right after the cursor (quoted timestamp), total from a head count', async () => {
    const page = await listPendingCapturesPage({ cursor: { capturedAt: AT, id: ID } });
    expect(page.total).toBe(70);
    const [rows, head] = H.calls.filter((c) => c.table === 'capture_records');
    expect(rows?.ops).toContain(
      `or captured_at.lt."${AT}",and(captured_at.eq."${AT}",id.lt.${ID})`,
    );
    expect(head?.options).toEqual({ count: 'exact', head: true });
    expect(head?.ops).toEqual(PENDING_FILTER);
  });

  it('just-dismissed ids are excluded from rows AND count; malformed ids and cursors never reach a filter', async () => {
    await listPendingCapturesPage({
      excludeIds: [ID, 'x),or(id.gt.0', ID],
      cursor: { capturedAt: 'now),or(1', id: ID },
    });
    const list = H.calls.filter((c) => c.table === 'capture_records');
    expect(list).toHaveLength(1); // the bad cursor was ignored → first page
    expect(list[0]?.ops).toContain(`not id in (${ID})`);
    expect(list[0]?.ops.join(' ')).not.toContain('or(');
  });

  it('the id re-check uses the same filter and only well-formed ids', async () => {
    H.rows = [{ id: ID }];
    const still = await stillPendingCaptureIds([ID, 'not-an-id']);
    expect(still).toEqual([ID]);
    const call = H.calls.find((c) => c.table === 'capture_records');
    expect(call?.ops).toEqual([...PENDING_FILTER, `in id ${JSON.stringify([ID])}`]);
  });
});
