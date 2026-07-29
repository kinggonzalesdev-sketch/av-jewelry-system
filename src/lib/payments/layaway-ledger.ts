import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Imported layaway ledger (Owner request). A FLAT list of existing layaway
 * accounts imported from a spreadsheet, shown in Layaway Accounts. Deliberately
 * separate from the order-derived layaway/money machinery — it creates no orders,
 * arrangements, or payments, so existing calculations and workflows are untouched.
 *
 * Money crosses as STRINGS end to end; Postgres numeric is exact.
 */

export type LayawayLedgerRow = {
  id: string;
  /** Reusable short code (A1–Z200) for active accounts; null once released. */
  code: string | null;
  accountNo: string;
  customerName: string;
  status: string; // 'active' | 'completed'
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  balanceMismatch: boolean;
  nextDueDate: string | null;
  /** Date of the newest recorded payment — the completion date once fully paid. */
  lastPaymentDate: string | null;
  createdAt: string;
};

export type LayawayLedgerDetail = {
  id: string;
  code: string | null;
  accountNo: string;
  customerName: string;
  status: string;
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  balanceMismatch: boolean;
  nextDueDate: string | null;
  monthlyInterest: string | null;
  totalInstallmentInterest: string | null;
  lastPaymentDate: string | null;
  modeOfPayment: string | null;
  latestPaymentDp: string | null;
  resize: string | null;
  screw: string | null;
  notes: string | null;
  interestType: string | null;
  layawayTerm: number | null;
  interestRate: string | null;
  fixedInterest: string | null;
  installments: Array<{
    sequence: number;
    dueDate: string | null;
    interest: string | null;
    expectedDp: string | null;
    status: string | null;
  }>;
  payments: Array<{
    sequence: number;
    paymentDate: string | null;
    amount: string | null;
    mop: string | null;
    reference: string | null;
    /** Staff who recorded the payment (Received By), when known. */
    receivedBy: string | null;
  }>;
};

export type LayawayLedgerInstallmentInput = {
  dueDate: string | null;
  interest: string | null;
  expectedDp: string | null;
  status: string | null;
  sourcePosition: number | null;
};
export type LayawayLedgerPaymentInput = {
  paymentDate: string | null;
  amount: string | null;
  mop: string | null;
  reference: string | null;
  sourcePosition: number | null;
};

export type LayawayLedgerInput = {
  /** The account's original Code (A1…), when present. */
  code: string | null;
  customerName: string;
  status: string;
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  balanceMismatch: boolean;
  // Expanded / derived fields.
  nextDueDate: string | null;
  monthlyInterest: string | null;
  totalInstallmentInterest: string | null;
  lastPaymentDate: string | null;
  modeOfPayment: string | null;
  latestPaymentDp: string | null;
  resize: string | null;
  screw: string | null;
  notes: string | null;
  interestType: string | null;
  layawayTerm: number | null;
  interestRate: string | null;
  fixedInterest: string | null;
  installments: LayawayLedgerInstallmentInput[];
  payments: LayawayLedgerPaymentInput[];
};

export type LedgerImportResult =
  | { ok: true; inserted: number; skipped: number; installments: number; payments: number }
  | { ok: false; error: string };

export type LedgerDeleteResult = { ok: true; deleted: number } | { ok: false; error: string };

export type LedgerPaymentResult =
  | { ok: true; payment: string; balance: string; status: string }
  | { ok: false; error: string };

export type LedgerUpdateResult =
  | { ok: true; grandTotal: string; balance: string; status: string }
  | { ok: false; error: string };

export type AddLedgerPaymentInput = {
  ledgerId: string;
  amount: string;
  paymentDate: string | null;
  mop: string | null;
  reference: string | null;
};

export type UpdateLedgerAccountInput = {
  id: string;
  customerName: string;
  remarks: string | null;
  datePurchased: string | null;
  itemAmount: string | null;
  interest: string | null;
  nextDueDate: string | null;
  notes: string | null;
};

function toStr(value: unknown): string | null {
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  return null;
}

/** All imported ledger rows the caller may read (RLS: any active staff). */
export async function listLayawayLedger(): Promise<LayawayLedgerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layaway_ledger')
    .select(
      'id, layaway_code, account_no, customer_name, status, remarks, date_purchased, item_amount, interest, grand_total, payment, balance, balance_mismatch, next_due_date, last_payment_date, created_at',
    )
    .order('created_at', { ascending: false });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    code: (r.layaway_code as string | null) ?? null,
    nextDueDate: (r.next_due_date as string | null) ?? null,
    lastPaymentDate: (r.last_payment_date as string | null) ?? null,
    accountNo: (r.account_no as string) ?? '—',
    customerName: (r.customer_name as string) ?? 'Unknown',
    status: (r.status as string) ?? 'active',
    remarks: (r.remarks as string | null) ?? null,
    datePurchased: (r.date_purchased as string | null) ?? null,
    itemAmount: toStr(r.item_amount),
    interest: toStr(r.interest),
    grandTotal: toStr(r.grand_total),
    payment: toStr(r.payment),
    balance: toStr(r.balance),
    balanceMismatch: r.balance_mismatch === true,
    createdAt: r.created_at as string,
  }));
}

