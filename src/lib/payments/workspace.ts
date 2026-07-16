import 'server-only';

import { getOrderBalance } from '@/lib/payments/balances';
import { moneyString, type DateRangeKey } from '@/lib/payments/format';
import { createClient } from '@/lib/supabase/server';

/**
 * Payments & Layaway workspace loaders (Bible §16, §17).
 *
 * Real, database-backed. Every money figure comes from the approved SQL
 * functions (see docs/PHASE-6-APPROVED-DECISIONS.md) — this module never does
 * money arithmetic, because a second implementation could drift from the one the
 * database enforces, and drift decides whether a customer is told they owe money.
 *
 * Money stays a STRING end to end. JS `number` is a float; 0.1 + 0.2 !== 0.3.
 *
 * The counts below deliberately keep evidence and verification apart: a payment
 * that is merely submitted is never counted as collected.
 */

/** Resolves a range to concrete ISO bounds. Server-side: the client cannot widen it. */
export function resolveRange(
  key: DateRangeKey,
  customFrom?: string,
  customTo?: string,
): { start: string; end: string } {
  const now = new Date();
  const end = now.toISOString();

  if (key === 'custom' && customFrom && customTo) {
    return {
      start: new Date(customFrom).toISOString(),
      end: new Date(customTo).toISOString(),
    };
  }

  const start = new Date(now);
  switch (key) {
    case 'today':
      start.setUTCHours(0, 0, 0, 0);
      break;
    case '7d':
      start.setUTCDate(start.getUTCDate() - 6);
      break;
    case '14d':
      start.setUTCDate(start.getUTCDate() - 13);
      break;
    case '30d':
      start.setUTCDate(start.getUTCDate() - 29);
      break;
    case 'month':
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      break;
    default:
      start.setUTCDate(start.getUTCDate() - 29);
  }

  return { start: start.toISOString(), end };
}

export type PaymentStatusBreakdown = Array<{ label: string; value: number }>;

/**
 * Payment Status Breakdown.
 *
 * Evidence Submitted and Awaiting Verification are counted SEPARATELY from
 * Required Payment Verified. Nothing here folds evidence into verified.
 */
export async function paymentStatusBreakdown(range: {
  start: string;
  end: string;
}): Promise<PaymentStatusBreakdown> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('payments')
    .select('id, status, correction_pending, payment_evidence ( id )')
    .gte('recorded_at', range.start)
    .lte('recorded_at', range.end);

  const rows = (data ?? []) as Array<{
    status: string;
    correction_pending: boolean;
    payment_evidence: unknown[];
  }>;

  const withEvidence = rows.filter(
    (r) => r.status === 'submitted_unverified' && (r.payment_evidence?.length ?? 0) > 0,
  ).length;

  const awaiting = rows.filter(
    (r) => r.status === 'submitted_unverified' && (r.payment_evidence?.length ?? 0) === 0,
  ).length;

  return [
    { label: 'Evidence Submitted', value: withEvidence },
    { label: 'Awaiting Verification', value: awaiting },
    {
      label: 'Required Payment Verified',
      value: rows.filter((r) => r.status === 'verified').length,
    },
    {
      label: 'Verification Rejected',
      value: rows.filter((r) => r.status === 'rejected').length,
    },
    {
      label: 'Payment Correction Review',
      value: rows.filter((r) => r.correction_pending).length,
    },
  ];
}

export type LayawayStatusBreakdown = Array<{ label: string; value: number }>;

/** Layaway Status Breakdown, straight from stored statuses. */
export async function layawayStatusBreakdown(): Promise<LayawayStatusBreakdown> {
  const supabase = await createClient();
  const { data } = await supabase.from('layaway_arrangements').select('id, status');

  const rows = (data ?? []) as Array<{ id: string; status: string }>;
  const count = (status: string) => rows.filter((r) => r.status === status).length;

  // "Installment Due" is a readiness condition, not a stored status: an active
  // layaway with an unpaid installment now due.
  const { data: due } = await supabase
    .from('layaway_installments')
    .select('id, layaway_arrangement_id, due_date, payment_id')
    .is('payment_id', null)
    .lte('due_date', new Date().toISOString().slice(0, 10));

  const dueIds = new Set(
    ((due ?? []) as Array<{ layaway_arrangement_id: string }>).map(
      (d) => d.layaway_arrangement_id,
    ),
  );

  return [
    { label: 'Active', value: count('active') },
    {
      label: 'Installment Due',
      value: rows.filter((r) => r.status === 'active' && dueIds.has(r.id)).length,
    },
    { label: 'Overdue', value: count('overdue') },
    { label: 'Grace Period', value: count('grace_period') },
    { label: 'Forfeiture Review', value: count('forfeiture_eligible') },
    { label: 'Completed', value: count('completed') },
  ];
}

