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
  if (typeof window === 'undefined') return DEFAULT_STICKER_FIELDS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_STICKER_FIELDS;
    const parsed = JSON.parse(raw) as Partial<StickerFields>;
    // Merge over defaults, then FORCE the removed fields off so an older saved config
    // (or a crafted value) can never print the item name or price again. Price-per-gram
    // is now a real toggle, so it is NOT forced.
    return {
      ...DEFAULT_STICKER_FIELDS,
      ...parsed,
      item: false,
      price: false,
    };
  } catch {
    return DEFAULT_STICKER_FIELDS;
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
