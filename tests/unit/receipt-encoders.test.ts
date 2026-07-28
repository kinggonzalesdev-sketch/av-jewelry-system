import { describe, expect, it } from 'vitest';

import type { OrderReceiptData } from '@/lib/print/order-receipt';
import {
  encodeLabelTspl,
  encodeReceiptEscPos,
  encodeTest,
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

describe('encodeReceiptEscPos', () => {
  it('starts with the ESC @ initialise sequence', () => {
    const bytes = encodeReceiptEscPos(data);
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it('prints the 4 sticker lines: name, item+grams, qty|price, date', () => {
    const text = asText(encodeReceiptEscPos(data));
    expect(text).toContain('King Gonzales');
    expect(text).toContain('Necklace 12.2');
    // ₱ folds to P on a thermal printer; the grouped amount survives.
    expect(text).toContain('Qty 1');
    expect(text).toContain('P12,000');
    expect(text).toContain('June 15, 2026');
  });

  it('shows an em dash for the price when there is none', () => {
    const text = asText(encodeReceiptEscPos({ ...data, unitPrice: null }));
    // "—" folds to "-" for the thermal printer.
    expect(text).toContain('Qty 1  |  -');
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

describe('encodeTest', () => {
  it('emits a short test in each language', () => {
    expect(asText(encodeTest('escpos'))).toContain('TEST PRINT');
    const tspl = asText(encodeTest('tspl'));
    expect(tspl).toContain('TEST PRINT');
    expect(tspl).toContain('PRINT 1,1');
  });

  it('KEEPS TSPL line breaks — stripping CR/LF breaks the whole label', () => {
    // Regression guard: asciify must not remove \r\n, or the TSPL program
    // collapses to one line and the printer prints nothing.
    const tspl = asText(encodeTest('tspl'));
    expect(tspl.split('\n').length).toBeGreaterThan(3);
    const label = asText(encodeLabelTspl(data));
    expect(label.split('\n').length).toBeGreaterThan(3);
  });
});

describe('encodeLabelTspl', () => {
  it('emits a 40x30mm label program with the sticker lines', () => {
    const text = asText(encodeLabelTspl(data));
    expect(text).toContain('SIZE 40 mm,30 mm');
    expect(text).toContain('GAP 2 mm,0 mm');
    expect(text).toContain('King Gonzales');
    expect(text).toContain('Necklace 12.2');
    expect(text).toContain('PRINT 1,1');
  });
});