/** A layaway ledger account marked KEEP (in remarks) — surfaced in Orders → Keep
 *  so every KEEP item shows in one place (Owner request). */
export type KeepLayawayRow = {
  id: string;
  accountNo: string;
  code: string | null;
  customerName: string;
  remarks: string | null;
  itemAmount: string | null;
  grandTotal: string | null;
  balance: string | null;
};

/** Imported layaway accounts flagged KEEP (remarks contain "KEEP"), excluding
 *  needs-review rows. Read-only; RLS-scoped to active staff. */
export async function listKeepLayawayAccounts(): Promise<KeepLayawayRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layaway_ledger')
    .select(
      'id, account_no, layaway_code, customer_name, remarks, item_amount, grand_total, balance, status',
    )
    .ilike('remarks', '%KEEP%')
    .order('customer_name', { ascending: true });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>)
    .filter((r) => (r.status as string) !== 'needs_review')
    .map((r) => ({
      id: r.id as string,
      accountNo: (r.account_no as string) ?? '—',
      code: (r.layaway_code as string | null) ?? null,
      customerName: (r.customer_name as string) ?? 'Unknown',
      remarks: (r.remarks as string | null) ?? null,
      itemAmount: toStr(r.item_amount),
      grandTotal: toStr(r.grand_total),
      balance: toStr(r.balance),
    }));
}

export type LayawayDashboard = {
  active: number;
  completed: number;
  overdue: number;
  forfeited: number;
  /** Total valid layaway accounts (ledger + arrangements). */
  totalQty: number;
  createdToday: number;
  createdMonth: number;
  dueToday: number;
  due7d: number;
  /** Money figures as authoritative strings (numeric in SQL). */
  totalItem: string;
  totalInterest: string;
  grandTotal: string;
  totalPayment: string;
  remainingBalance: string;
};

/** Live layaway dashboard metrics from the database (ledger + arrangements). */
export async function getLayawayDashboard(): Promise<LayawayDashboard> {
  const supabase = await createClient();
  const res = (await supabase.rpc('layaway_dashboard_metrics')) as {
    data: Record<string, unknown> | null;
  };
  const d = res.data ?? {};
  const n = (k: string) => {
    const val = d[k];
    return typeof val === 'number' || typeof val === 'string' ? Number(val) : 0;
  };
  const s = (k: string) => {
    const val = d[k];
    return typeof val === 'number' || typeof val === 'string' ? String(val) : '0';
  };
  return {
    active: n('active'),
    completed: n('completed'),
    overdue: n('overdue'),
    forfeited: n('forfeited'),
    totalQty: n('total_qty'),
    createdToday: n('created_today'),
    createdMonth: n('created_month'),
    dueToday: n('due_today'),
    due7d: n('due_7d'),
    totalItem: s('total_item'),
    totalInterest: s('total_interest'),
    grandTotal: s('grand_total'),
    totalPayment: s('total_payment'),
    remainingBalance: s('remaining_balance'),
  };
}

/** One imported ledger account with its installment schedule + payment history
 *  (for the View modal). RLS-scoped to active staff; read-only. */
