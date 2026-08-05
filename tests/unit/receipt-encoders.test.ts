import { describe, expect, it } from 'vitest';

import { stickerLines, type OrderReceiptData } from '@/lib/print/order-receipt';
import {
  encodeLabelTspl,
  encodeReceiptEscPos,
  encodeTest,
  tsplStickerLines,
  wrapWords,
} from '@/lib/print/receipt-encoders';

const data: OrderReceiptData = {
  customerName: 'King Gonzales',
  itemName: 'Necklace',
  grams: '12.2',
  quantity: 1,
  unitPrice: '12000',
  date: 'June 15, 2026',
};

const asText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('stickerLines content', () => {
  it('is Name · Item+grams · Price · Date, price only (no "Qty") for a single piece', () => {
    expect(stickerLines(data)).toEqual([
      'King Gonzales',
      'Necklace 12.2',
      '₱12,000',
      'June 15, 2026',
    ]);
  });

  it('shows the quantity only when more than one piece', () => {
    expect(stickerLines({ ...data, quantity: 3 })[2]).toBe('3 x ₱12,000');
  });

  it('shows an em dash for the price when there is none', () => {
    expect(stickerLines({ ...data, unitPrice: null })[2]).toBe('—');
  });
});

describe('encodeReceiptEscPos', () => {
  it('starts with ESC @ and centers the content (ESC a 1)', () => {
    const bytes = encodeReceiptEscPos(data);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    // ESC a 1 — center align — is present.
    let centered = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1b && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x01) centered = true;
    }
    expect(centered).toBe(true);
  });

  it('prints the sticker content with the price on its own line (no "Qty")', () => {
    const text = asText(encodeReceiptEscPos(data));
    // The long two-word name wraps to two centered lines.
    expect(text).toContain('King');
    expect(text).toContain('Gonzales');
    expect(text).toContain('Necklace 12.2');
    // ₱ folds to P on a thermal printer; the grouped amount survives.
    expect(text).toContain('P12,000');
    expect(text).not.toContain('Qty');
    expect(text).toContain('June 15, 2026');
  });
});

describe('non-ASCII is folded to ASCII (thermal printers need it)', () => {
  it('folds the ₱ sign and any special item name so the label still prints', () => {
    const withUnicode = { ...data, itemName: 'Singsing – 21K' };
    for (const bytes of [
      encodeReceiptEscPos(withUnicode),
      encodeLabelTspl(withUnicode),
    ]) {
      const text = asText(bytes);
      expect(text).toContain('Singsing - 21K');
      expect(text).not.toContain('₱');
      // Every byte is printable ASCII or a control byte the encoder emitted.
      expect(bytes.every((b) => b <= 0x7f)).toBe(true);
    }
  });
});

describe('wrapWords', () => {
  it('keeps short text on one line', () => {
    expect(wrapWords('K18 HK ITEM RING', 18, 2)).toEqual(['K18 HK ITEM RING']);
  });
  it('wraps a long two-word name to two lines', () => {
    expect(wrapWords('King Gonzales', 12, 2)).toEqual(['King', 'Gonzales']);
  });
  it('returns null when it cannot fit (so the caller shrinks, never crops)', () => {
    expect(wrapWords('Supercalifragilistic', 8, 2)).toBeNull();
  });
});

describe('encodeTest', () => {
  it('emits a short test in each language', () => {
    expect(asText(encodeTest('escpos'))).toContain('TEST PRINT');
    const tspl = asText(encodeTest('tspl'));
    expect(tspl).toContain('TEST PRINT');
    expect(tspl).toContain('PRINT 1,1');
  });

  it('KEEPS TSPL line breaks — stripping CR/LF breaks the whole label', () => {
    const tspl = asText(encodeTest('tspl'));
    expect(tspl.split('\n').length).toBeGreaterThan(3);
    const label = asText(encodeLabelTspl(data));
    expect(label.split('\n').length).toBeGreaterThan(3);
  });
});

describe('encodeLabelTspl', () => {
  it('emits a 40x30mm label program with the sticker content, centered', () => {
    const text = asText(encodeLabelTspl(data));
    expect(text).toContain('SIZE 40 mm,30 mm');
    expect(text).toContain('GAP 2 mm,0 mm');
    // Name wraps to two lines; the item and price sit on their own lines.
    expect(text).toContain('"King"');
    expect(text).toContain('"Gonzales"');
    expect(text).toContain('Necklace 12.2');
    expect(text).toContain('P12,000');
    expect(text).toContain('PRINT 1,1');
  });

  it('sizes the name/price larger (font 4) than the item (font 3) and date (font 2)', () => {
    const lines = tsplStickerLines(data);
    // name -> font 4, item -> font 3, price -> font 4, date -> font 2
    expect(lines.find((l) => l.text === 'Necklace 12.2')?.font).toBe('3');
    expect(lines.find((l) => l.text === 'P12,000')?.font).toBe('4');
    expect(lines.find((l) => l.text === 'June 15, 2026')?.font).toBe('2');
  });

  it('centers each line horizontally within the 320-dot label', () => {
    const text = asText(encodeLabelTspl(data));
    // A short line like the price is pushed well right of the margin (centered),
    // never printed hard against the left edge (x=16 was the old fixed margin).
    const priceCmd = text.split(/\r?\n/).find((l) => l.includes('P12,000')) ?? '';
    const x = Number(priceCmd.match(/^TEXT (\d+),/)?.[1] ?? '0');
    expect(x).toBeGreaterThan(40);
  });
});
