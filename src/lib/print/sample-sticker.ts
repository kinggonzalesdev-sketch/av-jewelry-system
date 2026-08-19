import {
  DEFAULT_STICKER_FIELDS,
  stickerDate,
  type OrderReceiptData,
  type StickerFields,
} from '@/lib/print/order-receipt';

/**
 * ONE approved sticker configuration + sample, shared by EVERY web Test Print — the Live
 * Operations panel AND the sidebar printer control — so there is a single source of truth and the
 * two can never drift (and neither can re-introduce the old "A.V. Jewelry / TEST PRINT" payload).
 *
 * Fixed layout (Owner): Facebook Name + Price per gram + Date; no item/price. The real capture
 * sticker always uses the capture's own pinned name + grams — this sample is preview/test only.
 * Approved sample: KING GONZALES · 11.5g · ₱<rate>/g · <today>.
 */
export const STICKER_FIELDS: StickerFields = {
  ...DEFAULT_STICKER_FIELDS,
  name: true,
  pricePerGram: true,
  date: true,
  item: false,
  price: false,
};

export const SAMPLE_STICKER_NAME = 'KING GONZALES';
export const SAMPLE_STICKER_GRAMS = '11.5';

/** Build the approved sample sticker from the current price-per-gram setting + today's date. */
export function buildSampleSticker(pricePerGram: string | null): OrderReceiptData {
  return {
    customerName: SAMPLE_STICKER_NAME,
    itemName: '',
    grams: SAMPLE_STICKER_GRAMS,
    quantity: 1,
    unitPrice: null,
    pricePerGram: (pricePerGram ?? '').trim() || null,
    date: stickerDate(),
  };
}
