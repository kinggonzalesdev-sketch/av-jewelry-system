import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate the readers from next/headers: every read goes through this fake client.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { getOrderBalances } from '@/lib/payments/balances';
import { moneyString } from '@/lib/payments/format';
import {
  arrangementRowsByIds,
  layawayStatusBreakdown,
  listLayaways,
  type LayawayRow,
} from '@/lib/payments/workspace';
import { createClient } from '@/lib/supabase/server';

/**
 * The Layaway page issued ~300 round-trips per render: mapArrangementRows awaited
 * order_balance, order_item_total, a "verified payments" read and a "corrections" read
 * FOR EVERY ROW, and it runs twice per render (listLayaways + the first page).
 *
 * These tests pin the batched mapper to (a) a call count that no longer grows with the
 * rows — except the per-order item total, which has no batch reader — and (b) output
 * that is byte-for-byte what the pre-batching mapper produced for the same data.
 */

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | null; error: null };

type Calls = {
  from: string[];
  rpc: string[];
  lte: Array<[string, string]>;
  ins: Array<{ table: string; col: string; size: number }>;
};

type FakeDb = {
  tables: Partial<Record<string, Row[]>>;
  /** order id → order_balance() jsonb. Absent = the per-order function fails. */
  balances: Partial<Record<string, Row>>;
  /** order id → order_item_total(). Absent = the RPC returns null. */
  itemTotals: Partial<Record<string, unknown>>;
};

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** A PostgREST-shaped query over an in-memory table, recording what it was asked. */
class FakeQuery implements PromiseLike<QueryResult> {
  private rows: Row[];
  private cap: number | null = null;
  private readonly table: string;
  private readonly calls: Calls;

  constructor(table: string, rows: Row[], calls: Calls) {
    this.table = table;
    this.rows = rows;
    this.calls = calls;
  }

