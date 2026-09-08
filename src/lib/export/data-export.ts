import 'server-only';

import ExcelJS from 'exceljs';

import { createClient } from '@/lib/supabase/server';
import {
  ALL_EXPORT_SECTION_KEYS,
  SENSITIVE_SECTION_KEYS,
  type ExportSectionKey,
} from '@/lib/export/sections';

/**
 * Full-data export (Owner/Admin). Builds ONE Excel workbook with a sheet per
 * selected section, server-side, from the actual database records (not the rows a
 * table happens to show). Money is written as NUMBERS so Excel formulas work;
 * every sheet freezes its header row and gets an auto-filter. Read-only — it never
 * writes or deletes. RLS scopes the direct reads to what the caller may see (the
 * Owner sees all); the sales RPC is Owner/Admin-gated in the database.
 */

export type ExportOptions = {
  /** ISO date (YYYY-MM-DD) bounds. Applied only when `applyRange` is true. */
  from: string | null;
  to: string | null;
  applyRange: boolean;
  sections: ExportSectionKey[];
  /** The Owner may export the sensitive sheets (personnel/audit/approvals/capture). */
  isOwner: boolean;
};

type ColType = 'text' | 'money' | 'number' | 'date' | 'datetime';
type Col = { header: string; key: string; width?: number; type?: ColType };

function humanize(value: string | null): string {
  if (!value) return '';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateVal(value: unknown): Date | null {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

function addSheet(
  wb: ExcelJS.Workbook,
  name: string,
  cols: Col[],
  rows: Array<Record<string, unknown>>,
): void {
  // Excel sheet names: max 31 chars, no []:*?/\
  const safeName = name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
  const ws = wb.addWorksheet(safeName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 18 }));

  for (const r of rows) ws.addRow(r);

  // Header styling.
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };

  // Per-column number/date formats + a sensible max auto-width.
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    else if (c.type === 'number') col.numFmt = '#,##0.###';
    else if (c.type === 'date') col.numFmt = 'yyyy-mm-dd';
    else if (c.type === 'datetime') col.numFmt = 'yyyy-mm-dd hh:mm';
  });

  // Auto-filter across the header.
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

/** Apply an inclusive date-range filter on a column when a range is active. */
function rangeFilter<T>(query: T, column: string, opts: ExportOptions): T {
  if (!opts.applyRange) return query;
  // supabase query builder is chainable; typed loosely here on purpose.
  let q = query as unknown as {
    gte: (c: string, v: string) => unknown;
    lte: (c: string, v: string) => unknown;
  };
  if (opts.from) q = q.gte(column, opts.from) as typeof q;
  if (opts.to) q = q.lte(column, `${opts.to} 23:59:59`) as typeof q;
  return q as unknown as T;
}

