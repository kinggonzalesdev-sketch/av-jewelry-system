import 'server-only';

import ExcelJS from 'exceljs';

import { createClient } from '@/lib/supabase/server';
import { ALL_EXPORT_SECTION_KEYS, type ExportSectionKey } from '@/lib/export/sections';

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
  wb.creator = 'MineFlow';
  wb.created = new Date();

  const want = (k: ExportSectionKey) => opts.sections.includes(k);
  const p_from = opts.applyRange ? opts.from : null;
  const p_to = opts.applyRange ? opts.to : null;

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
    const sales = (salesRes.data ?? []).map((r) => ({
      customer: (r.customer_name as string) ?? '—',
      source: r.order_source === 'walk_in' ? 'Walk-in' : 'Online',
      item: (r.item as string) ?? '—',
      grams: num(r.total_grams),
      total: num(r.total_amount),
      method: humanize(r.payment_method as string) || '—',
      payStatus: (r.payment_status as string) ?? '—',
      fulfill: humanize(r.fulfillment_method as string) || '—',
      status: humanize(r.order_status as string),
      completed: dateVal(r.date_completed),
    }));
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
    const rows = (payrollRes.data ?? []).map((r) => ({
      employee: (r.full_name as string) ?? '—',
      role: humanize(r.role_key as string),
      regular: num(r.total_hours),
      overtime: num(r.overtime_hours),
      rate: num(r.hourly_rate),
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
        { header: 'Hourly Rate', key: 'rate', width: 14, type: 'money' },
        { header: 'Salary', key: 'salary', width: 14, type: 'money' },
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
