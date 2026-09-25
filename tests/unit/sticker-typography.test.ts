import { describe, expect, it } from 'vitest';

import {
  fitLine,
  shortenStickerMonth,
  stickerDate,
  stickerLineItems,
  type OrderReceiptData,
} from '@/lib/print/order-receipt';
import {
  encodeLabelTspl,
  encodeReceiptEscPos,
  escPosNameFit,
  tsplNameFit,
} from '@/lib/print/receipt-encoders';

/**
 * Sticker typography (Owner 2026-09-25), PC side — the same rules as the phone app
 * (mobile/.../printer/StickerLayoutTest.kt): short month names, every line centered inside the
 * 40 mm label, and the customer name always on ONE line, sized to the printable width.
 *
 * The TSPL program is parsed back into TEXT commands and each line MEASURED in printer dots (the
 * built-in fonts are fixed-width: characters × cell width × multiplier).
 */

const LABEL_W = 320;
const MARGIN = 16;
const CELL_W: Record<string, number> = { '1': 8, '2': 12, '3': 16, '4': 24 };
const TEXT = /^TEXT (\d+),(\d+),"(\d)",0,(\d+),(\d+),"(.*)"$/;

type Printed = {
  x: number;
  y: number;
  font: string;
  xMul: number;
  yMul: number;
  text: string;
};

function tspl(d: OrderReceiptData): Printed[] {
  return new TextDecoder()
    .decode(encodeLabelTspl(d))
    .split(/\r?\n/)
    .map((l) => TEXT.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      font: m[3] ?? '',
      xMul: Number(m[4]),
      yMul: Number(m[5]),
      text: m[6] ?? '',
    }));
}

const width = (p: Printed) => p.text.length * (CELL_W[p.font] ?? 0) * p.xMul;

function expectCenteredInside(p: Printed) {
  expect(p.x, `'${p.text}' starts in the left margin`).toBeGreaterThanOrEqual(MARGIN);
  expect(p.x + width(p), `'${p.text}' runs past the right margin`).toBeLessThanOrEqual(
    LABEL_W - MARGIN,
  );
  const left = p.x;
  const right = LABEL_W - p.x - width(p);
  expect(Math.abs(left - right), `'${p.text}' is off-center`).toBeLessThanOrEqual(1);
}

/** The capture sticker the PC prints: name · grams • rate · date (default fields). */
const sticker = (name: string, date = 'Sept 25, 2026'): OrderReceiptData => ({
  customerName: name,
  itemName: '',
  grams: '11.5',
  quantity: 1,
  unitPrice: null,
  pricePerGram: '6800',
  date,
});

describe('short month names (Owner 2026-09-25)', () => {
  it('uses the Owner’s exact list', () => {
    const expected = [
      'Jan 25, 2026',
      'Feb 25, 2026',
      'Mar 25, 2026',
      'Apr 25, 2026',
      'May 25, 2026',
      'June 25, 2026',
      'July 25, 2026',
      'Aug 25, 2026',
      'Sept 25, 2026',
      'Oct 25, 2026',
      'Nov 25, 2026',
      'Dec 25, 2026',
    ];
    for (let m = 0; m < 12; m++)
      expect(stickerDate(new Date(2026, m, 25, 12))).toBe(expected[m]);
  });

  it('keeps the day and year', () => {
    expect(stickerDate(new Date(2026, 0, 8, 9))).toBe('Jan 8, 2026');
    expect(stickerDate(new Date(2027, 11, 31, 9))).toBe('Dec 31, 2027');
  });

  it('shortens a long date formatted elsewhere, on every print path', () => {
    expect(shortenStickerMonth('September 25, 2026')).toBe('Sept 25, 2026');
    expect(shortenStickerMonth('January 8, 2026')).toBe('Jan 8, 2026');
    expect(shortenStickerMonth('June 15, 2026')).toBe('June 15, 2026');
    expect(shortenStickerMonth('Sept 25, 2026')).toBe('Sept 25, 2026');
    expect(shortenStickerMonth('25/09/2026')).toBe('25/09/2026');
    const lines = stickerLineItems(sticker('KING GONZALES', 'September 25, 2026'));
    expect(lines.at(-1)).toEqual({ text: 'Sept 25, 2026', kind: 'date' });
  });
});

describe('every line centered inside the 40 mm label', () => {
  it('all twelve dates print on one line, centered, with room to spare', () => {
    for (let m = 0; m < 12; m++) {
      const date = stickerDate(new Date(2026, m, 25, 12));
      const lines = tspl(sticker('KING GONZALES', date));
      expect(lines).toHaveLength(3);
      expect(lines[2]?.text).toBe(date);
      lines.forEach(expectCenteredInside);
    }
  });
});