export type CollectionPoint = { label: string; verified: string; outstanding: string };

/**
 * Layaway Collection Trend.
 *
 * Plots VERIFIED collection only. Unverified evidence contributes nothing —
 * recording is not verifying, so it is not money collected.
 */
export async function layawayCollectionTrend(range: {
  start: string;
  end: string;
}): Promise<CollectionPoint[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('payments')
    .select('recorded_at, amount, status, voided_at, reversed_at, correction_pending')
    .eq('status', 'verified')
    .is('voided_at', null)
    .is('reversed_at', null)
    .eq('correction_pending', false)
    .gte('recorded_at', range.start)
    .lte('recorded_at', range.end)
    .order('recorded_at', { ascending: true });

  // `amount` is NOT necessarily a string. The cast here used to claim it was,
  // and toCentavos() called .split() on it — which threw
  // "amount.split is not a function" and took down the whole Payments page.
  //
  // It stayed hidden because this loop only runs over VERIFIED payments, and
  // until the first payment was ever verified there was nothing to iterate. The
  // bug was one successful verification away the entire time.
  //
  // moneyString() normalises both shapes without going through a float.
  const rows = (data ?? []) as Array<{ recorded_at: string; amount: unknown }>;

  // Group by day. Amounts are summed as integer centavos so no float touches
  // money on the way to the chart.
  const byDay = new Map<string, bigint>();
  for (const row of rows) {
    const day = row.recorded_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0n) + toCentavos(moneyString(row.amount)));
  }

  return [...byDay.entries()].map(([day, centavos]) => ({
    label: day.slice(5),
    verified: fromCentavos(centavos),
    outstanding: '0.00',
  }));
}

/** Peso string -> integer centavos. Exact; never via a float. */
function toCentavos(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2) || '0');
}

