import { describe, expect, it } from 'vitest';

import {
  normalizeGrams,
  parseFixedPrice,
  classifyCaptureValue,
  stickerLineItems,
  stickerLines,
  type OrderReceiptData,
  type StickerFields,
} from '@/lib/print/order-receipt';
import {
  encodeLabelTspl,
  encodeReceiptEscPos,
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

/** All lines on — for tests that exercise the item/price rendering explicitly. The
 *  DEFAULT is now name + date only (Owner removed item/price/price-per-gram). */
const ALL: StickerFields = {
  name: true,
  item: true,
  price: true,
  pricePerGram: false,
  date: true,
};

describe('parseFixedPrice (Fixed Price capture mode)', () => {
  it('bare small number = thousands, "k" = thousands, large/comma = literal', () => {
    expect(parseFixedPrice('12')).toBe('12000');
    expect(parseFixedPrice('12.5')).toBe('12500');
    expect(parseFixedPrice('12k')).toBe('12000');
    expect(parseFixedPrice('12.5k')).toBe('12500');
    expect(parseFixedPrice('12,000')).toBe('12000');
    expect(parseFixedPrice('12500')).toBe('12500');
    expect(parseFixedPrice('12,500')).toBe('12500');
  });
  it('returns null for empty / non-numeric', () => {
    expect(parseFixedPrice('')).toBeNull();
    expect(parseFixedPrice(null)).toBeNull();
    expect(parseFixedPrice('abc')).toBeNull();
  });
  it('strips a leading peso marker ₱ / P / PHP', () => {
    expect(parseFixedPrice('₱15,000')).toBe('15000');
    expect(parseFixedPrice('₱15000')).toBe('15000');
    expect(parseFixedPrice('P15000')).toBe('15000');
    expect(parseFixedPrice('PHP 15000')).toBe('15000');
    expect(parseFixedPrice('php15000')).toBe('15000');
    expect(parseFixedPrice('15000')).toBe('15000');
    expect(parseFixedPrice('15,000')).toBe('15000');
    expect(parseFixedPrice('15k')).toBe('15000');
    expect(parseFixedPrice('15K')).toBe('15000');
  });
});

describe('normalizeGrams — leading-decimal normalization', () => {
  it('a leading decimal gets a leading zero and stays grams (never a whole number)', () => {
    expect(normalizeGrams('.10')).toBe('0.1');
    expect(normalizeGrams('.20')).toBe('0.2');
    expect(normalizeGrams('.45')).toBe('0.45');
    expect(normalizeGrams('.7')).toBe('0.7');
  });
  it('regular gram weights are preserved (trailing zeros dropped by convention)', () => {
    expect(normalizeGrams('0.45')).toBe('0.45');
    expect(normalizeGrams('1.5')).toBe('1.5');
    expect(normalizeGrams('3.39')).toBe('3.39');
    expect(normalizeGrams('11.9')).toBe('11.9');
    expect(normalizeGrams('11.50')).toBe('11.5');
    expect(normalizeGrams('0.70')).toBe('0.7');
    expect(normalizeGrams('20')).toBe('20');
  });
  it('reads a bare weight out of a longer string; rejects non-numbers', () => {
    expect(normalizeGrams('Mine .45')).toBe('0.45');
    expect(normalizeGrams('')).toBeNull();
    expect(normalizeGrams('abc')).toBeNull();
  });
});

describe('classifyCaptureValue — grams vs Fixed Price auto-detection', () => {
  it('grams: leading decimals + decimals', () => {
    for (const g of ['.10', '.20', '.45', '.7', '0.45', '1.5', '3.39', '11.9']) {
      expect(classifyCaptureValue(g)).toBe('grams');
    }
  });
  it('fixed: k / K / thousands comma / ₱ / P / PHP / large integer', () => {
    for (const f of ['15000', '15,000', '15k', '15K', '₱15,000', 'P15000', 'PHP 15000']) {
      expect(classifyCaptureValue(f)).toBe('fixed');
    }
  });
  it('safe bare-integer boundary: ≤999 grams, ≥1000 fixed (no jewelry weighs ≥1000 g)', () => {
    expect(classifyCaptureValue('5')).toBe('grams');
    expect(classifyCaptureValue('20')).toBe('grams');
    expect(classifyCaptureValue('999')).toBe('grams');
    expect(classifyCaptureValue('1000')).toBe('fixed');
    expect(classifyCaptureValue('20000')).toBe('fixed');
  });
  it('no usable number → null (caller keeps its default mode; a name never classifies)', () => {
    expect(classifyCaptureValue('')).toBeNull();
    expect(classifyCaptureValue(null)).toBeNull();
    expect(classifyCaptureValue('Pia')).toBeNull();
  });
});

describe('Fixed Price sticker line', () => {
  const FIELDS: StickerFields = {
    name: true,
    item: false,
    price: false,
    pricePerGram: true,
    date: true,
  };
  it('prints "FIXED • ₱X" instead of grams × rate when fixedPrice is set', () => {
    const line = stickerLineItems(
      { ...data, grams: null, pricePerGram: '7500', fixedPrice: '12500' },
      FIELDS,
    ).find((l) => l.kind === 'pricePerGram');
    expect(line?.text).toBe('FIXED • ₱12,500');
  });
  it('falls back to grams × rate when fixedPrice is not set', () => {
    const line = stickerLineItems(
      { ...data, grams: '5.5', pricePerGram: '7500' },
      FIELDS,
    ).find((l) => l.kind === 'pricePerGram');
    expect(line?.text).toBe('5.5g • ₱7,500/g');
  });
});

describe('stickerLines content', () => {
  it('with all fields is Name · Item+grams · Price · Date, price only (no "Qty")', () => {
    expect(stickerLineItems(data, ALL).map((l) => l.text)).toEqual([
      'King Gonzales',
      'Necklace 12.2',
      '₱12,000',
      'June 15, 2026',
    ]);
  });

  it('shows the quantity only when more than one piece', () => {
    expect(
      stickerLineItems({ ...data, quantity: 3 }, ALL).find((l) => l.kind === 'price')
        ?.text,
    ).toBe('3 x ₱12,000');
  });

  it('shows an em dash for the price when there is none', () => {
    expect(
      stickerLineItems({ ...data, unitPrice: null }, ALL).find((l) => l.kind === 'price')
        ?.text,
    ).toBe('—');
  });
});

describe('stickerLineItems — configurable fields', () => {
  const withRate = { ...data, pricePerGram: '983' };

  it('DEFAULTS to Facebook name + date only', () => {
    expect(stickerLineItems(data).map((l) => l.kind)).toEqual(['name', 'date']);
    // The back-compat string helper follows the same default.
    expect(stickerLines(data)).toEqual(['King Gonzales', 'June 15, 2026']);
  });

  it('omits disabled fields — e.g. Facebook name + date only', () => {
    const lines = stickerLineItems(withRate, {
      name: true,
      item: false,
      price: false,
      pricePerGram: false,
      date: true,
    });
    expect(lines.map((l) => l.text)).toEqual(['King Gonzales', 'June 15, 2026']);
  });

  const rateOnly: StickerFields = {
    name: false,
    item: false,
    price: false,
    pricePerGram: true,
    date: false,
  };

  it('combines grams + rate on the price-per-gram line (screenshot-to-print format)', () => {
    // data.grams is '12.2' → "12.2g • ₱983/g".
    expect(stickerLineItems(withRate, rateOnly)).toEqual([
      { text: '12.2g • ₱983/g', kind: 'pricePerGram' },
    ]);
  });

  it('shows the rate alone when the weight is unknown', () => {
    expect(stickerLineItems({ ...withRate, grams: null }, rateOnly)).toEqual([
      { text: '₱983/g', kind: 'pricePerGram' },
    ]);
    // A trailing-zero weight normalizes on the sticker: "11.50" → "11.5g".
    expect(stickerLineItems({ ...withRate, grams: '11.50' }, rateOnly)).toEqual([
      { text: '11.5g • ₱983/g', kind: 'pricePerGram' },
    ]);
  });

  it('adds a Price per gram line only when enabled AND a rate is present', () => {
    // Enabled but no rate → nothing.
    const noRate = stickerLineItems(data, rateOnly);
    expect(noRate).toEqual([]);
  });
});

describe('normalizeGrams', () => {
  it('reads a bare number as grams and drops trailing zeros', () => {
    expect(normalizeGrams('0.7')).toBe('0.7');
    expect(normalizeGrams('1.5')).toBe('1.5');
    expect(normalizeGrams('11.5')).toBe('11.5');
    expect(normalizeGrams('20')).toBe('20');
    expect(normalizeGrams('0.85')).toBe('0.85');
    expect(normalizeGrams('11.50')).toBe('11.5');
    expect(normalizeGrams('11.5g')).toBe('11.5');
    expect(normalizeGrams('1,250')).toBe('1250');
    expect(normalizeGrams(20)).toBe('20');
  });

  it('returns null for empty / non-numeric / non-positive input', () => {
    expect(normalizeGrams(null)).toBeNull();
    expect(normalizeGrams(undefined)).toBeNull();
    expect(normalizeGrams('')).toBeNull();
    expect(normalizeGrams('abc')).toBeNull();
    expect(normalizeGrams('0')).toBeNull();
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
      if (bytes[i] === 0x1b && bytes[i + 1] === 0x61 && bytes[i + 2] === 0x01)
        centered = true;
    }
    expect(centered).toBe(true);
  });

  it('prints the sticker content with the price on its own line (no "Qty")', () => {
    const text = asText(encodeReceiptEscPos(data, ALL));
    // The name now fits on ONE line (normal width) instead of wrapping.
    expect(text).toContain('King Gonzales');
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
      encodeReceiptEscPos(withUnicode, ALL),
      encodeLabelTspl(withUnicode, ALL),
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

describe('encodeLabelTspl line breaks', () => {
  it('KEEPS TSPL line breaks — stripping CR/LF breaks the whole label', () => {
    const label = asText(encodeLabelTspl(data));
    expect(label.split('\n').length).toBeGreaterThan(3);
  });
});

describe('encodeLabelTspl', () => {
  it('emits a 40x30mm label program with the sticker content, centered', () => {
    const text = asText(encodeLabelTspl(data, ALL));
    expect(text).toContain('SIZE 40 mm,30 mm');
    expect(text).toContain('GAP 2 mm,0 mm');
    // Name now fits on ONE line (font 3) instead of wrapping to two.
    expect(text).toContain('"King Gonzales"');
    expect(text).toContain('Necklace 12.2');
    expect(text).toContain('P12,000');
    expect(text).toContain('PRINT 1,1');
  });

  it('sizes name/item/price at font 3 (a long name fits on one line) and date at font 2', () => {
    const lines = tsplStickerLines(data, ALL);
    expect(lines.find((l) => l.text === 'King Gonzales')?.font).toBe('3');
    expect(lines.find((l) => l.text === 'Necklace 12.2')?.font).toBe('3');
    expect(lines.find((l) => l.text === 'P12,000')?.font).toBe('3');
    expect(lines.find((l) => l.text === 'June 15, 2026')?.font).toBe('2');
  });

  it('centers each line horizontally within the 320-dot label', () => {
    const text = asText(encodeLabelTspl(data, ALL));
    // A short line like the price is pushed well right of the margin (centered),
    // never printed hard against the left edge (x=16 was the old fixed margin).
    const priceCmd = text.split(/\r?\n/).find((l) => l.includes('P12,000')) ?? '';
    const x = Number(priceCmd.match(/^TEXT (\d+),/)?.[1] ?? '0');
    expect(x).toBeGreaterThan(40);
  });
});