export async function getLayawayLedgerDetail(
  id: string,
): Promise<LayawayLedgerDetail | null> {
  const supabase = await createClient();
  const [acct, inst, pay] = await Promise.all([
    supabase
      .from('layaway_ledger')
      .select(
        'id, layaway_code, account_no, customer_name, status, remarks, date_purchased, item_amount, interest, grand_total, payment, balance, balance_mismatch, next_due_date, monthly_interest, total_installment_interest, last_payment_date, mode_of_payment, latest_payment_dp, resize, screw, notes, interest_type, layaway_term, interest_rate, fixed_interest',
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('layaway_ledger_installments')
      .select('sequence, due_date, interest, expected_dp, status')
      .eq('ledger_id', id)
      .order('sequence', { ascending: true }),
    supabase
      .from('layaway_ledger_payments')
      .select('sequence, payment_date, amount, mode_of_payment, reference, received_by')
      .eq('ledger_id', id)
      .order('sequence', { ascending: true }),
  ]);

  const r = acct.data as Record<string, unknown> | null;
  if (!r) return null;

  // Resolve "Received By" names for the recorded payments (older imported rows
  // have no recorder). One small lookup keyed by the distinct staff ids.
  const payRows = (pay.data ?? []) as Array<Record<string, unknown>>;
  const receiverIds = [
    ...new Set(payRows.map((p) => p.received_by).filter((v): v is string => typeof v === 'string')),
  ];
  const receiverNames = new Map<string, string>();
  if (receiverIds.length > 0) {
    const { data: staff } = await supabase
      .from('staff_profiles')
      .select('id, full_name')
      .in('id', receiverIds);
    for (const s of (staff ?? []) as Array<Record<string, unknown>>) {
      receiverNames.set(s.id as string, (s.full_name as string) ?? '');
    }
  }

  return {
    id: r.id as string,
    code: (r.layaway_code as string | null) ?? null,
    accountNo: (r.account_no as string) ?? '—',
    customerName: (r.customer_name as string) ?? 'Unknown',
    status: (r.status as string) ?? 'active',
    remarks: (r.remarks as string | null) ?? null,
    datePurchased: (r.date_purchased as string | null) ?? null,
    itemAmount: toStr(r.item_amount),
    interest: toStr(r.interest),
    grandTotal: toStr(r.grand_total),
    payment: toStr(r.payment),
    balance: toStr(r.balance),
    balanceMismatch: r.balance_mismatch === true,
    nextDueDate: (r.next_due_date as string | null) ?? null,
    monthlyInterest: toStr(r.monthly_interest),
    totalInstallmentInterest: toStr(r.total_installment_interest),
    lastPaymentDate: (r.last_payment_date as string | null) ?? null,
    modeOfPayment: (r.mode_of_payment as string | null) ?? null,
    latestPaymentDp: toStr(r.latest_payment_dp),
    resize: (r.resize as string | null) ?? null,
    screw: (r.screw as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    interestType: (r.interest_type as string | null) ?? null,
    layawayTerm: r.layaway_term === null || r.layaway_term === undefined ? null : Number(r.layaway_term),
    interestRate: toStr(r.interest_rate),
    fixedInterest: toStr(r.fixed_interest),
    installments: ((inst.data ?? []) as Array<Record<string, unknown>>).map((i) => ({
      sequence: Number(i.sequence),
      dueDate: (i.due_date as string | null) ?? null,
      interest: toStr(i.interest),
      expectedDp: toStr(i.expected_dp),
      status: (i.status as string | null) ?? null,
    })),
    payments: payRows.map((p) => ({
      sequence: Number(p.sequence),
      paymentDate: (p.payment_date as string | null) ?? null,
      amount: toStr(p.amount),
      mop: (p.mode_of_payment as string | null) ?? null,
      reference: (p.reference as string | null) ?? null,
      receivedBy:
        typeof p.received_by === 'string'
          ? (receiverNames.get(p.received_by) ?? null)
          : null,
    })),
  };
}

/**
 * Import a batch of layaway ledger rows (Owner/Admin). The database function
 * generates an account number per row, skips duplicates (same customer + date +
 * item + grand total), and returns counts. Nothing else in the system changes.
 */
export async function importLayawayLedger(
  rows: LayawayLedgerInput[],
): Promise<LedgerImportResult> {
  const clean = rows.filter((r) => r.customerName && r.customerName.trim().length > 0);
  if (clean.length === 0) return { ok: false, error: 'No valid rows to import.' };

  try {
    // Bulk import is SUPER ADMIN only (Owner request) — an Admin or Staff member
    // cannot bulk-load records even by calling this action directly.
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'layaway_ledger.import',
        entityType: 'layaway_ledger',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const payload = clean.map((r) => ({
    code: r.code,
    customer_name: r.customerName.trim(),
    status: r.status,
    remarks: r.remarks,
    date_purchased: r.datePurchased,
    item_amount: r.itemAmount,
    interest: r.interest,
    grand_total: r.grandTotal,
    payment: r.payment,
    balance: r.balance,
    balance_mismatch: r.balanceMismatch,
    next_due_date: r.nextDueDate,
    monthly_interest: r.monthlyInterest,
    total_installment_interest: r.totalInstallmentInterest,
    last_payment_date: r.lastPaymentDate,
    mode_of_payment: r.modeOfPayment,
    latest_payment_dp: r.latestPaymentDp,
    resize: r.resize,
    screw: r.screw,
    notes: r.notes,
    interest_type: r.interestType,
    layaway_term: r.layawayTerm,
    interest_rate: r.interestRate,
    fixed_interest: r.fixedInterest,
    installments: r.installments.map((i) => ({
      due_date: i.dueDate,
      interest: i.interest,
      expected_dp: i.expectedDp,
      status: i.status,
      source_position: i.sourcePosition,
    })),
    payments: r.payments.map((p) => ({
      payment_date: p.paymentDate,
      amount: p.amount,
      mop: p.mop,
      reference: p.reference,
      source_position: p.sourcePosition,
    })),
  }));

  const supabase = await createClient();
  const response = await supabase.rpc('import_layaway_ledger', { p_rows: payload });

  if (response.error) {
    await recordAuditEvent({
      action: 'layaway_ledger.import',
      entityType: 'layaway_ledger',
      outcome: 'failed',
      reason: response.error.message,
    });
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const data = (response.data ?? {}) as {
    inserted?: number;
    skipped?: number;
    installments?: number;
    payments?: number;
  };
  const inserted = Number(data.inserted ?? 0);
  const skipped = Number(data.skipped ?? 0);
  const installments = Number(data.installments ?? 0);
  const payments = Number(data.payments ?? 0);

  await recordAuditEvent({
    action: 'layaway_ledger.import',
    entityType: 'layaway_ledger',
    context: { inserted, skipped, installments, payments },
  });

  return { ok: true, inserted, skipped, installments, payments };
}

/**
 * Delete ONE imported layaway ledger account (Owner/Admin). Removes only the flat
 * imported row — never an order, arrangement, or payment. The database function is
 * the real gate; this re-checks authority for defence in depth.
 */
export async function deleteLayawayLedgerRow(id: string): Promise<LedgerDeleteResult> {
  if (!id) return { ok: false, error: 'A ledger account is required.' };

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('delete_layaway_ledger_row', { p_id: id });
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'layaway_ledger.delete',
    entityType: 'layaway_ledger',
    entityId: id,
  });
  return { ok: true, deleted: response.data === true ? 1 : 0 };
}

/**
 * Record a payment against an imported layaway account (Owner/Admin). The database
 * function inserts the payment (attributed to the recorder — Received By), recomputes
 * the account's Payment + Balance authoritatively, auto-completes it when fully paid,
 * and releases its reusable A1–Z200 code back to the pool on completion.
 */
export async function addLayawayLedgerPayment(
  input: AddLedgerPaymentInput,
): Promise<LedgerPaymentResult> {
  if (!input.ledgerId) return { ok: false, error: 'A layaway account is required.' };
  const amount = (input.amount ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    return { ok: false, error: 'Enter a payment amount greater than zero.' };
  }

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('add_layaway_ledger_payment', {
    p_ledger_id: input.ledgerId,
    p_amount: amount,
    p_payment_date: input.paymentDate,
    p_mop: input.mop,
    p_reference: input.reference,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  await recordAuditEvent({
    action: 'layaway_ledger.add_payment',
    entityType: 'layaway_ledger',
    entityId: input.ledgerId,
    context: { amount, status: toStr(d.status) },
  });
  return {
    ok: true,
    payment: toStr(d.payment) ?? '0',
    balance: toStr(d.balance) ?? '0',
    status: toStr(d.status) ?? 'active',
  };
}

/**
 * Edit an imported layaway account's correctable fields (Owner/Admin). The database
 * function recomputes Grand Total (Item + Interest) and Balance, auto-completes a
 * fully-paid account, and releases its code on completion. Payment history is never
 * altered here — only Add Payment records money.
 */
export async function updateLayawayLedgerAccount(
  input: UpdateLedgerAccountInput,
): Promise<LedgerUpdateResult> {
  if (!input.id) return { ok: false, error: 'A layaway account is required.' };
  if (!input.customerName.trim()) return { ok: false, error: 'A customer name is required.' };

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('update_layaway_ledger_account', {
    p_id: input.id,
    p_customer_name: input.customerName.trim(),
    p_remarks: input.remarks,
    p_date_purchased: input.datePurchased,
    p_item_amount: input.itemAmount,
    p_interest: input.interest,
    p_next_due_date: input.nextDueDate,
    p_notes: input.notes,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = res.data ?? {};
  await recordAuditEvent({
    action: 'layaway_ledger.edit',
    entityType: 'layaway_ledger',
    entityId: input.id,
  });
  return {
    ok: true,
    grandTotal: toStr(d.grandTotal) ?? '0',
    balance: toStr(d.balance) ?? '0',
    status: toStr(d.status) ?? 'active',
  };
}

/**
 * Delete ALL imported layaway ledger accounts (Owner/Admin). Clears only the flat
 * imported ledger; the order-derived layaway machinery is untouched.
 */
export async function deleteAllLayawayLedger(): Promise<LedgerDeleteResult> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('delete_all_layaway_ledger');
  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const deleted = Number(response.data ?? 0);
  await recordAuditEvent({
    action: 'layaway_ledger.delete_all',
    entityType: 'layaway_ledger',
    context: { deleted },
  });
  return { ok: true, deleted };
}
