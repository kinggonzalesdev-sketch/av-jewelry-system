import { canOpenPage } from '@/lib/authz/guard';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { listCompletedInventoryPage } from '@/lib/inventory/completed';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventory/completed/export[?search=&type=] — stream a CSV of ALL Completed
 * Items matching the ACTIVE filter (Owner request — export must cover every matching
 * record, not just the current page / loaded rows / first 1,000). The rows are read
 * server-side in chunks so the browser never loads 10k–50k rows to build the file; it
 * just receives the finished CSV. Authorization is the SAME `is_active_staff()` gate the
 * page RPC enforces (a non-staff caller gets 403). Preserves the existing column set.
 */

const PAYMENT_LABEL: Record<string, string> = {
  paid_in_full: 'Paid in Full',
  partial: 'Partial',
  unpaid: 'Unpaid',
};
function paymentLabel(status: string | null): string {
  if (!status) return '—';
  return PAYMENT_LABEL[status] ?? status.replace(/_/g, ' ');
}

const HEADERS = [
  'Inventory Code',
  'Item',
  'Condition',
  'Item Type',
  'Grams',
  'Size',
  'Customer',
  'Invoice Number',
  'Sale Amount',
  'Payment',
  'Current Stage',
  'Completion Type',
  'Courier',
  'Tracking Number',
  'Completed Date',
  'Final Holder',
];

/** RFC-4180 cell: quote when the value contains a comma, quote, CR, or LF. */
function cell(v: string | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request): Promise<Response> {
  // FUNCTION-LEVEL AUTHORIZATION (Owner 2026-09-08 security fix). Match the SAME page gate the
  // Inventory page enforces (`nav_inventory`). Without this, any active staff member who cannot
  // open the Completed Inventory page in the UI could still pull the FULL customer-PII CSV
  // (names, invoice numbers, sale amounts, couriers, tracking) by requesting this URL directly —
  // the RPC's `is_active_staff()` check alone is coarser than the page permission.
  if (!(await canOpenPage('nav_inventory'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const type = (url.searchParams.get('type') ?? 'all').trim() || 'all';

  const lines: string[] = [HEADERS.map(cell).join(',')];
  const SIZE = 1000;
  let page = 1;
  let total = 0;

  // Chunked server-side read. Bounded to 200 pages (200k rows) as a runaway guard; the
  // loop stops as soon as a short page or the known total is reached.
  for (let guard = 0; guard < 200; guard += 1) {
    const res = await listCompletedInventoryPage({ search, type, page, size: SIZE });
    if (!res.ok) {
      const status = /not authorized/i.test(res.reason) ? 403 : 500;
      return new Response(`Export failed: ${res.reason}`, { status });
    }
    total = res.total;
    for (const c of res.rows) {
      const parsed = parseInventoryCode(c.itemCode);
      lines.push(
        [
          c.itemCode,
          c.itemName ?? '',
          parsed.condition ?? '',
          parsed.itemType ?? '',
          parsed.grams ?? '',
          parsed.size ?? '',
          c.customerName ?? '',
          c.invoiceNumber ?? '',
          c.finalSale ?? '',
          paymentLabel(c.paymentStatus),
          c.currentStage,
          c.completionType,
          c.courier ?? '',
          c.trackingNumber ?? '',
          c.completedDate ? c.completedDate.slice(0, 10) : '',
          c.currentHolder ?? '',
        ].map(cell).join(','),
      );
    }
    if (res.rows.length < SIZE || page * SIZE >= total) break;
    page += 1;
  }

  // Leading BOM so Excel opens UTF-8 (peso sign, names) correctly.
  const body = `﻿${lines.join('\r\n')}\r\n`;
  const filename = `completed-items-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
