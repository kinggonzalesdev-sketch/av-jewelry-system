'use client';

import { useEffect } from 'react';

import { loadStickerSettingsAction } from '@/lib/print/sticker-settings-actions';
import { DEFAULT_STICKER_FIELDS } from '@/lib/print/order-receipt';
import {
  writeStickerFields,
  writeStickerPricePerGram,
} from '@/lib/print/sticker-fields';

/**
 * Refreshes THIS device's sticker-settings localStorage cache from the ONE shared server
 * config on load — so every account's print paths (New Order, capture auto-print,
 * reprint), which read localStorage synchronously, use the config the Owner saved rather
 * than a per-device default. Mounted once in the app shell; best-effort + silent, and it
 * renders nothing. (`item`/`price` are always off — the removed sticker lines.)
 */
export function StickerSettingsSync() {
  useEffect(() => {
    let alive = true;
    void loadStickerSettingsAction()
      .then((s) => {
        if (!alive) return;
        writeStickerFields({
          ...DEFAULT_STICKER_FIELDS,
          name: true, // Facebook Name is fixed on — always shows who mined it.
          pricePerGram: s.showPricePerGram,
          date: s.showDate,
          item: false,
          price: false,
        });
        writeStickerPricePerGram(s.pricePerGram);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return null;
}