describe('customer name: one line, sized to fit', () => {
  it('the Owner’s test names each print on one centered line', () => {
    const expectFont: Record<string, string> = {
      JEL: '3',
      'KING GONZALES': '3',
      'ANNAFAYE ENRIQUEZ': '3',
      'CATHERINE PETERSDORF': '2',
      'JAIMEE MARTIN ANCHETA': '2',
    };
    for (const [name, font] of Object.entries(expectFont)) {
      const lines = tspl(sticker(name));
      expect(lines, `${name}: no wrap`).toHaveLength(3);
      expect(lines[0]?.text).toBe(name);
      expect(lines[0]?.font, `${name} font`).toBe(font);
      lines.forEach(expectCenteredInside);
    }
  });

  it('steps down by printed width, to a minimum of font 1 at double height', () => {
    expect(tsplNameFit('ABCDEFGHI JKLMNOPQ').font).toBe('3'); // 18 × 16 = 288 dots exactly
    expect(tsplNameFit('ABCDEFGHI JKLMNOPQR').font).toBe('2');
    expect(tsplNameFit('MARIA CRISTINA DELA CRUZ SANTOS')).toEqual({
      text: 'MARIA CRISTINA DELA CRUZ SANTOS',
      font: '1',
      xMul: 1,
      yMul: 2,
      fits: true,
    });
  });

  it('an extreme name stays on one line at the minimum size and is reported', () => {
    const fit = tsplNameFit('MARIA CRISTINA ANGELICA DELA CRUZ SANTOS REYES');
    expect(fit).toEqual({
      text: 'MARIA CRISTINA ANGELICA DELA CRUZ',
      font: '1',
      xMul: 1,
      yMul: 2,
      fits: false,
    });
    const lines = tspl(sticker('MARIA CRISTINA ANGELICA DELA CRUZ SANTOS REYES'));
    expect(lines).toHaveLength(3);
    lines.forEach(expectCenteredInside);
  });

  it('prints exactly what the phone prints (same commands as StickerLayoutTest.kt)', () => {
    const text = new TextDecoder().decode(
      encodeLabelTspl(sticker('JAIMEE MARTIN ANCHETA')),
    );
    expect(text).toContain('TEXT 34,78,"2",0,1,1,"JAIMEE MARTIN ANCHETA"');
    expect(text).toContain('TEXT 32,108,"3",0,1,1,"11.5g - P6,800/g"');
    expect(text).toContain('TEXT 82,142,"2",0,1,1,"Sept 25, 2026"');
  });
});

describe('grams / Fixed Price lines unchanged', () => {
  it('keeps "11.5g • ₱6,800/g" (folded for the printer) at the approved size', () => {
    const g = tspl(sticker('KING GONZALES'))[1];
    expect(g).toMatchObject({ text: '11.5g - P6,800/g', font: '3', xMul: 1, yMul: 1 });
    if (g) expectCenteredInside(g);
  });

  it('Fixed Price gets the same improvements and still has no per-gram rate', () => {
    const lines = tspl({
      ...sticker('JAIMEE MARTIN ANCHETA'),
      grams: null,
      fixedPrice: '15000',
    });
    expect(lines.map((l) => l.text)).toEqual([
      'JAIMEE MARTIN ANCHETA',
      'FIXED - P15,000',
      'Sept 25, 2026',
    ]);
    lines.forEach(expectCenteredInside);
  });
});

describe('ESC/POS: the same rules', () => {
  it('Font A up to 24 characters, Font B up to 32, never wrapped', () => {
    expect(escPosNameFit('JAIMEE MARTIN ANCHETA')).toEqual({
      text: 'JAIMEE MARTIN ANCHETA',
      fontB: false,
      fits: true,
    });
    expect(escPosNameFit('MARIA CRISTINA DELA CRUZ SANTOS').fontB).toBe(true);
    expect(escPosNameFit('MARIA CRISTINA ANGELICA DELA CRUZ SANTOS REYES')).toEqual({
      text: 'MARIA CRISTINA ANGELICA DELA',
      fontB: true,
      fits: false,
    });
  });

  it('selects Font B around a long name and prints the whole name on one line', () => {
    const bytes = encodeReceiptEscPos(sticker('MARIA CRISTINA DELA CRUZ SANTOS'));
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('MARIA CRISTINA DELA CRUZ SANTOS\n');
    expect(text).toContain('Sept 25, 2026');
    const has = (seq: number[]) =>
      bytes.some((_, i) => seq.every((b, j) => bytes[i + j] === b));
    expect(has([0x1b, 0x4d, 0x01])).toBe(true);
    expect(has([0x1b, 0x4d, 0x00])).toBe(true);
    const short = encodeReceiptEscPos(sticker('KING GONZALES'));
    expect(short.some((_, i) => short[i] === 0x1b && short[i + 1] === 0x4d)).toBe(false);
  });
});

describe('browser print fallback: fitLine', () => {
  // A stand-in for real rendering: monospace, 0.6 em per character.
  const mono = (chars: number) => (px: number) => chars * px * 0.6;

  it('keeps the approved size when the line fits', () => {
    expect(fitLine(mono(3), 132, 25, 11)).toEqual({ px: 25, scaleX: 1, fits: true });
  });

  it('shrinks until the whole line fits on one line', () => {
    const fit = fitLine(mono(13), 132, 25, 11);
    expect(fit.fits).toBe(true);
    expect(mono(13)(fit.px)).toBeLessThanOrEqual(132);
    expect(mono(13)(fit.px + 0.5)).toBeGreaterThan(132);
  });

  it('below the minimum size it narrows the text, never below 75%', () => {
    const fit = fitLine(mono(24), 132, 25, 11); // 24 × 6.6 = 158 px at 11 px
    expect(fit.px).toBe(11);
    expect(fit.scaleX).toBeCloseTo(132 / 158.4, 5);
    expect(fit.fits).toBe(true);
    const tooLong = fitLine(mono(40), 132, 25, 11);
    expect(tooLong).toEqual({ px: 11, scaleX: 0.75, fits: false });
  });
});
