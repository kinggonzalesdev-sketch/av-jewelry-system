'use client';

import { DEFAULT_STICKER_FIELDS, type StickerFields } from '@/lib/print/order-receipt';

/**
 * The operator's chosen sticker fields, stored PER DEVICE in localStorage (a print
 * preference, like the connected printer). Read by every print path so the printed
 * sticker matches Sticker Settings; falls back to the default layout when unset.
 */
// v2: price-per-gram was put back (Owner 2026-08-06), so the older saved configs —
// which had it forced off — are ignored and everyone gets the new default layout.
const KEY = 'mineflow-sticker-fields-v2';

export function readStickerFields(): StickerFields {
  // FIXED layout (Owner request 2026-08-13): Facebook Name + Price per gram + Date ALWAYS
  // print; item + price never do. These are no longer toggles — the ONLY editable sticker
  // value is the ₱/gram RATE (a separate key). Forcing them here means any old saved config
  // that turned price-per-gram or date off is ignored, so every device prints the same
  // three-line sticker. The real name + grams come from the order/capture at print time.
  const forced: Partial<StickerFields> = {
    name: true,
    pricePerGram: true,
    date: true,
    item: false,
    price: false,
  };
  if (typeof window === 'undefined') return { ...DEFAULT_STICKER_FIELDS, ...forced };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_STICKER_FIELDS, ...forced };
    const parsed = JSON.parse(raw) as Partial<StickerFields>;
    return { ...DEFAULT_STICKER_FIELDS, ...parsed, ...forced };
  } catch {
    return { ...DEFAULT_STICKER_FIELDS, ...forced };
  }
}

export function writeStickerFields(fields: StickerFields): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(fields));
  } catch {
    /* storage may be unavailable (private mode) — non-fatal */
  }
}

/**
 * The SINGLE SOURCE OF TRUTH for the price-per-gram rate printed on every sticker
 * (`stickerSettings.pricePerGram`). Stored per device in Sticker Settings and read by
 * every print path — including the screenshot-to-print auto-print, which prints the
 * saved rate even though the pinned comment never contains it. A blank/unset value
 * means "no rate configured" (the price-per-gram line is then omitted).
 */
const PRICE_PER_GRAM_KEY = 'mineflow-sticker-price-per-gram';
const DEFAULT_PRICE_PER_GRAM = '7500';

export function readStickerPricePerGram(): string {
  if (typeof window === 'undefined') return DEFAULT_PRICE_PER_GRAM;
  try {
    const raw = window.localStorage.getItem(PRICE_PER_GRAM_KEY);
    // Only an explicit empty string means "cleared"; an unset key uses the default.
    if (raw === null) return DEFAULT_PRICE_PER_GRAM;
    return raw.trim();
  } catch {
    return DEFAULT_PRICE_PER_GRAM;
  }
}

export function writeStickerPricePerGram(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PRICE_PER_GRAM_KEY, value.trim());
  } catch {
    /* storage may be unavailable (private mode) — non-fatal */
  }
}
