import { listLayawayPage, type LayawaySection } from '@/lib/payments/layaway-page';
import { uniqueCodeLabel } from '@/lib/payments/layaway-account-row';

export const dynamic = 'force-dynamic';

/**
 * GET /api/layaway/export[?section=&search=&financer=] — stream a CSV of ALL Layaway accounts
 * matching the ACTIVE section + search + financer filter (Owner request — export must cover
 * every matching record, not just the current page or the first 1,000). Rows are read
 * server-side in chunks via the SAME layaway_page RPC the table uses, so the browser never
 * loads 10k–50k rows to build the file; it just receives the finished CSV. Authorization is the
 * SAME is_active_staff() gate the RPC enforces (a non-staff caller gets 403). Columns match the
 * previous client-side export exactly.
 */

const SECTIONS = new Set(['active', 'overdue', 'forfeited', 'completed', 'all']);

const HEADERS = [
  'Code',
  'Customer Name',
  'Status',
  'Remarks / Financer',
  'Date Purchased',
  'Item',
  'Interest',
  'Grand Total',
  'Payment',
  'Balance',
  'Unique Code',
  'Order / Account No.',
];

/** RFC-4180 cell: quote when the value contains a comma, quote, CR, or LF. */
function cell(v: string | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const financer = (url.searchParams.get('financer') ?? '').trim();
  const sectionParam = (url.searchParams.get('section') ?? 'all').trim();
  const section = (SECTIONS.has(sectionParam) ? sectionParam : 'all') as LayawaySection;

  const lines: string[] = [HEADERS.map(cell).join(',')];
  const SIZE = 1000;
  let page = 1;
  let total = 0;

  // Chunked server-side read. Bounded to 200 pages (200k rows) as a runaway guard; the loop
  // stops as soon as a short page or the known total is reached.
  for (let guard = 0; guard < 200; guard += 1) {
    const res = await listLayawayPage({ search, section, financer, page, size: SIZE });
    if (!res.ok) {
      const status = /not authorized/i.test(res.reason) ? 403 : 500;
      return new Response(`Export failed: ${res.reason}`, { status });
    }
    total = res.total;
    for (const r of res.rows) {
      lines.push(
        [
          r.code ?? '',
          r.customerName,
          r.status.replace(/_/g, ' '),
          [r.financer, r.remarks].filter(Boolean).join(' · '),
          r.datePurchased ?? '',
          r.item ?? '',
          r.interest ?? '',
          r.grandTotal ?? '',
          r.payment ?? '',
          r.balance ?? '',
          uniqueCodeLabel(r),
          r.accountNo,
        ]
          .map(cell)
          .join(','),
      );
    }
    if (res.rows.length < SIZE || page * SIZE >= total) break;
    page += 1;
  }

  // Leading BOM so Excel opens UTF-8 (peso sign, names) correctly.
  const body = `﻿${lines.join('\r\n')}\r\n`;
  const filename = `layaways-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
