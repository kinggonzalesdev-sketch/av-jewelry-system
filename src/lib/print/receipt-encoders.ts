import { stickerLines, type OrderReceiptData } from '@/lib/print/order-receipt';

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

/** ESC/POS byte stream for the 4-line sticker. */
export function encodeReceiptEscPos(d: OrderReceiptData): Uint8Array {
  const [name, item, qtyPrice, date] = stickerLines(d);
  const out: number[] = [];
  const line = (s: string) => out.push(...bytesFromText(s), LF);

  out.push(ESC, 0x40); // ESC @  — initialise
  out.push(ESC, 0x45, 0x01); // ESC E 1 — bold on (the name)
  line(name ?? '');
  out.push(ESC, 0x45, 0x00); // bold off
  line(item ?? '');
  line(qtyPrice ?? '');
  line(date ?? '');
  out.push(LF, LF, LF); // feed clear of the tear bar
  out.push(GS, 0x56, 0x42, 0x00); // GS V B 0 — partial cut (no-op on label printers)

  return new Uint8Array(out);
}

/**
 * TSPL byte stream for the 4-line sticker on a 40×30 mm label. TSPL is line-based
 * ASCII, so the label program is just text.
 */
export function encodeLabelTspl(d: OrderReceiptData): Uint8Array {
  const [name, item, qtyPrice, date] = stickerLines(d);
  const t = (s: string) => asciify(s).replace(/"/g, '').slice(0, 30);
  const program = [
    'SIZE 40 mm,30 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 1',
    'CLS',
    `TEXT 12,12,"2",0,1,1,"${t(name ?? '')}"`,
    `TEXT 12,52,"1",0,1,1,"${t(item ?? '')}"`,
    `TEXT 12,84,"1",0,1,1,"${t(qtyPrice ?? '')}"`,
    `TEXT 12,116,"1",0,1,1,"${t(date ?? '')}"`,
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