function fromCentavos(centavos: bigint): string {
  const negative = centavos < 0n;
  const abs = negative ? -centavos : centavos;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export type OverviewCards = {
  paymentEvidenceSubmitted: number;
  awaitingVerification: number;
  requiredPaymentVerified: number;
  activeLayaways: number;
  installmentsDue: number;
  overdueOrGrace: number;
  forfeitureReview: number;
  completedLayaways: number;
};

export async function overviewCards(range: {
  start: string;
  end: string;
}): Promise<OverviewCards> {
  const [pay, lay] = await Promise.all([
    paymentStatusBreakdown(range),
    layawayStatusBreakdown(),
  ]);

  const p = (label: string) => pay.find((x) => x.label === label)?.value ?? 0;
  const l = (label: string) => lay.find((x) => x.label === label)?.value ?? 0;

  return {
    paymentEvidenceSubmitted: p('Evidence Submitted'),
    awaitingVerification: p('Awaiting Verification'),
    requiredPaymentVerified: p('Required Payment Verified'),
    activeLayaways: l('Active'),
    installmentsDue: l('Installment Due'),
    overdueOrGrace: l('Overdue') + l('Grace Period'),
    forfeitureReview: l('Forfeiture Review'),
    completedLayaways: l('Completed'),
  };
}

export type EvidenceQueueRow = {
  paymentId: string;
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string;
  customerDisplayName: string;
  amount: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  provider: string | null;
  /** When the evidence was submitted. Not when it was paid, and not verified. */
  recordedAt: string;
  /** Always `submitted_unverified` here — the queue is what awaits a decision. */
  status: string;
  evidenceCount: number;
  /** The reference each evidence row points at. V1 stores a pointer, not a file. */
  evidenceReferences: string[];
  duplicateReference: boolean;
};

/**
 * The queue, or an explicit failure.
 *
 * ⚠️  AN EMPTY QUEUE AND A FAILED READ ARE DIFFERENT FACTS.
 *
 * This function used to return EvidenceQueueRow[] and discard the error:
 *
 *     const [{ data }, duplicates] = await Promise.all([...]);
 *     return ((data ?? []) as unknown[]).map(...);
 *
 * The query was returning PGRST201 (ambiguous embed) on every call. The
 * destructure threw the error away, `data` was null, the map produced [], and
 * the screen said "No payments awaiting verification" — while the overview card
 * beside it counted 1. The queue was not empty; it was broken, and it said
 * "nothing to do".
 *
 * A verification queue that hides money awaiting a decision is worse than one
 * that errors: nobody investigates an empty list.
 */
export type VerificationQueueResult =
  { ok: true; rows: EvidenceQueueRow[] } | { ok: false; reason: string };

/**
 * An Official Order a payment may be recorded against, with the approved money
 * figures already decided by the database.
 */
export type PayableOrderRow = {
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string;
  customerDisplayName: string;
  status: string;
  /** Item total + approved fee/charges − approved discounts. Already a string. */
  totalAmountPayable: string;
  /** Verified payments ONLY. Evidence never counts here. */
  verifiedNetPayments: string;
  /** max(payable − verified, 0). Never negative. */
  outstandingBalance: string;
  /** The verified excess when payments exceed the payable amount. */
  overpaymentCredit: string;
  paidInFull: boolean;
  /**
   * Set when the balance could NOT be read. The money fields are meaningless in
   * that case and the UI must say so rather than render a zero — a denied read
   * that displays ₱0.00 reads as "nothing is owed".
   */
  balanceUnavailable: string | null;
};

/**
 * Official Orders a payment can be recorded against (Bible §16).
 *
 * Cancelled orders are excluded — recording a payment against a cancelled order
 * is not a money decision the UI should offer. Paid-in-full orders are KEPT:
 * an overpayment is a real event that must be recordable and flagged, never
 * silently prevented (approved decision §4).
 *
 * Every peso figure comes from `order_balance()`. This function does no money
 * arithmetic; a second implementation in TypeScript could drift from the SQL the
 * database enforces.
 */
export async function listPayableOrders(limit = 50): Promise<PayableOrderRow[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('official_orders')
    .select('id, order_number, invoice_number, status, customers ( display_name )')
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown[];

  // Reuses getOrderBalance() rather than calling order_balance() again here.
  // The first draft of this function re-issued the RPC itself and silently
  // rendered every figure as ₱0.00 — the shape it expected back was wrong, and
  // moneyString()'s fallback turned that into a plausible-looking zero instead
  // of an error. A balance that reads ₱0.00 when ₱6,000 is owed is the worst
  // kind of wrong: it looks like an answer. The tested reader is the only
  // reader.
  const balances = await Promise.all(
    rows.map((row) => getOrderBalance((row as Record<string, unknown>).id as string)),
  );

  return rows.map((row, index) => {
    const r = row as Record<string, unknown>;
    const customer = one<{ display_name: string }>(r.customers);
    const result = balances[index];

    const base = {
      officialOrderId: r.id as string,
      orderNumber: (r.order_number as string | null) ?? '—',
      invoiceNumber: (r.invoice_number as string | null) ?? '—',
      customerDisplayName: customer?.display_name ?? 'Unknown',
      status: (r.status as string | null) ?? 'unknown',
    };

    // A failed read is reported as unavailable, never as zero. The empty strings
    // below are never rendered: the UI branches on balanceUnavailable first.
    if (!result || !result.ok) {
      return {
        ...base,
        totalAmountPayable: '',
        verifiedNetPayments: '',
        outstandingBalance: '',
        overpaymentCredit: '',
        paidInFull: false,
        balanceUnavailable: result?.reason ?? 'The balance could not be read.',
      };
    }

    return {
      ...base,
      totalAmountPayable: result.balance.totalAmountPayable,
      verifiedNetPayments: result.balance.verifiedNetPayments,
      outstandingBalance: result.balance.outstandingBalance,
      overpaymentCredit: result.balance.overpaymentCredit,
      paidInFull: result.balance.paidInFull,
      balanceUnavailable: null,
    };
  });
}

/**
 * Payment Verification queue: submitted payments awaiting a human decision.
 * Recording is not verifying — these count toward nothing until verified.
 */
export async function paymentVerificationQueue(): Promise<VerificationQueueResult> {
  const supabase = await createClient();

  const [queue, duplicates] = await Promise.all([
    supabase
      .from('payments')
      .select(
        // The FK is named explicitly, and MUST be. `payments` has TWO foreign
        // keys to `official_orders` — official_order_id and
        // reassigned_from_order_id (Phase 6 wrong-payment correction) — so a
        // bare `official_orders(...)` embed is ambiguous and PostgREST refuses
        // the whole request with PGRST201. That is what emptied this queue.
        //
        // Naming the constraint also pins the MEANING: this row is the order the
        // payment is FOR, never the order it was reassigned away from. An embed
        // that silently resolved to the other FK would attribute a payment to
        // the wrong order — which is exactly why PostgREST refuses to guess.
        `id, official_order_id, amount, payment_method, reference_number, provider,
         recorded_at, status,
         payment_evidence ( id, storage_path ),
         official_orders!payments_official_order_id_fkey (
           order_number, invoice_number, customers ( display_name )
         )`,
      )
      .eq('status', 'submitted_unverified')
      .is('voided_at', null)
      .order('recorded_at', { ascending: true })
      .limit(50),
    supabase.rpc('duplicate_payment_references'),
  ]);

  // The error is handled, not discarded. An unreadable queue reports itself.
  if (queue.error) {
    return { ok: false, reason: queue.error.message };
  }

  const dupeRefs = new Set(
    ((duplicates.data ?? []) as Array<{ reference_number: string }>).map(
      (d) => d.reference_number,
    ),
  );

  const rows = ((queue.data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const order = one<{
      order_number: string;
      invoice_number: string;
      customers: unknown;
    }>(r.official_orders);
    const customer = one<{ display_name: string }>(order?.customers);
    const evidence = ((r.payment_evidence as unknown[]) ?? []) as Array<{
      storage_path: string | null;
    }>;

    return {
      paymentId: r.id as string,
      officialOrderId: r.official_order_id as string,
      orderNumber: order?.order_number ?? '—',
      invoiceNumber: order?.invoice_number ?? '—',
      customerDisplayName: customer?.display_name ?? 'Unknown',
      amount: moneyString(r.amount),
      paymentMethod: (r.payment_method as string | null) ?? null,
      referenceNumber: (r.reference_number as string | null) ?? null,
      provider: (r.provider as string | null) ?? null,
      recordedAt: r.recorded_at as string,
      status: r.status as string,
      evidenceCount: evidence.length,
      evidenceReferences: evidence
        .map((e) => e.storage_path)
        .filter((p): p is string => typeof p === 'string'),
      duplicateReference:
        r.reference_number !== null && dupeRefs.has(r.reference_number as string),
    };
  });

  return { ok: true, rows };
}

export type LayawayRow = {
  layawayId: string;
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string;
  customerDisplayName: string;
  status: string;
  months: number | null;
  totalGrams: string | null;
  layawayFee: string | null;
  finalDueDate: string | null;
  graceEndsOn: string | null;
  completedAt: string | null;
  totalAmountPayable: string;
  verifiedNetPayments: string;
  outstandingBalance: string;
  overpaymentCredit: string;
  requiredDownPayment: string;
  paidInFull: boolean;
  hasUnresolvedCorrection: boolean;
  installments: Array<{
    number: number;
    dueDate: string;
    amountDue: string;
    paid: boolean;
    verified: boolean;
  }>;
};

/**
 * Loads layaway accounts with their approved balance figures.
 *
 * Balances come from public.order_balance() — the same functions the completion
 * guard uses, so the screen can never disagree with the database about whether
 * an account is settled.
 */
export async function listLayaways(statuses?: string[]): Promise<LayawayRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('layaway_arrangements')
    .select(
      `id, official_order_id, status, months, total_grams, layaway_fee,
       final_due_date, grace_period_days, completed_at,
       official_orders ( order_number, invoice_number, customers ( display_name ) ),
       layaway_installments ( installment_number, due_date, amount_due, payment_id )`,
    )
    .order('created_at', { ascending: false })
    .limit(50);

  if (statuses?.length) query = query.in('status', statuses);

  const { data } = await query;
  if (!data) return [];

  return Promise.all(
    (data as unknown[]).map(async (row) => {
      const r = row as Record<string, unknown>;
      const orderId = r.official_order_id as string;
      const order = one<{
        order_number: string;
        invoice_number: string;
        customers: unknown;
      }>(r.official_orders);
      const customer = one<{ display_name: string }>(order?.customers);

      const balanceResponse = await supabase.rpc('order_balance', {
        p_order_id: orderId,
      });
      const b = (balanceResponse.data ?? {}) as Record<string, unknown>;

      const installmentRows = ((r.layaway_installments as unknown[]) ?? []) as Array<{
        installment_number: number;
        due_date: string;
        amount_due: string;
        payment_id: string | null;
      }>;

      // Which installment payments are actually VERIFIED. Recording an
      // installment against a payment does not verify that payment (§17).
      const paymentIds = installmentRows
        .map((i) => i.payment_id)
        .filter((id): id is string => id !== null);

      const verifiedIds = new Set<string>();
      if (paymentIds.length > 0) {
        const { data: verified } = await supabase
          .from('payments')
          .select('id')
          .in('id', paymentIds)
          .eq('status', 'verified');
        for (const v of (verified ?? []) as Array<{ id: string }>) verifiedIds.add(v.id);
      }

      const { data: corrections } = await supabase
        .from('payments')
        .select('id')
        .eq('official_order_id', orderId)
        .eq('correction_pending', true)
        .limit(1);

      const graceDays = (r.grace_period_days as number) ?? 10;
      const finalDue = (r.final_due_date as string | null) ?? null;

      return {
        layawayId: r.id as string,
        officialOrderId: orderId,
        orderNumber: order?.order_number ?? '—',
        invoiceNumber: order?.invoice_number ?? '—',
        customerDisplayName: customer?.display_name ?? 'Unknown',
        status: r.status as string,
        months: (r.months as number | null) ?? null,
        totalGrams: r.total_grams !== null ? moneyString(r.total_grams, '0') : null,
        layawayFee: r.layaway_fee !== null ? moneyString(r.layaway_fee) : null,
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

/** Grace ends N calendar days after the final due date (approved decision §6). */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PaymentHistoryRow = {
  paymentId: string;
  orderNumber: string;
  customerDisplayName: string;
  amount: string;
  verifiedAmount: string | null;
  status: string;
  paymentMethod: string | null;
  referenceNumber: string | null;
  recordedAt: string;
  voided: boolean;
  reversed: boolean;
  correctionPending: boolean;
};

/** Payment History: every payment, with the disqualifying states kept visible. */
export async function paymentHistory(range: {
  start: string;
  end: string;
}): Promise<PaymentHistoryRow[]> {
  const supabase = await createClient();

  // Same ambiguity as the verification queue: `payments` has two FKs to
  // `official_orders`, so the embed must name the one that means "the order this
  // payment is for". Without it PostgREST refuses with PGRST201 and the Payment
  // History tab renders empty — silently, exactly as the queue did.
  const { data, error } = await supabase
    .from('payments')
    .select(
      `id, amount, status, payment_method, reference_number, recorded_at,
       voided_at, reversed_at, correction_pending,
       payment_verifications ( verified_amount ),
       official_orders!payments_official_order_id_fkey (
         order_number, customers ( display_name )
       )`,
    )
    .gte('recorded_at', range.start)
    .lte('recorded_at', range.end)
    .order('recorded_at', { ascending: false })
    .limit(100);

  // History is a read-only report: an unreadable one is reported to the server
  // log rather than silently shown as "no payments", which would read as
  // "nothing was ever collected".
  if (error) {
    console.error('paymentHistory read failed:', error.message);
  }

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    const order = one<{ order_number: string; customers: unknown }>(r.official_orders);
    const customer = one<{ display_name: string }>(order?.customers);
    const verification = one<{ verified_amount: string | null }>(r.payment_verifications);

    return {
      paymentId: r.id as string,
      orderNumber: order?.order_number ?? '—',
      customerDisplayName: customer?.display_name ?? 'Unknown',
      amount: moneyString(r.amount),
      verifiedAmount: verification?.verified_amount
        ? moneyString(verification.verified_amount)
        : null,
      status: r.status as string,
      paymentMethod: (r.payment_method as string | null) ?? null,
      referenceNumber: (r.reference_number as string | null) ?? null,
      recordedAt: r.recorded_at as string,
      voided: r.voided_at !== null,
      reversed: r.reversed_at !== null,
      correctionPending: r.correction_pending === true,
    };
  });
}

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

// Re-exported so server callers have one import site.
export { moneyString, RANGE_LABEL, type DateRangeKey } from '@/lib/payments/format';
