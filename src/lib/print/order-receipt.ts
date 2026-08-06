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

/** The four sticker lines. Pure — the one place the format is defined. Order:
 *  Customer Name · Item (+grams) · Price · Date (the centered stack the Owner asked
 *  for). Price is its own prominent line; the quantity only shows when more than one
 *  piece, since a single-piece jewelry sticker shows just the amount. */
export function stickerLines(d: OrderReceiptData): string[] {
  const price = d.unitPrice ? formatStickerPeso(d.unitPrice) : '—';
  const priceLine = d.quantity > 1 ? `${d.quantity} x ${price}` : price;
  return [
    d.customerName || '—',
    d.grams ? `${d.itemName} ${d.grams}` : d.itemName,
    priceLine,
    d.date,
  ];
}

/** Today's date as "08/06/2026" (compact numeric, the approved sticker format). */
export function stickerDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/* ------------------------------------------------------------------------- *
 * Combined multi-item order slip (Owner request 2026-07-28). One slip lists
 * every item on the order plus the grand total — used by both New Entry and
 * Walk-In. On a receipt printer (ESC/POS) it prints itemized; on a small label
 * printer (TSPL) it prints a compact summary; the browser fallback below always
 * prints the full itemized slip. Money is passed through as authoritative
 * strings, never re-computed here.
 * ------------------------------------------------------------------------- */

export type OrderSlipItem = {
  code: string;
  name: string;
  grams: string | null;
  unitPrice: string;
  quantity: number;
  /** Unit Price × Quantity, precomputed as an authoritative string. */
  lineTotal: string;
};

export type OrderSlipData = {
  orderNumber: string;
  customerName: string;
  salesperson: string;
  /** Preformatted date + time, e.g. "June 15, 2026, 3:24 PM". */
  dateTime: string;
  items: OrderSlipItem[];
  /** Sum of all line totals, as an authoritative string. */
  grandTotal: string;
};

/** Today's date + time, e.g. "June 15, 2026, 3:24 PM". */
export function slipDateTime(now: Date = new Date()): string {
  return now.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Plain-text lines for the combined slip (thermal receipt path). */
export function slipLines(d: OrderSlipData): string[] {
  const lines: string[] = [
    'A.V. JEWELRY',
    `Order ${d.orderNumber || '—'}`,
    d.customerName || '—',
    '------------------------------',
  ];
  for (const it of d.items) {
    lines.push(`${it.code}${it.name ? ` ${it.name}` : ''}${it.grams ? ` ${it.grams}g` : ''}`);
    lines.push(`  Qty ${it.quantity} x ${formatStickerPeso(it.unitPrice)} = ${formatStickerPeso(it.lineTotal)}`);
  }
  lines.push('------------------------------');
  lines.push(`GRAND TOTAL: ${formatStickerPeso(d.grandTotal)}`);
  lines.push(`Salesperson: ${d.salesperson || '—'}`);
  lines.push(d.dateTime);
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function receiptHtml(d: OrderReceiptData): string {
  const [name, item, price, date] = stickerLines(d);
  return `
    <div class="stk">
      <div class="name">${escapeHtml(name ?? '')}</div>
      <div class="item">${escapeHtml(item ?? '')}</div>
      <div class="price">${escapeHtml(price ?? '')}</div>
      <div class="date">${escapeHtml(date ?? '')}</div>
    </div>
  `;
}

// Centered both ways in the middle printable area of the 40×30 mm sticker, with a
// clear size hierarchy (name/price largest, item slightly smaller, date medium) and
// long names/items wrapping to two centered lines. No content near the edges.
const RECEIPT_STYLE = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: ui-monospace, Menlo, Consolas, monospace; color: #000; }
  .stk {
    width: 40mm; min-height: 30mm; padding: 2mm 2.5mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: 1.1mm; line-height: 1.12;
  }
  .stk > div { width: 100%; overflow-wrap: break-word; word-break: break-word; }
  /* Name + price a touch smaller (was 30/28) so a longer name fits on one line
     before wrapping — matches the thermal label sizing. */
  .name { font-size: 25px; font-weight: 800; }
  .item { font-size: 24px; font-weight: 700; }
  .price { font-size: 25px; font-weight: 800; }
  .date { font-size: 21px; font-weight: 500; }
  /* One sticker per label: break to a new page BETWEEN stickers (never a trailing
     blank page). */
  .stk + .stk { break-before: page; page-break-before: always; }
  @media print { @page { size: 40mm 30mm; margin: 0; } }
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

/**
 * Browser-print fallback for one-sticker-per-item: prints every item's sticker, each
 * on its own 40×30 mm page (page break between), in a single print dialog. Used by New
 * Entry so a multi-item order yields one centered sticker per piece — the same format
 * as the direct-to-printer path.
 */
export function printOrderStickers(items: OrderReceiptData[]): void {
  if (typeof window === 'undefined' || items.length === 0) return;

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

  const body = items.map((d) => receiptHtml(d)).join('');
  const title = items[0]?.customerName ?? 'Stickers';
  doc.open();
  doc.write(
    `<!doctype html><html><head><title>${escapeHtml(
      title,
    )}</title><style>${RECEIPT_STYLE}</style></head><body>${body}</body></html>`,
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

const SLIP_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-monospace, Menlo, Consolas, monospace; color: #000; }
  .slip { width: 300px; padding: 12px 14px; line-height: 1.4; font-size: 12px; }
  .hd { text-align: center; font-weight: 700; font-size: 14px; }
  .sub { text-align: center; font-size: 11px; margin-bottom: 6px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .rule { border-top: 1px dashed #000; margin: 6px 0; }
  .it { margin: 3px 0; }
  .it .nm { font-weight: 600; }
  .it .ln { display: flex; justify-content: space-between; }
  .tot { display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; }
  .meta { font-size: 11px; margin-top: 6px; }
  @media print { @page { margin: 4mm; } }
`;

function slipHtml(d: OrderSlipData): string {
  const items = d.items
    .map(
      (it) => `
      <div class="it">
        <div class="nm">${escapeHtml(it.code)}${it.name ? ` ${escapeHtml(it.name)}` : ''}${
          it.grams ? ` <span>${escapeHtml(it.grams)}g</span>` : ''
        }</div>
        <div class="ln"><span>Qty ${it.quantity} × ${escapeHtml(
          formatStickerPeso(it.unitPrice),
        )}</span><span>${escapeHtml(formatStickerPeso(it.lineTotal))}</span></div>
      </div>`,
    )
    .join('');
  return `
    <div class="slip">
      <div class="hd">A.V. JEWELRY</div>
      <div class="sub">Order ${escapeHtml(d.orderNumber || '—')}</div>
      <div class="row"><span>Customer</span><span>${escapeHtml(d.customerName || '—')}</span></div>
      <div class="rule"></div>
      ${items}
      <div class="rule"></div>
      <div class="tot"><span>GRAND TOTAL</span><span>${escapeHtml(
        formatStickerPeso(d.grandTotal),
      )}</span></div>
      <div class="meta">Salesperson: ${escapeHtml(d.salesperson || '—')}</div>
      <div class="meta">${escapeHtml(d.dateTime)}</div>
    </div>
  `;
}

/** Browser-print fallback for the combined multi-item slip (full itemized). */
export function printOrderSlip(data: OrderSlipData): void {
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
      data.orderNumber || data.customerName,
    )}</title><style>${SLIP_STYLE}</style></head><body>${slipHtml(data)}</body></html>`,
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
