/**
 * Remove a phantom leading O / 0 / ° glyph that a Facebook avatar / badge / follower-icon left FUSED
 * onto a Capitalised name during on-device OCR ("ORoshelle Akitan Gavino" → "Roshelle Akitan Gavino").
 *
 * Positive structural evidence it is noise, not a letter: a real name NEVER starts with two capitals
 * fused (O + Capital + lowercase is not a name word). So EVERY legitimate O-name is left untouched —
 * "Olivia" / "Oscar" / "Ocampo" / "Orlando" (O + lowercase), "O'Brien" (O + apostrophe), "O King"
 * (O + space), "OJ" / "OG" (no trailing lowercase). This is the WEB mirror of the Android
 * ScreenshotOcr.sanitizeLeadingNameGlyph rule, applied where the capture name is read so the Incoming
 * Captures display, the sticker, and Facebook matching all get the same clean canonical name —
 * including for captures already stored by an older phone build. Pure + lightweight (a single regex),
 * safe to call on the client or the server. Owner 2026-08-22 (Roshelle "ORoshelle" bug).
 */
const PHANTOM_LEADING_NAME_GLYPH = /^[O0°]([A-Z][a-z].*)$/;

export function sanitizeLeadingNameGlyph(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  const m = PHANTOM_LEADING_NAME_GLYPH.exec(t);
  return m?.[1]?.trim() ?? t;
}
