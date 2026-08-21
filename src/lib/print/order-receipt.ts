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
  /** Price-per-gram rate as a peso string, or null. Only printed if the "Price per
   *  gram" sticker field is enabled. */
  pricePerGram?: string | null;
  /** A FIXED total price (peso string). When set, the value line prints "FIXED • ₱X"
   *  instead of grams × rate — the Fixed Price capture mode. */
  fixedPrice?: string | null;
  /** Preformatted date, e.g. "August 6, 2026". */
  date: string;
};

/** Which lines the operator wants on the sticker (Sticker Settings). */
export type StickerField = 'name' | 'item' | 'price' | 'pricePerGram' | 'date';
export type StickerFields = Record<StickerField, boolean>;

/** Default sticker layout — Facebook name + price-per-gram + date (Owner request
 *  2026-08-06: item name and price were removed; price-per-gram was put back). All
 *  three are toggleable in Sticker Settings; the choice is stored per device. */
export const DEFAULT_STICKER_FIELDS: StickerFields = {
  name: true,
  item: false,
  price: false,
  pricePerGram: true,
  date: true,
};

export type StickerLine = { text: string; kind: StickerField };

/** Format a peso amount for a sticker — reuses the one centralized formatter so
 *  the sticker matches every other peso in the system (₱1,000 · ₱1,250.50). */
export function formatStickerPeso(amount: string): string {
  return formatPeso(amount.trim());
}

/**
 * Normalize a weight to its grams display: pull the number, drop trailing zeros and
 * any stray text/commas. Used by the screenshot-to-print flow, where the pinned
 * comment may be a bare number with no "g" (e.g. "11.5", "0.85", "20"). Returns null
 * when there is no usable positive number.
 *
 *   "11.50" -> "11.5"   "20" -> "20"   "0.70" -> "0.7"   "11.5g" -> "11.5"   "" -> null
 */
export function normalizeGrams(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // Match a decimal, a LEADING-decimal (".45"), or an integer. A leading decimal must keep its
  // value — ".45" is 0.45g and NEVER 45g — so it always gets an explicit leading zero. (The old
  // regex `\d+(?:\.\d+)?` matched ".45" as "45", turning 0.45g into 45g.)
  const match = String(value)
    .replace(/,/g, '')
    .match(/\d+(?:\.\d+)?|\.\d+/);
  if (!match) return null;
  const numStr = match[0].startsWith('.') ? `0${match[0]}` : match[0];
  const n = Number.parseFloat(numStr);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Number() drops trailing zeros: 11.50 -> 11.5, 20.0 -> 20, 0.70 -> 0.7, 0.10 -> 0.1.
  return String(n);
}

/**
 * Parse a FIXED-PRICE capture value into a peso amount string. In Fixed Price mode a bare
 * small number is shorthand for thousands (the seller types "12" for ₱12,000); an explicit
 * "k" suffix multiplies by 1,000; a comma-grouped or already-large number is literal:
 *
 *   "12" -> "12000"    "12.5" -> "12500"    "12k" -> "12000"    "12.5k" -> "12500"
 *   "12,000" -> "12000"    "12500" -> "12500"    "12,500" -> "12500"
 *
 * Returns the peso amount as a plain string, or null when there is no usable value.
 */
export function parseFixedPrice(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  // Strip a leading peso marker so "₱15,000", "P15000", "PHP 15000" all parse — the marker is an
  // explicit FIXED-PRICE signal, not part of the number.
  const s = String(value)
    .trim()
    .toLowerCase()
    .replace(/^(?:₱|php|p)\s*/, '');
  if (!s) return null;
  const hasK = /k$/.test(s);
  const hasComma = s.includes(',');
  const cleaned = s.replace(/[,\s]/g, '').replace(/k$/, '');
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  // "k", or a bare sub-1,000 number, means thousands; anything else is literal pesos.
  const pesos = hasK || (!hasComma && n < 1000) ? n * 1000 : n;
  return String(Math.round(pesos));
}

/** The Capture value's detected type — a weight in grams vs a fixed peso price. */
export type CaptureValueType = 'grams' | 'fixed';

/**
 * Classify a captured claim value (the OCR'd pinned-comment number) as grams vs a fixed price, so
 * Incoming Captures can auto-select the right mode. SAFE BY DESIGN — it never turns a realistic
 * jewelry gram weight into a price:
 *
 *   grams → a leading-decimal (".45") or any decimal ("0.45", "1.5", "3.39", "11.9") with no price
 *           signal; a bare integer ≤ 999 (matches the phone's ≤999-grams rule in gramsFromValue)
 *   fixed → an explicit price signal: a "k"/"K" suffix, a thousands comma, a ₱ / P / PHP marker; or
 *           a bare integer ≥ 1000 (no jewelry piece weighs ≥1000 g — that is a price)
 *
 * Returns null when there is no usable number (the caller keeps its default mode). The operator can
 * always override the mode manually.
 */