  select(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(n: number): this {
    this.cap = n;
    return this;
  }
  in(col: string, vals: unknown[]): this {
    this.calls.ins.push({ table: this.table, col, size: vals.length });
    this.rows = this.rows.filter((r) => vals.includes(r[col]));
    return this;
  }
  eq(col: string, val: unknown): this {
    this.rows = this.rows.filter((r) => r[col] === val);
    return this;
  }
  is(col: string, val: unknown): this {
    this.rows = this.rows.filter((r) => (r[col] ?? null) === val);
    return this;
  }
  lte(col: string, val: string): this {
    this.calls.lte.push([col, val]);
    this.rows = this.rows.filter((r) => String(r[col]) <= val);
    return this;
  }
  then<A = QueryResult, B = never>(
    onFulfilled?: ((value: QueryResult) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    const rows = this.cap === null ? this.rows : this.rows.slice(0, this.cap);
    return Promise.resolve<QueryResult>({ data: clone(rows), error: null }).then(
      onFulfilled,
      onRejected,
    );
  }
}

function fakeClient(db: FakeDb) {
  const calls: Calls = { from: [], rpc: [], lte: [], ins: [] };
  const client = {
    from(table: string) {
      calls.from.push(table);
      return new FakeQuery(table, [...(db.tables[table] ?? [])], calls);
    },
    rpc(name: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
      calls.rpc.push(name);
      return Promise.resolve(rpcResult(db, name, args));
    },
  };
  return { client, calls };
}

type RpcResult = { data: unknown; error: { message: string } | null };

function rpcResult(db: FakeDb, name: string, args: Record<string, unknown>): RpcResult {
  if (name === 'order_balance') {
    const balance = db.balances[args.p_order_id as string];
    return balance === undefined
      ? { data: null, error: { message: 'order_balance failed' } }
      : { data: clone(balance), error: null };
  }
  if (name === 'order_balances') {
    return {
      data: (args.p_order_ids as string[]).map((id) => ({
        order_id: id,
        // order_balances() yields a NULL balance for an order whose balance throws.
        balance: clone(db.balances[id] ?? null),
      })),
      error: null,
    };
  }
  if (name === 'order_item_total') {
    return { data: db.itemTotals[args.p_order_id as string] ?? null, error: null };
  }
  return { data: null, error: { message: `unexpected rpc ${name}` } };
}

type FakeClient = ReturnType<typeof fakeClient>['client'];

function serveClient(client: FakeClient) {
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
}

function countBy(names: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of names) out[n] = (out[n] ?? 0) + 1;
  return out;
}

const STATUSES = [
  'active',
  'overdue',
  'grace_period',
  'forfeiture_eligible',
  'completed',
];

/**
 * N arrangements whose rows cycle through every branch the mapper has: failed and
 * numeric balances (with a NULL figure), missing item totals, verified / unverified /
 * unpaid installments out of order, pending corrections (twice on one order),
 * single / multi / duplicate / missing inventory codes, array-or-object embeds, and
 * null customers, financers, fees, grams, due dates and grace days.
 */
function makeDb(n: number): { db: FakeDb; arrangements: Row[]; ids: string[] } {
  const arrangements: Row[] = [];
  const claims: Row[] = [];
  const payments: Row[] = [];
  const balances: Partial<Record<string, Row>> = {};
  const itemTotals: Partial<Record<string, unknown>> = {};

  for (let i = 0; i < n; i++) {
    const oid = `order-${i}`;
    const verifiedPay = `pay-v-${i}`;
    const unverifiedPay = `pay-u-${i}`;

    arrangements.push({
      id: `lay-${i}`,
      official_order_id: oid,
      status: STATUSES[i % STATUSES.length],
      months: i % 3 === 0 ? null : 3,
      total_grams: i % 4 === 0 ? null : i % 2 ? 12.5 : '7.25',
      layaway_fee: i % 5 === 0 ? null : '150.00',
      created_at: `2026-0${(i % 9) + 1}-10T02:00:00Z`,
      final_due_date: i % 6 === 0 ? null : '2026-10-31',
      grace_period_days: i % 7 === 0 ? null : 15,
      completed_at: null,
      layaway_code: i % 3 === 1 ? null : `A${i + 1}`,
      financer_id: i % 2 ? `fin-${i}` : null,
      current_holder: i % 2 ? 'Vault' : null,
      current_location: null,
      remarks: i % 4 === 2 ? 'Financer: Lalyn' : null,
      financers: i % 2 ? { name: 'Lalyn' } : null,
      official_orders:
        i % 8 === 0
          ? [{ order_number: `OR-${i}`, invoice_number: null, customers: null }]
          : {
              order_number: `OR-${i}`,
              invoice_number: `INV-${i}`,
              customers: [
                {
                  display_name: `Customer ${i}`,
                  facebook_conversation_url: i % 3 ? null : `https://m.me/${i}`,
                },
              ],
            },
      // Deliberately out of order: the mapper sorts by installment_number.
      layaway_installments: [
        {
          installment_number: 3,
          due_date: '2026-10-31',
          amount_due: '500.00',
          payment_id: null,
        },
        {
          installment_number: 1,
          due_date: '2026-08-31',
          amount_due: 500,
          payment_id: verifiedPay,
        },
        {
          installment_number: 2,
          due_date: '2026-09-30',
          amount_due: '500.00',
          payment_id: i % 2 ? unverifiedPay : null,
        },
      ],
    });

    payments.push({
      id: verifiedPay,
      official_order_id: oid,
      status: 'verified',
      correction_pending: false,
    });
    payments.push({
      id: unverifiedPay,
      official_order_id: oid,
      status: 'submitted_unverified',
      correction_pending: i % 3 === 0,
    });
    // A SECOND pending correction on the same order must still read as one flag.
    if (i % 3 === 0) {
      payments.push({
        id: `pay-c-${i}`,
        official_order_id: oid,
        status: 'verified',
        correction_pending: true,
      });
    }

    if (i % 7 !== 3) {
      claims.push({
        official_order_id: oid,
        claims: { inventory_items: { item_code: `AV${i}` } },
      });
      if (i % 2 === 0) {
        claims.push({
          official_order_id: oid,
          claims: [{ inventory_items: [{ item_code: `AV${i}-B` }] }],
        });
        claims.push({
          official_order_id: oid,
          claims: { inventory_items: { item_code: `AV${i}` } },
        });
      }
    }

    if (i % 5 !== 4) {
      balances[oid] =
        i % 4 === 1
          ? {
              total_amount_payable: 10150,
              verified_net_payments: 500.5,
              outstanding_balance: 9649.5,
              overpayment_credit: 0,
              paid_in_full: false,
              layaway_amount_payable: 10150,
              required_down_payment: null,
            }
          : {
              total_amount_payable: '10150.00',
              verified_net_payments: '500.00',
              outstanding_balance: '9650.00',
              overpayment_credit: '0.00',
              paid_in_full: i % 9 === 0,
              layaway_amount_payable: '10150.00',
              required_down_payment: '1000.00',
            };
    }
    if (i % 6 !== 5) itemTotals[oid] = i % 2 ? 10000 : '10000.00';
  }

  return {
    db: {
      tables: {
        layaway_arrangements: arrangements,
        official_order_claims: claims,
        payments,
      },
      balances,
      itemTotals,
    },
    arrangements,
    ids: arrangements.map((a) => a.id as string),
  };
}

// ── The mapper as it was at df4fbd6, before batching — kept VERBATIM as the oracle. ──

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function legacyMapArrangementRows(
  supabase: FakeClient,
  data: unknown[],
): Promise<LayawayRow[]> {
  const orderIds = [
    ...new Set(
      (data as Array<Record<string, unknown>>)
        .map((r) => r.official_order_id as string)
        .filter((v): v is string => Boolean(v)),
    ),
  ];
  const codeByOrder = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: claimRows } = await supabase
      .from('official_order_claims')
      .select()
      .in('official_order_id', orderIds);
    for (const cr of (claimRows ?? []) as Array<Record<string, unknown>>) {
      const oid = cr.official_order_id as string;
      const claim = one<{ inventory_items: unknown }>(cr.claims);
      const inv = one<{ item_code: string }>(claim?.inventory_items);
      const code = inv?.item_code;
      if (code) {
        const existing = codeByOrder.get(oid);
        if (!existing) codeByOrder.set(oid, code);
        else if (!existing.split(', ').includes(code)) {
          codeByOrder.set(oid, `${existing}, ${code}`);
        }
      }
    }
  }

  return Promise.all(
    data.map(async (row) => {
      const r = row as Record<string, unknown>;
      const orderId = r.official_order_id as string;
      const order = one<{
        order_number: string;
        invoice_number: string;
        customers: unknown;
      }>(r.official_orders);
      const customer = one<{
        display_name: string;
        facebook_conversation_url: string | null;
      }>(order?.customers);
      const financer = one<{ name: string }>(r.financers);

      const balanceResponse = await supabase.rpc('order_balance', {
        p_order_id: orderId,
      });
      const b = (balanceResponse.data ?? {}) as Record<string, unknown>;

      const itemTotalResponse = await supabase.rpc('order_item_total', {
        p_order_id: orderId,
      });

      const installmentRows = ((r.layaway_installments as unknown[]) ?? []) as Array<{
        installment_number: number;
        due_date: string;
        amount_due: string;
        payment_id: string | null;
      }>;

      const paymentIds = installmentRows
        .map((i) => i.payment_id)
        .filter((id): id is string => id !== null);

      const verifiedIds = new Set<string>();
      if (paymentIds.length > 0) {
        const { data: verified } = await supabase
          .from('payments')
          .select()
          .in('id', paymentIds)
          .eq('status', 'verified');
        for (const v of (verified ?? []) as Array<{ id: string }>) verifiedIds.add(v.id);
      }

      const { data: corrections } = await supabase
        .from('payments')
        .select()
        .eq('official_order_id', orderId)
        .eq('correction_pending', true)
        .limit(1);

      const graceDays = (r.grace_period_days as number) ?? 10;
      const finalDue = (r.final_due_date as string | null) ?? null;

      return {
        layawayId: r.id as string,
        code: (r.layaway_code as string | null) ?? null,
        officialOrderId: orderId,
        orderNumber: order?.order_number ?? '—',
        invoiceNumber: order?.invoice_number ?? '—',
        uniqueCode: codeByOrder.get(orderId) ?? null,
        customerDisplayName: customer?.display_name ?? 'Unknown',
        facebookUrl: customer?.facebook_conversation_url ?? null,
        status: r.status as string,
        financer: financer?.name ?? null,
        financerId: (r.financer_id as string | null) ?? null,
        currentHolder: (r.current_holder as string | null) ?? null,
        currentLocation: (r.current_location as string | null) ?? null,
        remarks: (r.remarks as string | null) ?? null,
        months: (r.months as number | null) ?? null,
        totalGrams: r.total_grams !== null ? moneyString(r.total_grams, '0') : null,
        layawayFee: r.layaway_fee !== null ? moneyString(r.layaway_fee) : null,
        itemAmount: moneyString(itemTotalResponse.data ?? 0),
        datePurchased: (r.created_at as string | null) ?? null,
        finalDueDate: finalDue,
        graceEndsOn: finalDue ? addDays(finalDue, graceDays) : null,
        completedAt: (r.completed_at as string | null) ?? null,
        totalAmountPayable: moneyString(b.total_amount_payable),
        verifiedNetPayments: moneyString(b.verified_net_payments),
        outstandingBalance: moneyString(b.outstanding_balance),
        overpaymentCredit: moneyString(b.overpayment_credit),
        requiredDownPayment: moneyString(b.required_down_payment),
        paidInFull: b.paid_in_full === true,
        hasUnresolvedCorrection: (corrections?.length ?? 0) > 0,
        installments: installmentRows
          .sort((a, z) => a.installment_number - z.installment_number)
          .map((i) => ({
            number: i.installment_number,
            dueDate: i.due_date,
            amountDue: String(i.amount_due),
            paid: i.payment_id !== null,
            verified: i.payment_id !== null && verifiedIds.has(i.payment_id),
          })),
      };
    }),
  );
}

