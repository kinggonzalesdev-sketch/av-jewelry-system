import 'server-only';

import { AuthorizationError, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * SHARED Sticker Settings (Owner request 2026-08-12). The sticker's field toggles +
 * price-per-gram are stored ONCE on the server (single row) and used by EVERY account
 * and device — not per-device localStorage. The client keeps a localStorage cache for
 * the synchronous print paths (New Order, capture auto-print, reprint); a load-time sync
 * refreshes that cache from here so all devices print the one saved config.
 */

export type SharedStickerSettings = {
  showName: boolean;
  showPricePerGram: boolean;
  showDate: boolean;
  /** ₱ per gram printed on every sticker; '' means "no rate configured". */
  pricePerGram: string;
};

export const DEFAULT_SHARED_STICKER: SharedStickerSettings = {
  showName: true,
  showPricePerGram: true,
  showDate: true,
  pricePerGram: '7500',
};

/** The one saved config. Readable by any active staff (RLS) so every print path can pull
 *  it; falls back to the defaults when nothing is saved yet or the read is blocked. */
export async function getStickerSettings(): Promise<SharedStickerSettings> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('sticker_settings')
    .select('show_name, show_price_per_gram, show_date, price_per_gram')
    .eq('id', 1)
    .maybeSingle();
  if (!data) return DEFAULT_SHARED_STICKER;
  return {
    // Facebook Name is FIXED on — always show who mined it (the pinned comment's name).
    showName: true,
    showPricePerGram: data.show_price_per_gram !== false,
    showDate: data.show_date !== false,
    pricePerGram:
      typeof data.price_per_gram === 'string'
        ? data.price_per_gram
        : DEFAULT_SHARED_STICKER.pricePerGram,
  };
}

export type SaveStickerResult = { ok: true } | { ok: false; error: string };

/** Save the one shared config — Owner / Selected Admin only (the DB RLS re-checks). */
export async function saveStickerSettings(
  input: SharedStickerSettings,
): Promise<SaveStickerResult> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return {
        ok: false,
        error: 'Only the Owner or a Selected Admin can save Sticker Settings.',
      };
    }
    throw cause;
  }

  const price = (input.pricePerGram ?? '').trim();
  if (price && !/^\d{1,9}(\.\d{1,2})?$/.test(price)) {
    return { ok: false, error: 'Enter a valid price per gram (e.g. 7500 or 7500.50).' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('sticker_settings')
    .update({
      show_name: true, // Facebook Name is fixed on — never saved off.
      show_price_per_gram: input.showPricePerGram,
      show_date: input.showDate,
      price_per_gram: price,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  return { ok: true };
}
