/**
 * Order sticker print — a compact item label (Owner-approved format 2026-07-22):
 *
 *     Fb Name
 *     Item  Grams
 *     Qty N  |  PHP price
 *     Date
 *
 * `stickerLines` is the single source of truth for the four lines, shared by the
 * thermal encoders (receipt-encoders.ts) and this browser-print fallback so every
 * print path shows the same thing.
 *
 * The browser path (below) opens the OS/browser print dialog via a hidden iframe
 * (works after an async action, never popup-blocked). It is the manual fallback;
 * the Bluetooth path prints directly to the XP-236B.
 */

import { formatPeso } from '@/lib/payments/format';

export type OrderReceiptData = {
  /** Facebook / customer name. */
  customerName: string;
  /** Item name only (no code). */
  itemName: string;
  /** Weight as a string (e.g. "12.2"), or null when unknown. */
  grams: string | null;
  quantity: number;
  /** Authoritative peso string, or null when there is no price yet. */
  unitPrice: string | null;
  /** Preformatted date, e.g. "June 15, 2026". */
  date: string;
};

/** Format a peso amount for a sticker — reuses the one centralized formatter so
 *  the sticker matches every other peso in the system (₱1,000 · ₱1,250.50). */
export function formatStickerPeso(amount: string): string {
  return formatPeso(amount.trim());
}

/** The four sticker lines. Pure — the one place the format is defined. */
export function stickerLines(d: OrderReceiptData): string[] {
  const price = d.unitPrice ? formatStickerPeso(d.unitPrice) : '—';
  return [
    d.customerName || '—',
    d.grams ? `${d.itemName} ${d.grams}` : d.itemName,
    `Qty ${d.quantity}  |  ${price}`,
    d.date,
  ];
}

/** Today's date as "June 15, 2026". */
export function stickerDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function receiptHtml(d: OrderReceiptData): string {
  const [name, item, qtyPrice, date] = stickerLines(d);
  return `
    <div class="stk">
      <div class="name">${escapeHtml(name ?? '')}</div>
      <div class="item">${escapeHtml(item ?? '')}</div>
      <div class="qp">${escapeHtml(qtyPrice ?? '')}</div>
      <div class="date">${escapeHtml(date ?? '')}</div>
    </div>
  `;
}

const RECEIPT_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-monospace, Menlo, Consolas, monospace; color: #000; }
  .stk { width: 260px; padding: 10px 12px; line-height: 1.5; }
  .name { font-size: 15px; font-weight: 700; }
  .item { font-size: 13px; }
  .qp { font-size: 13px; font-weight: 600; }
  .date { font-size: 12px; }
  @media print { @page { margin: 4mm; } }
`;

export function printOrderReceipt(data: OrderReceiptData): void {
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
      data.customerName,
    )}</title><style>${RECEIPT_STYLE}</style></head><body>${receiptHtml(
      data,
    )}</body></html>`,
  );
  doc.close();

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);
  };

  iframe.contentWindow?.focus();
  setTimeout(() => {
    try {
      iframe.contentWindow?.print();
    } finally {
      cleanup();
    }
  }, 50);
}