async function legacyRows(db: FakeDb, arrangements: Row[]) {
  const legacy = fakeClient(db);
  const rows = await legacyMapArrangementRows(legacy.client, clone(arrangements));
  return { rows, calls: legacy.calls };
}

beforeEach(() => vi.clearAllMocks());

describe('mapArrangementRows — batched reads, identical rows', () => {
  it('arrangementRowsByIds maps a 20-row fixture exactly as the pre-batching mapper did', async () => {
    const { db, arrangements, ids } = makeDb(20);
    const expected = await legacyRows(db, arrangements);

    const current = fakeClient(db);
    serveClient(current.client);
    const actual = await arrangementRowsByIds(ids);

    expect(actual).toHaveLength(20);
    expect(actual).toStrictEqual(expected.rows);

    // The fixture really exercises the branches it claims to (not a vacuous equality).
    expect(actual.some((r) => r.hasUnresolvedCorrection)).toBe(true);
    expect(actual.some((r) => !r.hasUnresolvedCorrection)).toBe(true);
    expect(actual.some((r) => r.installments.some((i) => i.paid && !i.verified))).toBe(
      true,
    );
    expect(actual.some((r) => r.installments.some((i) => i.verified))).toBe(true);
    expect(actual.some((r) => r.uniqueCode?.includes(', '))).toBe(true);
    expect(actual.some((r) => r.uniqueCode === null)).toBe(true);
    expect(actual.some((r) => r.itemAmount === '0.00')).toBe(true);
    expect(actual.some((r) => r.itemAmount === '10000.00')).toBe(true);
    expect(actual.find((r) => r.layawayId === 'lay-4')?.totalAmountPayable).toBe('0.00');
    expect(actual.find((r) => r.layawayId === 'lay-1')?.verifiedNetPayments).toBe(
      '500.50',
    );
    expect(actual.find((r) => r.layawayId === 'lay-1')?.requiredDownPayment).toBe('0.00');
    expect(actual[0]?.installments.map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it('listLayaways (status filter, 50-row cap) maps exactly as the pre-batching mapper did', async () => {
    const statuses = ['active', 'overdue', 'grace_period', 'forfeiture_eligible'];
    const { db, arrangements } = makeDb(70);
    const listed = arrangements
      .filter((a) => statuses.includes(a.status as string))
      .slice(0, 50);
    const expected = await legacyRows(db, listed);

    const current = fakeClient(db);
    serveClient(current.client);
    const actual = await listLayaways(statuses);

    expect(actual).toHaveLength(50);
    expect(actual).toStrictEqual(expected.rows);
  });

  it('the call count for 1 row and 20 rows is the same, except the per-order item total', async () => {
    async function callsFor(n: number) {
      const { db, ids } = makeDb(n);
      const current = fakeClient(db);
      serveClient(current.client);
      await arrangementRowsByIds(ids);
      return { from: countBy(current.calls.from), rpc: countBy(current.calls.rpc) };
    }

    const one = await callsFor(1);
    const twenty = await callsFor(20);

    const fixedReads = {
      layaway_arrangements: 1,
      official_order_claims: 1,
      payments: 2, // verified installment payments + pending corrections, all rows at once
    };
    expect(one.from).toEqual(fixedReads);
    expect(twenty.from).toEqual(fixedReads);
    expect(one.rpc).toEqual({ order_balances: 1, order_item_total: 1 });
    expect(twenty.rpc).toEqual({ order_balances: 1, order_item_total: 20 });
    // No per-row balance RPC any more.
    expect(twenty.rpc.order_balance).toBeUndefined();

    // Before: four awaited reads per row. 20 rows = 1 + 80 (plus the arrangement read).
    const { db, arrangements } = makeDb(20);
    const before = await legacyRows(db, arrangements);
    expect(countBy(before.calls.rpc)).toEqual({
      order_balance: 20,
      order_item_total: 20,
    });
    expect(countBy(before.calls.from)).toEqual({
      official_order_claims: 1,
      payments: 40,
    });
  });

  it('chunks a very large batch so no .in() list exceeds 100 ids — rows still identical', async () => {
    const { db, arrangements, ids } = makeDb(130);
    const expected = await legacyRows(db, arrangements);

    const current = fakeClient(db);
    serveClient(current.client);
    const actual = await arrangementRowsByIds(ids);

    expect(actual).toStrictEqual(expected.rows);
    const paymentReads = current.calls.ins.filter((c) => c.table === 'payments');
    // 195 paid installment ids → 2 reads; 130 order ids → 2 reads.
    expect(paymentReads.map((c) => [c.col, c.size])).toEqual([
      ['id', 100],
      ['id', 95],
      ['official_order_id', 100],
      ['official_order_id', 30],
    ]);
    expect(countBy(current.calls.rpc)).toEqual({
      order_balances: 1,
      order_item_total: 130,
    });
  });

  it('empty id list reads nothing', async () => {
    const current = fakeClient({ tables: {}, balances: {}, itemTotals: {} });
    serveClient(current.client);
    expect(await arrangementRowsByIds([])).toEqual([]);
    expect(current.calls.from).toEqual([]);
    expect(current.calls.rpc).toEqual([]);
  });
});

describe('getOrderBalances — unchanged by the raw-payload refactor', () => {
  it('one order_balances round-trip; a null or incomplete balance is unavailable, never zero', async () => {
    const current = fakeClient({
      tables: {},
      balances: {
        good: {
          total_amount_payable: '100.00',
          verified_net_payments: 40,
          outstanding_balance: '60.00',
          overpayment_credit: '0.00',
          paid_in_full: false,
          layaway_amount_payable: '100.00',
          required_down_payment: '20.00',
        },
        partial: { total_amount_payable: '100.00' },
      },
      itemTotals: {},
    });
    serveClient(current.client);

    const out = await getOrderBalances(['good', 'missing', 'partial']);

    expect(current.calls.rpc).toEqual(['order_balances']);
    expect(out.get('good')).toEqual({
      ok: true,
      balance: {
        totalAmountPayable: '100.00',
        verifiedNetPayments: '40',
        outstandingBalance: '60.00',
        overpaymentCredit: '0.00',
        paidInFull: false,
        layawayAmountPayable: '100.00',
        requiredDownPayment: '20.00',
      },
    });
    expect(out.get('missing')).toEqual({
      ok: false,
      reason: 'That order has no balance record.',
    });
    expect(out.get('partial')).toEqual({
      ok: false,
      reason: 'The balance is incomplete (verified_net_payments is missing).',
    });
  });

  it('a whole-call failure returns an empty map (every row then reads as unavailable)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    vi.mocked(createClient).mockResolvedValue({ rpc } as unknown as Awaited<
      ReturnType<typeof createClient>
    >);
    expect((await getOrderBalances(['a', 'b'])).size).toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('layawayStatusBreakdown — "Installment Due" uses the Asia/Manila business date', () => {
  afterEach(() => vi.useRealTimers());

  function breakdownDb(): FakeDb {
    return {
      tables: {
        layaway_arrangements: [{ id: 'lay-1', status: 'active' }],
        layaway_installments: [
          {
            id: 'i-1',
            layaway_arrangement_id: 'lay-1',
            due_date: '2026-09-15',
            payment_id: null,
          },
        ],
      },
      balances: {},
      itemTotals: {},
    };
  }

  it('01:30 in Manila (still 17:30 the day before in UTC): an installment due today counts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-14T17:30:00Z'));
    const current = fakeClient(breakdownDb());
    serveClient(current.client);

    const out = await layawayStatusBreakdown();

    // A UTC date would have been '2026-09-14' and missed the installment entirely.
    expect(current.calls.lte).toEqual([['due_date', '2026-09-15']]);
    expect(out.find((x) => x.label === 'Installment Due')?.value).toBe(1);
  });

  it('the Manila day rolls over at Manila midnight, not UTC midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-15T15:59:59Z')); // 23:59:59 Manila, Sep 15
    const lastMinute = fakeClient(breakdownDb());
    serveClient(lastMinute.client);
    await layawayStatusBreakdown();
    expect(lastMinute.calls.lte).toEqual([['due_date', '2026-09-15']]);

    vi.setSystemTime(new Date('2026-09-15T16:00:00Z')); // 00:00 Manila, Sep 16
    const nextDay = fakeClient(breakdownDb());
    serveClient(nextDay.client);
    await layawayStatusBreakdown();
    expect(nextDay.calls.lte).toEqual([['due_date', '2026-09-16']]);
  });
});
