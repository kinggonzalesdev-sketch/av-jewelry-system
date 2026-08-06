import {
  formatStickerPeso,
  stickerLines,
  type OrderReceiptData,
  type OrderSlipData,
} from '@/lib/print/order-receipt';

/**
 * Pure encoders that turn an order slip into printer bytes. No I/O here, so they
 * are fully unit-testable; the Bluetooth transport lives in bluetooth-printer.ts.
 *
 * Two languages, because a thermal device speaks one or the other:
 *   - ESC/POS — receipt printers (and many thermal printers in "receipt" mode).
 *   - TSPL    — TSC/label printers; the XP-236B is a 40×30 mm LABEL printer, so
 *               this is the likely-correct one. Which one actually prints must be
 *               confirmed on the real device (see the hardware audit).
 *
 * Money is passed through as the authoritative string — never re-computed here.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Thermal/label printers are ASCII/codepage devices — a multi-byte UTF-8
 * character (e.g. the em dash "—" in an item label, or "₱") is not understood and
 * can make a TSPL/ESC-POS command fail to print. So we fold text to plain ASCII
 * before sending. This is why the pure-ASCII test print worked while a real slip
 * (with "—") did not.
 */
function asciify(s: string): string {
  return (
    s
      .replace(/[—–]/g, '-')
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/₱/g, 'P')
      // Strip other non-ASCII, but KEEP tab/CR/LF — TSPL programs are line-based,
      // so removing CR/LF (as an earlier version did) breaks the whole label.
      .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
  );
}

function bytesFromText(s: string): number[] {
  return Array.from(new TextEncoder().encode(asciify(s)));
}

/**
 * Greedy word-wrap `text` to at most `maxLines` lines, each within `maxChars`.
 * Returns null when it does not fit (a single word longer than a line, or too many
 * lines) so the caller can step down to a smaller font — never crops.
 */
export function wrapWords(text: string, maxChars: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (w.length > maxChars) return null; // a single word cannot fit at this size
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars) {
      cur = next;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) return null;
    }
  }
  if (cur) lines.push(cur);
  return lines.length <= maxLines ? lines : null;
}

/* --------------------------------------------------------------------------- *
 * TSPL sticker layout — centered, sized, wrapped.
 *
 * A 40×30 mm label at the XP-236B's 203 dpi is 320×240 dots (8 dots/mm). We keep a
 * safe margin, size each line with the TSC internal bitmap fonts (name/price largest,
 * item slightly smaller, date medium), wrap long name/item to two lines, and center
 * the whole block both horizontally (per line) and vertically. Reducing a line's font
 * happens ONLY when it still overflows after wrapping — never for the whole sticker.
 * --------------------------------------------------------------------------- */

/** TSC internal bitmap font cell sizes (dots): [width, height]. */
const TSPL_FONT: Record<string, { w: number; h: number }> = {
  '1': { w: 8, h: 12 },
  '2': { w: 12, h: 20 },
  '3': { w: 16, h: 24 },
  '4': { w: 24, h: 32 },
};

/** Safe font-cell lookup (falls back to font 2 for an unknown key). */
function cell(font: string): { w: number; h: number } {
  return TSPL_FONT[font] ?? { w: 12, h: 20 };
}

const LABEL_W = 320; // 40 mm @ 203 dpi
const LABEL_H = 240; // 30 mm @ 203 dpi
const MARGIN_X = 16; // safe left/right margin (never touch the edge)
const PRINTABLE_W = LABEL_W - MARGIN_X * 2;
const LINE_GAP = 10; // vertical gap between physical lines

type SizedLine = { text: string; font: string };

/**
 * Fit one logical element into 1–2 physical lines at the largest font in `fontOrder`
 * that fits, wrapping to two lines when needed. Steps down a font only if a single
 * word still overflows; as a last resort hard-wraps by characters so nothing is lost.
 */
