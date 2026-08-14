'use server';

import {
  getStickerSettings,
  saveStickerSettings,
  type SaveStickerResult,
  type SharedStickerSettings,
} from '@/lib/print/sticker-settings-store';

/**
 * Sticker Settings — server actions (transport only). The read is used by BOTH the
 * settings card and the app-shell sync (which refreshes every device's localStorage
 * cache); the save is Owner/Selected-Admin gated in the domain module + the DB.
 */

export async function loadStickerSettingsAction(): Promise<SharedStickerSettings> {
  return getStickerSettings();
}

export async function saveStickerSettingsAction(
  input: SharedStickerSettings,
): Promise<SaveStickerResult> {
  return saveStickerSettings(input);
}