export function classifyCaptureValue(
  value: string | number | null | undefined,
): CaptureValueType | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim().toLowerCase();
  if (!s) return null;
  // Explicit price signals win.
  if (/k$/.test(s)) return 'fixed'; // 15k / 15K
  if (/^(?:₱|php|p)\s*\d/.test(s)) return 'fixed'; // ₱15000 / P15000 / PHP 15000
  if (s.includes(',')) return 'fixed'; // 15,000 (thousands grouping)
  // A decimal weight (leading-decimal ".45" or normal "0.45"/"1.5") is always grams.
  if (/^\.\d+$/.test(s) || /^\d+\.\d+$/.test(s)) return 'grams';
  // A bare integer: ≥1000 is a price, ≤999 is a gram weight (the safe boundary).
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10) >= 1000 ? 'fixed' : 'grams';
  return null; // no clean number → keep the default mode
}

/** The four sticker lines. Pure — the one place the format is defined. Order:
 *  Customer Name · Item (+grams) · Price · Date (the centered stack the Owner asked
 *  for). Price is its own prominent line; the quantity only shows when more than one
 *  piece, since a single-piece jewelry sticker shows just the amount. */
export function stickerLineItems(
  d: OrderReceiptData,
  fields: StickerFields = DEFAULT_STICKER_FIELDS,
): StickerLine[] {
  const out: StickerLine[] = [];
  if (fields.name) out.push({ text: d.customerName || '—', kind: 'name' });
  if (fields.item) {
    out.push({ text: d.grams ? `${d.itemName} ${d.grams}` : d.itemName, kind: 'item' });
  }
  if (fields.price) {
    const price = d.unitPrice ? formatStickerPeso(d.unitPrice) : '—';
    out.push({
      text: d.quantity > 1 ? `${d.quantity} x ${price}` : price,
      kind: 'price',
    });
  }
  if (fields.pricePerGram && d.fixedPrice) {
    // Fixed Price mode: a flat total instead of grams × rate, e.g. "FIXED • ₱12,500".
    out.push({ text: `FIXED • ${formatStickerPeso(d.fixedPrice)}`, kind: 'pricePerGram' });
  } else if (fields.pricePerGram && d.pricePerGram) {
    // Grams + rate on one line, e.g. "11.5g • ₱7,500/g" (the screenshot-to-print
    // format). Falls back to just the rate when the weight is unknown.
    const perGram = `${formatStickerPeso(d.pricePerGram)}/g`;
    const g = normalizeGrams(d.grams);
    out.push({ text: g ? `${g}g • ${perGram}` : perGram, kind: 'pricePerGram' });
  }
  if (fields.date) out.push({ text: d.date, kind: 'date' });
  return out;
}

/** Backward-compatible string lines with the DEFAULT fields (name · item · price · date). */
export function stickerLines(d: OrderReceiptData): string[] {
  return stickerLineItems(d).map((l) => l.text);
}

/** Today's date in long words, e.g. "August 6, 2026" (Owner request — not 08/06/2026). */
export function stickerDate(now: Date = new Date()): string {
  return now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
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
    lines.push(
      `${it.code}${it.name ? ` ${it.name}` : ''}${it.grams ? ` ${it.grams}g` : ''}`,
    );
    lines.push(
      `  Qty ${it.quantity} x ${formatStickerPeso(it.unitPrice)} = ${formatStickerPeso(it.lineTotal)}`,
    );
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

const CLASS_BY_KIND: Record<StickerField, string> = {
  name: 'name',
  item: 'item',
  price: 'price',
  pricePerGram: 'price',
  date: 'date',
};

function receiptHtml(
  d: OrderReceiptData,
  fields: StickerFields = DEFAULT_STICKER_FIELDS,
): string {
  const lines = stickerLineItems(d, fields)
    .map((l) => `<div class="${CLASS_BY_KIND[l.kind]}">${escapeHtml(l.text)}</div>`)
    .join('');
  return `<div class="stk">${lines}</div>`;
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

export function printOrderReceipt(
  data: OrderReceiptData,
  fields: StickerFields = DEFAULT_STICKER_FIELDS,
): void {
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
      fields,
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
export function printOrderStickers(
  items: OrderReceiptData[],
  fields: StickerFields = DEFAULT_STICKER_FIELDS,
): void {
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

  const body = items.map((d) => receiptHtml(d, fields)).join('');
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