function fitElement(text: string, fontOrder: string[]): SizedLine[] {
  const t = asciify(text).replace(/"/g, '').trim();
  for (const font of fontOrder) {
    const maxChars = Math.max(1, Math.floor(PRINTABLE_W / cell(font).w));
    if (t.length <= maxChars) return [{ text: t, font }];
    const wrapped = wrapWords(t, maxChars, 2);
    if (wrapped) return wrapped.map((line) => ({ text: line, font }));
  }
  const font = fontOrder[fontOrder.length - 1] ?? '2';
  const maxChars = Math.max(1, Math.floor(PRINTABLE_W / cell(font).w));
  const lines: string[] = [];
  for (let i = 0; i < t.length; i += maxChars) lines.push(t.slice(i, i + maxChars));
  return (lines.length ? lines : ['']).map((line) => ({ text: line, font }));
}

/** All physical sticker lines, sized by the hierarchy (name/price large, item a step
 *  down, date medium). */
export function tsplStickerLines(d: OrderReceiptData): SizedLine[] {
  const [name, item, price, date] = stickerLines(d);
  return [
    // Name + price start at font 3 (not 4) so a longer name fits on ONE line
    // (~18 chars) instead of wrapping — e.g. "KING GONZALES" stays whole. They
    // still step down to font 2 for very long text before wrapping (Owner request).
    ...fitElement(name ?? '', ['3', '2']), // Customer Name
    ...fitElement(item ?? '', ['3', '2']), // Item
    ...fitElement(price ?? '', ['3', '2']), // Price
    ...fitElement(date ?? '', ['2']), // Date — medium
  ];
}

/** Position the sized lines centered both ways and emit the TSPL TEXT commands. */
function layoutTsplText(lines: SizedLine[]): string[] {
  const heights = lines.map((l) => cell(l.font).h);
  const totalH = heights.reduce((a, b) => a + b, 0) + LINE_GAP * Math.max(0, lines.length - 1);
  let y = Math.max(8, Math.round((LABEL_H - totalH) / 2));
  const cmds: string[] = [];
  lines.forEach((l, i) => {
    const lineW = l.text.length * cell(l.font).w;
    const x = Math.max(MARGIN_X, Math.round((LABEL_W - lineW) / 2));
    cmds.push(`TEXT ${x},${y},"${l.font}",0,1,1,"${l.text}"`);
    y += (heights[i] ?? 0) + LINE_GAP;
  });
  return cmds;
}

/** ESC/POS character size byte for GS ! (width/height magnification 1..8). */
function gsSize(widthTimes: number, heightTimes: number): number {
  return ((widthTimes - 1) << 4) | (heightTimes - 1);
}

/**
 * ESC/POS byte stream for the 4-line sticker — centered, with the size hierarchy
 * (name/price double, item slightly smaller, date normal) and long name/item wrapped
 * to two lines. A leading feed gives balanced top spacing on a continuous receipt.
 */
export function encodeReceiptEscPos(d: OrderReceiptData): Uint8Array {
  const [name, item, price, date] = stickerLines(d);
  const out: number[] = [];
  const emit = (
    text: string,
    widthTimes: number,
    heightTimes: number,
    bold: boolean,
    maxChars: number | null,
  ) => {
    out.push(GS, 0x21, gsSize(widthTimes, heightTimes));
    out.push(ESC, 0x45, bold ? 0x01 : 0x00);
    const lines =
      maxChars !== null ? (wrapWords(asciify(text), maxChars, 2) ?? [text]) : [text];
    for (const l of lines) out.push(...bytesFromText(l), LF);
    out.push(ESC, 0x45, 0x00);
    out.push(GS, 0x21, 0x00);
  };

  out.push(ESC, 0x40); // initialise
  out.push(ESC, 0x61, 0x01); // center align
  out.push(LF); // top spacing for vertical balance

  // Name + price at normal width (×1), tall (×2) so a longer name fits on one line
  // (~24 chars) instead of wrapping; still bold for prominence (Owner request).
  emit(name ?? '', 1, 2, true, 24); // Customer Name — bold
  emit(item ?? '', 1, 2, true, 24); // Item — bold
  emit(price ?? '', 1, 2, true, null); // Price — bold
  emit(date ?? '', 1, 1, false, null); // Date — medium

  out.push(LF, LF, LF); // feed clear of the tear bar
  out.push(ESC, 0x61, 0x00); // back to left align
  out.push(GS, 0x56, 0x42, 0x00); // partial cut (no-op on label printers)

  return new Uint8Array(out);
}

/**
 * TSPL byte stream for the 4-line sticker on a 40×30 mm label. Centered both ways,
 * sized by the hierarchy, long name/item wrapped to two lines. TSPL is line-based
 * ASCII, so the label program is just text.
 */
export function encodeLabelTspl(d: OrderReceiptData): Uint8Array {
  const program = [
    'SIZE 40 mm,30 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 1',
    'CLS',
    ...layoutTsplText(tsplStickerLines(d)),
    'PRINT 1,1',
    '',
  ].join('\r\n');

  return new Uint8Array(bytesFromText(program));
}

export type ReceiptLanguage = 'escpos' | 'tspl';

export function encodeReceipt(
  d: OrderReceiptData,
  language: ReceiptLanguage,
): Uint8Array {
  return language === 'tspl' ? encodeLabelTspl(d) : encodeReceiptEscPos(d);
}

/** ESC/POS byte stream for the combined multi-item slip (full itemized receipt). */
export function encodeSlipEscPos(d: OrderSlipData): Uint8Array {
  const out: number[] = [];
  const line = (s: string) => out.push(...bytesFromText(s), LF);

  out.push(ESC, 0x40); // init
  out.push(ESC, 0x61, 0x01); // centre
  out.push(ESC, 0x45, 0x01); // bold on
  line('A.V. JEWELRY');
  out.push(ESC, 0x45, 0x00); // bold off
  line(`Order ${d.orderNumber || '-'}`);
  out.push(ESC, 0x61, 0x00); // left
  line(`Customer: ${d.customerName || '-'}`);
  line('------------------------------');
  for (const it of d.items) {
    line(`${it.code}${it.name ? ` ${it.name}` : ''}${it.grams ? ` ${it.grams}g` : ''}`);
    line(`  Qty ${it.quantity} x ${formatStickerPeso(it.unitPrice)} = ${formatStickerPeso(it.lineTotal)}`);
  }
  line('------------------------------');
  out.push(ESC, 0x45, 0x01);
  line(`GRAND TOTAL: ${formatStickerPeso(d.grandTotal)}`);
  out.push(ESC, 0x45, 0x00);
  line(`Salesperson: ${d.salesperson || '-'}`);
  line(d.dateTime);
  out.push(LF, LF, LF);
  out.push(GS, 0x56, 0x42, 0x00); // partial cut (no-op on label printers)
  return new Uint8Array(out);
}

/**
 * TSPL for the combined slip on a 40×30 mm LABEL. A small label cannot list many
 * items, so it prints a compact summary (customer, order#, item count, grand total);
 * the itemized detail is on the browser/receipt slip. Honest by design.
 */
export function encodeSlipTspl(d: OrderSlipData): Uint8Array {
  const t = (s: string) => asciify(s).replace(/"/g, '').slice(0, 30);
  const program = [
    'SIZE 40 mm,30 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 1',
    'CLS',
    `TEXT 12,12,"2",0,1,1,"${t(d.customerName || '-')}"`,
    `TEXT 12,48,"1",0,1,1,"${t(`Order ${d.orderNumber || '-'}`)}"`,
    `TEXT 12,76,"1",0,1,1,"${t(`${d.items.length} item(s)`)}"`,
    `TEXT 12,104,"1",0,1,1,"${t(`TOTAL ${formatStickerPeso(d.grandTotal)}`)}"`,
    'PRINT 1,1',
    '',
  ].join('\r\n');
  return new Uint8Array(bytesFromText(program));
}

export function encodeSlip(d: OrderSlipData, language: ReceiptLanguage): Uint8Array {
  return language === 'tspl' ? encodeSlipTspl(d) : encodeSlipEscPos(d);
}

/** A short test print, used to find the working channel/language on a real device. */
export function encodeTest(language: ReceiptLanguage): Uint8Array {
  if (language === 'tspl') {
    const program = [
      'SIZE 40 mm,30 mm',
      'GAP 2 mm,0 mm',
      'DIRECTION 1',
      'CLS',
      `TEXT 16,20,"3",0,1,1,"A.V. Jewelry"`,
      `TEXT 16,60,"2",0,1,1,"TEST PRINT"`,
      'PRINT 1,1',
      '',
    ].join('\r\n');
    return new Uint8Array(bytesFromText(program));
  }
  const out: number[] = [];
  out.push(ESC, 0x40); // init
  out.push(ESC, 0x61, 0x01); // centre
  out.push(...bytesFromText('A.V. Jewelry\nTEST PRINT'), LF, LF, LF, LF);
  out.push(GS, 0x56, 0x42, 0x00); // cut (no-op on label printers)
  return new Uint8Array(out);
}
