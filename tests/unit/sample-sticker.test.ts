import { describe, expect, it } from 'vitest';

import { stickerDate } from '@/lib/print/order-receipt';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import { buildSampleSticker, STICKER_FIELDS } from '@/lib/print/sample-sticker';

const asText = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('buildSampleSticker — the shared Test Print source of truth', () => {
  it('uses the approved sample name/grams + the given price/g + today', () => {
    const s = buildSampleSticker('7100');
    expect(s.customerName).toBe('KING GONZALES');
    expect(s.grams).toBe('11.5');
    expect(s.pricePerGram).toBe('7100');
    expect(s.date).toBe(stickerDate());
    expect(s.itemName).toBe('');
    expect(s.unitPrice).toBeNull();
  });

  it('null price/g when blank/whitespace/null', () => {
    expect(buildSampleSticker('').pricePerGram).toBeNull();
    expect(buildSampleSticker('   ').pricePerGram).toBeNull();
    expect(buildSampleSticker(null).pricePerGram).toBeNull();
  });

  it('encodes the approved sticker — KING GONZALES, never "A.V. Jewelry / TEST PRINT"', () => {
    for (const lang of ['tspl', 'escpos'] as const) {
      const out = asText(encodeReceipt(buildSampleSticker('7100'), lang, STICKER_FIELDS));
      expect(out).toContain('KING GONZALES');
      expect(out).not.toContain('A.V. Jewelry');
      expect(out).not.toContain('TEST PRINT');
    }
    // Price/g is drawn from the setting (₱ asciified to P; comma-grouped).
    expect(asText(encodeReceipt(buildSampleSticker('7100'), 'tspl', STICKER_FIELDS))).toContain(
      '7,100',
    );
  });
});
