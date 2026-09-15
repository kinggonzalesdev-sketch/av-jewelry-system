import { canOpenPage } from '@/lib/authz/guard';
import {
  LAYAWAY_PAGE_MAX_SIZE,
  listLayawayPage,
  type LayawaySection,
} from '@/lib/payments/layaway-page';
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

const SECTIONS = new Set([
  'active',
  'overdue',
  'forfeited',
  'completed',
  'all',
  'near_overdue',
]);

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
  // Was "Order / Account No." — the order half is retired (Owner 2026-09-13); only the
  // imported ledger Account No. remains, and order-derived rows export blank.
  'Account No.',
];

/** RFC-4180 cell: quote when the value contains a comma, quote, CR, or LF. */
function cell(v: string | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /["\r\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(request: Request): Promise<Response> {
  // FUNCTION-LEVEL AUTHORIZATION (Owner 2026-09-08 security fix). Match the SAME page gate the
  // Layaway page enforces (`nav_layaway`). Without this, any active staff member who cannot open
  // the Layaway page could still pull the FULL customer-PII CSV (names, balances, financers,
  // order/account numbers) by requesting this URL directly — the RPC's `is_active_staff()` check
  // alone is coarser than the page permission.
  if (!(await canOpenPage('nav_layaway'))) {
    return new Response('Forbidden', { status: 403 });
  }

  const url = new URL(request.url);
  const search = (url.searchParams.get('search') ?? '').trim();
  const financer = (url.searchParams.get('financer') ?? '').trim();
  const sectionParam = (url.searchParams.get('section') ?? 'all').trim();
  const section = (SECTIONS.has(sectionParam) ? sectionParam : 'all') as LayawaySection;

  const lines: string[] = [HEADERS.map(cell).join(',')];
  // MUST equal the reader's clamp: a bigger request is silently shrunk, and the short-page
  // exit below then ends the export after one chunk (system audit 2026-09-16).
  const SIZE = LAYAWAY_PAGE_MAX_SIZE;
  let page = 1;
  let total = 0;

  // Chunked server-side read. Bounded to 2,000 pages (200k rows) as a runaway guard; the loop
  // stops as soon as a short page or the known total is reached.
  for (let guard = 0; guard < 2000; guard += 1) {
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
    // Rows are re-read by id after the page RPC, so a short page does NOT mean "last page" — a
    // row the by-id read could not return would otherwise end the export early and ship a
    // silently truncated file. Stop on the server's total; fail LOUDLY on a short page.
    const expected = Math.min(SIZE, Math.max(0, total - (page - 1) * SIZE));
    if (res.rows.length < expected) {
      return new Response(
        'Export incomplete: some layaway rows could not be read. Nothing was downloaded — please try again.',
        { status: 500 },
      );
    }
    if (page * SIZE >= total) break;
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