export async function buildDataExport(opts: ExportOptions): Promise<Buffer> {
  const supabase = await createClient();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'A.V. Jewelry';
  wb.created = new Date();

  // A sensitive sheet is built only when the caller is the Owner AND selected it. RLS is the
  // real control underneath; this keeps a non-owner from ever getting a personnel/audit sheet
  // (and avoids the misleading half-empty sheets RLS would otherwise return them).
  const want = (k: ExportSectionKey) =>
    opts.sections.includes(k) && (opts.isOwner || !SENSITIVE_SECTION_KEYS.has(k));
  const p_from = opts.applyRange ? opts.from : null;
  const p_to = opts.applyRange ? opts.to : null;

  // Resolve staff ids → names once, on demand (approvals/layaway-payments show who acted).
  // The Owner's RLS returns every staff_profiles row; for a non-owner this map is just their
  // own name, so unresolved ids fall back to a short id rather than a wrong name.
  let staffNames: Map<string, string> | null = null;
  const loadStaffNames = async (): Promise<Map<string, string>> => {
    if (staffNames) return staffNames;
    const { data } = await supabase.from('staff_profiles').select('id, full_name');
    staffNames = new Map(
      ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((s) => [
        s.id,
        s.full_name ?? '',
      ]),
    );
    return staffNames;
  };
  const nameOf = (id: unknown): string => {
    if (typeof id !== 'string' || !id) return '—';
    return staffNames?.get(id) || `${id.slice(0, 8)}…`;
  };

  // ---- Inventory ----------------------------------------------------------
  if (want('inventory')) {
    const { data } = await rangeFilter(
      supabase
        .from('inventory_items')
        .select(
          'item_code, facebook_name, availability_status, grams_per_piece, created_at',
        )
        .order('created_at', { ascending: false }),
      'created_at',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      code: (r.item_code as string) ?? '—',
      fb: (r.facebook_name as string) ?? '—',
      status: humanize(r.availability_status as string),
      grams: num(r.grams_per_piece),
      encoded: dateVal(r.created_at),
      notes: '—',
    }));
    addSheet(
      wb,
      'Inventory',
      [
        { header: 'Unique Code', key: 'code', width: 16 },
        { header: 'Facebook Name', key: 'fb', width: 26 },
        { header: 'Status', key: 'status', width: 18 },
        { header: 'Grams', key: 'grams', width: 10, type: 'number' },
        { header: 'Date Encoded', key: 'encoded', width: 14, type: 'date' },
        { header: 'Notes', key: 'notes', width: 20 },
      ],
      rows,
    );
  }

  // ---- Layaways (active / completed / all) --------------------------------
  const layawayCols: Col[] = [
    { header: 'Code', key: 'code', width: 8 },
    { header: 'Customer Name', key: 'customer', width: 24 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Remarks / Financer', key: 'remarks', width: 22 },
    { header: 'Date Purchased', key: 'purchased', width: 14, type: 'date' },
    { header: 'Item', key: 'item', width: 12, type: 'money' },
    { header: 'Interest', key: 'interest', width: 12, type: 'money' },
    { header: 'Grand Total', key: 'grand', width: 14, type: 'money' },
    { header: 'Payment', key: 'payment', width: 12, type: 'money' },
    { header: 'Balance', key: 'balance', width: 12, type: 'money' },
    { header: 'Order / Account No.', key: 'account', width: 20 },
  ];
  if (want('active_layaways') || want('completed_layaways') || want('all_layaways')) {
    const { data } = await rangeFilter(
      supabase
        .from('layaway_ledger')
        .select(
          'layaway_code, customer_name, status, remarks, date_purchased, item_amount, interest, grand_total, payment, balance, account_no',
        )
        .order('created_at', { ascending: false }),
      'date_purchased',
      opts,
    );
    const all = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      status_raw: (r.status as string) ?? 'active',
      row: {
        code: (r.layaway_code as string) ?? '—',
        customer: (r.customer_name as string) ?? '—',
        status: humanize(r.status as string),
        remarks: (r.remarks as string) ?? '—',
        purchased: dateVal(r.date_purchased),
        item: num(r.item_amount),
        interest: num(r.interest),
        grand: num(r.grand_total),
        payment: num(r.payment),
        balance: num(r.balance),
        account: (r.account_no as string) ?? '—',
      },
    }));
    if (want('active_layaways')) {
      addSheet(
        wb,
        'Active Layaways',
        layawayCols,
        all.filter((x) => x.status_raw === 'active').map((x) => x.row),
      );
    }
    if (want('completed_layaways')) {
      addSheet(
        wb,
        'Completed Layaways',
        layawayCols,
        all.filter((x) => x.status_raw === 'completed').map((x) => x.row),
      );
    }
    if (want('all_layaways')) {
      addSheet(
        wb,
        'All Layaways',
        layawayCols,
        all.map((x) => x.row),
      );
    }
  }

  // ---- Layaway Payment History (installments) -----------------------------
  // The layaway sheets above carry running totals; this is the per-installment ledger
  // (layaway_ledger_payments), which those totals are built from. Owner + Selected Admin.
  if (want('layaway_payments')) {
    await loadStaffNames();
    const { data } = await rangeFilter(
      supabase
        .from('layaway_ledger_payments')
        .select(
          'sequence, payment_date, amount, mode_of_payment, reference, received_by, recorded_at, ledger:layaway_ledger!layaway_ledger_payments_ledger_id_fkey ( layaway_code, customer_name )',
        )
        .order('payment_date', { ascending: false }),
      'payment_date',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const ledger = one<{ layaway_code: string; customer_name: string }>(r.ledger);
      return {
        code: ledger?.layaway_code ?? '—',
        customer: ledger?.customer_name ?? '—',
        seq: num(r.sequence),
        date: dateVal(r.payment_date),
        amount: num(r.amount),
        mode: humanize(r.mode_of_payment as string) || '—',
        reference: (r.reference as string) ?? '—',
        received: nameOf(r.received_by),
        recorded: dateVal(r.recorded_at),
      };
    });
    addSheet(
      wb,
      'Layaway Payment History',
      [
        { header: 'Layaway Code', key: 'code', width: 12 },
        { header: 'Customer Name', key: 'customer', width: 24 },
        { header: 'Payment #', key: 'seq', width: 10, type: 'number' },
        { header: 'Payment Date', key: 'date', width: 14, type: 'date' },
        { header: 'Amount', key: 'amount', width: 14, type: 'money' },
        { header: 'Mode of Payment', key: 'mode', width: 16 },
        { header: 'Reference', key: 'reference', width: 18 },
        { header: 'Received By', key: 'received', width: 22 },
        { header: 'Recorded At', key: 'recorded', width: 18, type: 'datetime' },
      ],
      rows,
    );
  }

  // ---- Scrap Sales --------------------------------------------------------
  if (want('scrap')) {
    const { data } = await rangeFilter(
      supabase
        .from('scrap_sales')
        .select('material, grams, amount, buyer, sold_on, note')
        .order('sold_on', { ascending: false }),
      'sold_on',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      material: humanize(r.material as string),
      grams: num(r.grams),
      amount: num(r.amount),
      buyer: (r.buyer as string) ?? '—',
      sold: dateVal(r.sold_on),
      note: (r.note as string) ?? '—',
    }));
    addSheet(
      wb,
      'Scrap Sales',
      [
        { header: 'Material', key: 'material', width: 12 },
        { header: 'Grams', key: 'grams', width: 10, type: 'number' },
        { header: 'Amount', key: 'amount', width: 14, type: 'money' },
        { header: 'Buyer', key: 'buyer', width: 22 },
        { header: 'Sold On', key: 'sold', width: 14, type: 'date' },
        { header: 'Note', key: 'note', width: 24 },
      ],
      rows,
    );
  }

  // ---- All Sales / Orders (authoritative totals via RPC) ------------------
  if (want('all_sales') || want('orders')) {
    const salesRes = (await supabase.rpc('export_sales_rows', { p_from, p_to })) as {
      data: Array<Record<string, unknown>> | null;
    };
    // Fulfillment fix (Owner 2026-09-07): export_sales_rows sources Fulfillment Method +
    // Date Completed from the DORMANT fulfillment_records table (0 rows), so both columns came
    // back blank on every row. official_orders is the single source of truth for fulfillment
    // (see the Fulfillment memory), so overlay them by order_number — 100% populated + unique.
    const fulfilByOrderNo = new Map<
      string,
      { destination: string | null; courier: string | null; completed: string | null }
    >();
    const { data: ordersMeta } = await supabase
      .from('official_orders')
      .select('order_number, fulfillment_destination, courier, completed_at');
    for (const o of (ordersMeta ?? []) as Array<Record<string, unknown>>) {
      const key = o.order_number as string | null;
      if (key) {
        fulfilByOrderNo.set(key, {
          destination: (o.fulfillment_destination as string | null) ?? null,
          courier: (o.courier as string | null) ?? null,
          completed: (o.completed_at as string | null) ?? null,
        });
      }
    }
    const sales = (salesRes.data ?? []).map((r) => {
      const meta = fulfilByOrderNo.get((r.order_number as string) ?? '');
      // A courier refines the "shipping" destination when one is set.
      const fulfill = meta?.destination
        ? meta.courier
          ? `${humanize(meta.destination)} · ${meta.courier}`
          : humanize(meta.destination)
        : '—';
      return {
        customer: (r.customer_name as string) ?? '—',
        source: r.order_source === 'walk_in' ? 'Walk-in' : 'Online',
        item: (r.item as string) ?? '—',
        grams: num(r.total_grams),
        total: num(r.total_amount),
        method: humanize(r.payment_method as string) || '—',
        payStatus: (r.payment_status as string) ?? '—',
        fulfill,
        status: humanize(r.order_status as string),
        completed: dateVal(meta?.completed ?? r.date_completed),
      };
    });
    if (want('all_sales')) {
      addSheet(
        wb,
        'All Sales',
        [
          { header: 'Customer Name', key: 'customer', width: 24 },
          { header: 'Order Source', key: 'source', width: 12 },
          { header: 'Item', key: 'item', width: 24 },
          { header: 'Grams', key: 'grams', width: 10, type: 'number' },
          { header: 'Total Amount', key: 'total', width: 14, type: 'money' },
          { header: 'Payment Method', key: 'method', width: 16 },
          { header: 'Payment Status', key: 'payStatus', width: 14 },
          { header: 'Fulfillment Method', key: 'fulfill', width: 16 },
          { header: 'Order Status', key: 'status', width: 18 },
          { header: 'Date Completed', key: 'completed', width: 18, type: 'datetime' },
        ],
        sales,
      );
    }
    if (want('orders')) {
      addSheet(
        wb,
        'Orders',
        [
          { header: 'Customer Name', key: 'customer', width: 24 },
          { header: 'Order Source', key: 'source', width: 12 },
          { header: 'Order Status', key: 'status', width: 18 },
          { header: 'Total Amount', key: 'total', width: 14, type: 'money' },
          { header: 'Payment Status', key: 'payStatus', width: 14 },
          { header: 'Date Completed', key: 'completed', width: 18, type: 'datetime' },
        ],
        sales,
      );
    }
  }

  // ---- Payments -----------------------------------------------------------
  if (want('payments')) {
    const { data } = await rangeFilter(
      supabase
        .from('payments')
        .select(
          'amount, payment_method, status, reference_number, recorded_at, official_orders!payments_official_order_id_fkey ( order_number, customers ( display_name ) )',
        )
        .order('recorded_at', { ascending: false }),
      'recorded_at',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const order = one<{ order_number: string; customers: unknown }>(r.official_orders);
      const customer = one<{ display_name: string }>(order?.customers);
      return {
        customer: customer?.display_name ?? '—',
        amount: num(r.amount),
        method: humanize(r.payment_method as string) || '—',
        status: humanize(r.status as string),
        reference: (r.reference_number as string) ?? '—',
        recorded: dateVal(r.recorded_at),
      };
    });
    addSheet(
      wb,
      'Payments',
      [
        { header: 'Customer Name', key: 'customer', width: 24 },
        { header: 'Amount', key: 'amount', width: 14, type: 'money' },
        { header: 'Payment Method', key: 'method', width: 16 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Reference', key: 'reference', width: 18 },
        { header: 'Recorded At', key: 'recorded', width: 18, type: 'datetime' },
      ],
      rows,
    );
  }

  // ---- Customers ----------------------------------------------------------
  if (want('customers')) {
    const { data } = await rangeFilter(
      supabase
        .from('customers')
        .select('display_name, contact_number, address, is_active, created_at')
        .order('display_name', { ascending: true }),
      'created_at',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      name: (r.display_name as string) ?? '—',
      contact: (r.contact_number as string) ?? '—',
      address: (r.address as string) ?? '—',
      status: r.is_active === false ? 'Inactive' : 'Active',
      created: dateVal(r.created_at),
    }));
    addSheet(
      wb,
      'Customers',
      [
        { header: 'Full Name', key: 'name', width: 26 },
        { header: 'Contact Number', key: 'contact', width: 16 },
        { header: 'Address', key: 'address', width: 30 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Date Created', key: 'created', width: 14, type: 'date' },
      ],
      rows,
    );
  }

  // ---- Attendance ---------------------------------------------------------
  if (want('attendance')) {
    const { data } = await rangeFilter(
      supabase
        .from('attendance_records')
        .select(
          'work_date, time_in, time_out, is_overtime, overtime_amount, staff:staff_profiles!staff_profile_id ( full_name )',
        )
        .order('time_in', { ascending: false }),
      'work_date',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      const staff = one<{ full_name: string }>(r.staff);
      return {
        employee: staff?.full_name ?? '—',
        date: dateVal(r.work_date),
        timeIn: dateVal(r.time_in),
        timeOut: dateVal(r.time_out),
        overtime: r.is_overtime === true ? 'Yes' : 'No',
        overtimeAmount: num(r.overtime_amount),
      };
    });
    addSheet(
      wb,
      'Attendance',
      [
        { header: 'Employee', key: 'employee', width: 24 },
        { header: 'Date', key: 'date', width: 14, type: 'date' },
        { header: 'Time In', key: 'timeIn', width: 18, type: 'datetime' },
        { header: 'Time Out', key: 'timeOut', width: 18, type: 'datetime' },
        { header: 'Overtime', key: 'overtime', width: 10 },
        { header: 'Overtime Amount', key: 'overtimeAmount', width: 16, type: 'money' },
      ],
      rows,
    );
  }

  // ---- Payroll (derived) --------------------------------------------------
  if (want('payroll')) {
    const payrollRes = (await supabase.rpc('report_payroll', {
      p_from: p_from ?? '2000-01-01',
      p_to: p_to ?? '2100-01-01',
    })) as { data: Array<Record<string, unknown>> | null };
    // report_payroll returns daily_rate (the pay model is a DAILY rate on a weekly cycle),
    // NOT hourly_rate — the old sheet read a column the function never returns, so "Salary
    // Rate" was blank on every row. Fixed 2026-09-07; also surfaces the real days/nights the
    // salary is computed from.
    const rows = (payrollRes.data ?? []).map((r) => ({
      employee: (r.full_name as string) ?? '—',
      role: humanize(r.role_key as string),
      regular: num(r.total_hours),
      overtime: num(r.overtime_hours),
      days: num(r.days_worked),
      nights: num(r.night_shifts),
      rate: num(r.daily_rate),
      frequency: humanize(r.pay_frequency as string) || '—',
      overtimePay: num(r.overtime_pay),
      salary: num(r.computed_salary),
    }));
    addSheet(
      wb,
      'Payroll',
      [
        { header: 'Employee', key: 'employee', width: 24 },
        { header: 'Role', key: 'role', width: 16 },
        { header: 'Regular Hours', key: 'regular', width: 14, type: 'number' },
        { header: 'Overtime Hours', key: 'overtime', width: 14, type: 'number' },
        { header: 'Days Worked', key: 'days', width: 12, type: 'number' },
        { header: 'Night Shifts', key: 'nights', width: 12, type: 'number' },
        { header: 'Salary Rate (per day)', key: 'rate', width: 18, type: 'money' },
        { header: 'Pay Frequency', key: 'frequency', width: 14 },
        { header: 'Overtime Pay', key: 'overtimePay', width: 14, type: 'money' },
        { header: 'Salary', key: 'salary', width: 14, type: 'money' },
      ],
      rows,
    );
  }

  // ---- Daily Cash (detail ledger + per-day reconciliation) ----------------
  // Two sheets under one toggle: the concrete cash movements (expenses / remittances / cash
  // in-out / trade-ins), and the daily close reconciliation (expected vs actual). Both read
  // stored rows directly (no per-day summary RPC iteration). Owner + Selected Admin, matching
  // the module's own access. Test-mode rows are kept but flagged so nothing is hidden.
  if (want('daily_cash')) {
    await loadStaffNames();
    const [exp, rem, mov, trd, closes] = await Promise.all([
      rangeFilter(
        supabase
          .from('daily_cash_expenses')
          .select('expense_date, payee, category, amount, remarks, is_test, created_by')
          .order('expense_date', { ascending: false }),
        'expense_date',
        opts,
      ),
      rangeFilter(
        supabase
          .from('daily_cash_remittances')
          .select('remit_date, reference, amount, remarks, is_test, created_by')
          .order('remit_date', { ascending: false }),
        'remit_date',
        opts,
      ),
      rangeFilter(
        supabase
          .from('daily_cash_movements')
          .select(
            'movement_date, direction, movement_type, amount, remarks, is_test, created_by',
          )
          .order('movement_date', { ascending: false }),
        'movement_date',
        opts,
      ),
      rangeFilter(
        supabase
          .from('daily_cash_trades')
          .select('trade_date, name, related_sale, amount, remarks, is_test, created_by')
          .order('trade_date', { ascending: false }),
        'trade_date',
        opts,
      ),
      rangeFilter(
        supabase
          .from('daily_cash_closes')
          .select(
            'close_date, status, expected_cash, actual_cash_count, difference, notes, closed_by, closed_at',
          )
          .order('close_date', { ascending: false }),
        'close_date',
        opts,
      ),
    ]);

    type DetailRow = {
      dateKey: string;
      date: Date | null;
      kind: string;
      detail: string;
      direction: string;
      amount: number | null;
      recorded: string;
      remarks: string;
      test: string;
    };
    const detail: DetailRow[] = [];
    const push = (
      dateKey: unknown,
      kind: string,
      detailText: string,
      direction: string,
      r: Record<string, unknown>,
    ) => {
      detail.push({
        dateKey: (dateKey as string) ?? '',
        date: dateVal(dateKey),
        kind,
        detail: detailText || '—',
        direction,
        amount: num(r.amount),
        recorded: nameOf(r.created_by),
        remarks: (r.remarks as string) ?? '—',
        test: r.is_test === true ? 'Yes' : 'No',
      });
    };
    for (const r of (exp.data ?? []) as Array<Record<string, unknown>>) {
      push(
        r.expense_date,
        'Expense',
        [r.payee as string, humanize(r.category as string)].filter(Boolean).join(' · '),
        'Out',
        r,
      );
    }
    for (const r of (rem.data ?? []) as Array<Record<string, unknown>>) {
      push(r.remit_date, 'Remittance', (r.reference as string) ?? '', 'Out', r);
    }
    for (const r of (mov.data ?? []) as Array<Record<string, unknown>>) {
      const dir = (r.direction as string) === 'in' ? 'In' : 'Out';
      push(r.movement_date, 'Cash Movement', humanize(r.movement_type as string), dir, r);
    }
    for (const r of (trd.data ?? []) as Array<Record<string, unknown>>) {
      push(
        r.trade_date,
        'Trade-in',
        [r.name as string, r.related_sale as string].filter(Boolean).join(' · '),
        '—',
        r,
      );
    }
    detail.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
    addSheet(
      wb,
      'Daily Cash Detail',
      [
        { header: 'Date', key: 'date', width: 14, type: 'date' },
        { header: 'Type', key: 'kind', width: 16 },
        { header: 'Detail', key: 'detail', width: 28 },
        { header: 'Direction', key: 'direction', width: 10 },
        { header: 'Amount', key: 'amount', width: 14, type: 'money' },
        { header: 'Recorded By', key: 'recorded', width: 22 },
        { header: 'Remarks', key: 'remarks', width: 26 },
        { header: 'Test', key: 'test', width: 8 },
      ],
      detail,
    );

    const closeRows = ((closes.data ?? []) as Array<Record<string, unknown>>).map(
      (r) => ({
        date: dateVal(r.close_date),
        status: humanize(r.status as string),
        expected: num(r.expected_cash),
        actual: num(r.actual_cash_count),
        difference: num(r.difference),
        notes: (r.notes as string) ?? '—',
        closedBy: nameOf(r.closed_by),
        closedAt: dateVal(r.closed_at),
      }),
    );
    addSheet(
      wb,
      'Daily Cash Close',
      [
        { header: 'Date', key: 'date', width: 14, type: 'date' },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Expected Cash', key: 'expected', width: 16, type: 'money' },
        { header: 'Actual Count', key: 'actual', width: 16, type: 'money' },
        { header: 'Difference', key: 'difference', width: 14, type: 'money' },
        { header: 'Notes', key: 'notes', width: 26 },
        { header: 'Closed By', key: 'closedBy', width: 22 },
        { header: 'Closed At', key: 'closedAt', width: 18, type: 'datetime' },
      ],
      closeRows,
    );
  }

  // ---- Team / Employees (Owner only) --------------------------------------
  // The personnel roster + current salary rate. Excludes auth ids and the temp-password flag.
  if (want('team')) {
    await loadStaffNames();
    const [{ data: staff }, { data: rates }] = await Promise.all([
      supabase
        .from('staff_profiles')
        .select(
          'id, full_name, role_key, is_active, is_demo, mfa_enrolled, created_at, deactivated_at, deactivated_reason',
        )
        .order('full_name', { ascending: true }),
      supabase
        .from('staff_salary_rates')
        .select('staff_profile_id, daily_rate, pay_frequency, effective_date')
        .order('effective_date', { ascending: false }),
    ]);
    // Newest effective rate per staff member.
    const rateByStaff = new Map<string, Record<string, unknown>>();
    for (const rt of (rates ?? []) as Array<Record<string, unknown>>) {
      const sid = rt.staff_profile_id as string;
      if (!rateByStaff.has(sid)) rateByStaff.set(sid, rt);
    }
    const rows = ((staff ?? []) as Array<Record<string, unknown>>).map((s) => {
      const rt = rateByStaff.get(s.id as string);
      return {
        name: (s.full_name as string) ?? '—',
        role: humanize(s.role_key as string),
        status: s.is_active === false ? 'Inactive' : 'Active',
        rate: rt ? num(rt.daily_rate) : null,
        frequency: rt ? humanize(rt.pay_frequency as string) : '—',
        effective: rt ? dateVal(rt.effective_date) : null,
        demo: s.is_demo === true ? 'Yes' : 'No',
        mfa: s.mfa_enrolled === true ? 'Yes' : 'No',
        added: dateVal(s.created_at),
        deactivated: dateVal(s.deactivated_at),
        reason: (s.deactivated_reason as string) ?? '—',
      };
    });
    addSheet(
      wb,
      'Team',
      [
        { header: 'Full Name', key: 'name', width: 24 },
        { header: 'Role', key: 'role', width: 16 },
        { header: 'Status', key: 'status', width: 10 },
        { header: 'Salary Rate (per day)', key: 'rate', width: 18, type: 'money' },
        { header: 'Pay Frequency', key: 'frequency', width: 14 },
        { header: 'Rate Effective', key: 'effective', width: 14, type: 'date' },
        { header: 'Demo Account', key: 'demo', width: 12 },
        { header: 'MFA', key: 'mfa', width: 8 },
        { header: 'Date Added', key: 'added', width: 14, type: 'date' },
        { header: 'Deactivated At', key: 'deactivated', width: 16, type: 'date' },
        { header: 'Deactivated Reason', key: 'reason', width: 24 },
      ],
      rows,
    );
  }

  // ---- Permissions (Owner only) -------------------------------------------
  // Who explicitly holds which permission (staff_permission_grants). The Owner holds every
  // permission implicitly and has no grant rows, so this lists the Selected Admin / Staff
  // grants — an accountability record of who can do what. Owner-only (RLS: is_owner OR self).
  if (want('permissions')) {
    await loadStaffNames();
    const [{ data: grants }, { data: perms }, { data: staff }] = await Promise.all([
      supabase
        .from('staff_permission_grants')
        .select('staff_profile_id, permission_key, granted_at, granted_by'),
      supabase.from('permissions').select('key, label'),
      supabase.from('staff_profiles').select('id, role_key'),
    ]);
    const permLabel = new Map(
      ((perms ?? []) as Array<{ key: string; label: string | null }>).map((p) => [
        p.key,
        p.label ?? p.key,
      ]),
    );
    const roleByStaff = new Map(
      ((staff ?? []) as Array<{ id: string; role_key: string | null }>).map((s) => [
        s.id,
        s.role_key ?? '',
      ]),
    );
    const rows = ((grants ?? []) as Array<Record<string, unknown>>).map((g) => ({
      name: nameOf(g.staff_profile_id),
      role: humanize(roleByStaff.get(g.staff_profile_id as string) ?? ''),
      permission:
        permLabel.get(g.permission_key as string) ?? (g.permission_key as string),
      key: (g.permission_key as string) ?? '—',
      grantedAt: dateVal(g.granted_at),
      grantedBy: nameOf(g.granted_by),
    }));
    rows.sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
    addSheet(
      wb,
      'Permissions',
      [
        { header: 'Staff Name', key: 'name', width: 24 },
        { header: 'Role', key: 'role', width: 16 },
        { header: 'Permission', key: 'permission', width: 28 },
        { header: 'Permission Key', key: 'key', width: 24 },
        { header: 'Granted At', key: 'grantedAt', width: 18, type: 'datetime' },
        { header: 'Granted By', key: 'grantedBy', width: 22 },
      ],
      rows,
    );
  }

  // ---- Approvals (Owner only) ---------------------------------------------
  // The Owner approval queue (owner_approval_requests) — inventory edit/delete, order delete,
  // layaway delete, etc. Cancelled/returned/removed history lives in the Audit Log below.
  if (want('approvals')) {
    await loadStaffNames();
    const { data } = await rangeFilter(
      supabase
        .from('owner_approval_requests')
        .select(
          'action_kind, status, entity_type, entity_id, reason, evidence_note, requested_at, requested_by, decided_at, decided_by, decision_note, executed_at',
        )
        .order('requested_at', { ascending: false }),
      'requested_at',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      action: humanize(r.action_kind as string),
      status: humanize(r.status as string),
      entityType: humanize(r.entity_type as string),
      entityId: (r.entity_id as string) ?? '—',
      reason: (r.reason as string) ?? '—',
      evidence: (r.evidence_note as string) ?? '—',
      requestedAt: dateVal(r.requested_at),
      requestedBy: nameOf(r.requested_by),
      decidedAt: dateVal(r.decided_at),
      decidedBy: nameOf(r.decided_by),
      decisionNote: (r.decision_note as string) ?? '—',
      executedAt: dateVal(r.executed_at),
    }));
    addSheet(
      wb,
      'Approvals',
      [
        { header: 'Action', key: 'action', width: 22 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Entity Type', key: 'entityType', width: 18 },
        { header: 'Entity Id', key: 'entityId', width: 20 },
        { header: 'Reason', key: 'reason', width: 30 },
        { header: 'Evidence', key: 'evidence', width: 24 },
        { header: 'Requested At', key: 'requestedAt', width: 18, type: 'datetime' },
        { header: 'Requested By', key: 'requestedBy', width: 22 },
        { header: 'Decided At', key: 'decidedAt', width: 18, type: 'datetime' },
        { header: 'Decided By', key: 'decidedBy', width: 22 },
        { header: 'Decision Note', key: 'decisionNote', width: 26 },
        { header: 'Executed At', key: 'executedAt', width: 18, type: 'datetime' },
      ],
      rows,
    );
  }

  // ---- Audit Log (Owner only) ---------------------------------------------
  // The accountability trail (audit_events): staff actions, deletions, restocks, returns,
  // cancellations, exports. Large — capped at the most recent 20,000 when no range is set.
  if (want('audit')) {
    const { data } = await rangeFilter(
      supabase
        .from('audit_events')
        .select(
          'occurred_at, action, entity_type, entity_id, outcome, actor_label, reason, context',
        )
        .order('occurred_at', { ascending: false })
        .limit(20000),
      'occurred_at',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
      let details = '';
      try {
        details = r.context ? JSON.stringify(r.context) : '';
      } catch {
        details = '';
      }
      return {
        occurredAt: dateVal(r.occurred_at),
        action: (r.action as string) ?? '—',
        entityType: humanize(r.entity_type as string),
        entityId: (r.entity_id as string) ?? '—',
        outcome: humanize(r.outcome as string) || 'Ok',
        actor: (r.actor_label as string) ?? '—',
        reason: (r.reason as string) ?? '—',
        details: details.length > 1000 ? `${details.slice(0, 1000)}…` : details,
      };
    });
    addSheet(
      wb,
      'Audit Log',
      [
        { header: 'Occurred At', key: 'occurredAt', width: 18, type: 'datetime' },
        { header: 'Action', key: 'action', width: 28 },
        { header: 'Entity Type', key: 'entityType', width: 18 },
        { header: 'Entity Id', key: 'entityId', width: 20 },
        { header: 'Outcome', key: 'outcome', width: 12 },
        { header: 'Actor', key: 'actor', width: 22 },
        { header: 'Reason', key: 'reason', width: 30 },
        { header: 'Details', key: 'details', width: 40 },
      ],
      rows,
    );
  }

  // ---- Capture Metadata (Owner only) --------------------------------------
  // Incoming-capture records — METADATA ONLY. Deliberately excludes the screenshot path and
  // every jsonb column (ocr / confirmed / print_diag) so no image or comment text is exported.
  if (want('capture_meta')) {
    const { data } = await rangeFilter(
      supabase
        .from('capture_records')
        .select(
          'captured_at, capture_id, source, message_status, print_status, link_status, route_reason, is_test, official_order_id, customer_id, inventory_item_id, canonical_grams',
        )
        .order('captured_at', { ascending: false }),
      'captured_at',
      opts,
    );
    const rows = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      capturedAt: dateVal(r.captured_at),
      captureId: (r.capture_id as string) ?? '—',
      source: humanize(r.source as string) || '—',
      messageStatus: humanize(r.message_status as string) || '—',
      printStatus: humanize(r.print_status as string) || '—',
      linkStatus: humanize(r.link_status as string) || '—',
      routeReason: humanize(r.route_reason as string) || '—',
      test: r.is_test === true ? 'Yes' : 'No',
      orderId: (r.official_order_id as string) ?? '—',
      customerId: (r.customer_id as string) ?? '—',
      itemId: (r.inventory_item_id as string) ?? '—',
      grams: (r.canonical_grams as string) ?? '—',
    }));
    addSheet(
      wb,
      'Capture Metadata',
      [
        { header: 'Captured At', key: 'capturedAt', width: 18, type: 'datetime' },
        { header: 'Capture Id', key: 'captureId', width: 18 },
        { header: 'Source', key: 'source', width: 14 },
        { header: 'Message Status', key: 'messageStatus', width: 16 },
        { header: 'Print Status', key: 'printStatus', width: 14 },
        { header: 'Link Status', key: 'linkStatus', width: 14 },
        { header: 'Route Reason', key: 'routeReason', width: 18 },
        { header: 'Test', key: 'test', width: 8 },
        { header: 'Order Id', key: 'orderId', width: 20 },
        { header: 'Customer Id', key: 'customerId', width: 20 },
        { header: 'Inventory Item Id', key: 'itemId', width: 20 },
        { header: 'Grams', key: 'grams', width: 10 },
      ],
      rows,
    );
  }

  // A workbook must have at least one sheet.
  if (wb.worksheets.length === 0) {
    addSheet(
      wb,
      'Export',
      [{ header: 'Note', key: 'note', width: 40 }],
      [{ note: 'No sections were selected.' }],
    );
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export { ALL_EXPORT_SECTION_KEYS };
