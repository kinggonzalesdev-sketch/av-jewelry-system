/**
 * Printable / reprintable invoice document (client-only).
 *
 * Builds a clean A-something invoice from REAL draft/order data and prints it via
 * the browser's own dialog (a hidden iframe — works after an async action and is
 * never popup-blocked), exactly like the order-receipt fallback. It prints only
 * what it is given; it never recomputes a stored money figure beyond laying out
 * the line quantities × the item's stored per-piece price (the same basis the
 * invoice total already uses server-side). Reprintable: call it again any time.
 */

import { formatPeso, moneyString } from '@/lib/payments/format';

export type InvoiceDocLine = {
  reference: string;
  itemName: string | null;
  itemCode: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
};

export type InvoiceDocData = {
  status: string;
  invoiceNumber: string | null;
  orderNumber: string | null;
  customerName: string;
  paymentArrangement: string | null;
  fulfillmentArrangement: string | null;
  lines: InvoiceDocLine[];
  total: number;
  /** Preformatted date, e.g. "July 22, 2026". */
  date: string;
};

/** Reuse the one centralized peso formatter (₱1,000 · ₱1,250.50). */
function peso(n: number): string {
  return formatPeso(moneyString(n));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, Arial, sans-serif; color: #111; }
  .inv { width: 640px; max-width: 100%; padding: 28px 32px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: .5px; }
  .brand small { display: block; font-size: 11px; font-weight: 500; color: #555; letter-spacing: 1px; }
  .meta { text-align: right; font-size: 12px; color: #333; }
  .meta .no { font-size: 15px; font-weight: 700; color: #111; }
  .to { margin: 16px 0 4px; font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: .5px; }
  .cust { font-size: 16px; font-weight: 700; }
  .arr { margin-top: 4px; font-size: 12px; color: #444; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th { text-align: left; border-bottom: 1px solid #999; padding: 6px 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #555; }
  td { padding: 7px 4px; border-bottom: 1px solid #eee; }
  td.r, th.r { text-align: right; }
  tfoot td { border-top: 2px solid #111; border-bottom: none; font-weight: 800; font-size: 15px; padding-top: 10px; }
  .status { display: inline-block; margin-top: 2px; font-size: 11px; color: #555; }
  .foot { margin-top: 22px; font-size: 11px; color: #777; border-top: 1px solid #eee; padding-top: 10px; }
  @media print { @page { margin: 12mm; } }
`;

function invoiceHtml(d: InvoiceDocData): string {
  const rows = d.lines
    .map(
      (l) => `
      <tr>
        <td>${escapeHtml(l.reference)}</td>
        <td>${escapeHtml(l.itemName ?? l.itemCode ?? '—')}</td>
        <td class="r">${l.quantity}</td>
        <td class="r">${peso(l.unitPrice)}</td>
        <td class="r">${peso(l.lineTotal)}</td>
      </tr>`,
    )
    .join('');

  const arrangement = [d.paymentArrangement, d.fulfillmentArrangement]
    .filter(Boolean)
    .map((s) => escapeHtml((s ?? '').replace(/_/g, ' ')))
    .join(' · ');

  return `
    <div class="inv">
      <div class="head">
        <div class="brand">A.V. Jewelry<small>INVOICE</small></div>
        <div class="meta">
          <div class="no">${escapeHtml(d.invoiceNumber ?? 'DRAFT (not yet approved)')}</div>
          <div>${escapeHtml(d.date)}</div>
          <div class="status">${escapeHtml(d.status.replace(/_/g, ' '))}</div>
        </div>
      </div>

      <div class="to">Bill to</div>
      <div class="cust">${escapeHtml(d.customerName)}</div>
      ${arrangement ? `<div class="arr">${arrangement}</div>` : ''}

      <table>
        <thead>
          <tr>
            <th>Claim</th><th>Item</th><th class="r">Qty</th>
            <th class="r">Unit price</th><th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5">No line items.</td></tr>'}</tbody>
        <tfoot>
          <tr><td colspan="4" class="r">Total</td><td class="r">${peso(d.total)}</td></tr>
        </tfoot>
      </table>

      <div class="foot">
        ${
          d.invoiceNumber
            ? 'Official invoice. Reprint does not change the order or its stock.'
            : 'Draft invoice — not yet approved. Approve &amp; Send creates the Official Order.'
        }
      </div>
    </div>
  `;
}

export function printInvoice(data: InvoiceDocData): void {
  if (typeof window === 'undefined') return;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><title>${escapeHtml(
      data.invoiceNumber ?? `Invoice draft — ${data.customerName}`,
    )}</title><style>${STYLE}</style></head><body>${invoiceHtml(data)}</body></html>`,
  );
  doc.close();

  const cleanup = () =>
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);

  iframe.contentWindow?.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } finally {
      cleanup();
    }
  }, 50);
}
