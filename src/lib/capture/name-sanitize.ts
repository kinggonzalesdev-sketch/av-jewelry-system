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

/**
 * A DETACHED single leading letter that OCR fused before a real name ("Y Katy Seacombe" → "Katy
 * Seacombe"). Unlike the phantom O/0/° glyph, a single leading letter followed by a SPACE could be a
 * real initial (a "J Smith"), so a match here is NOT enough on its own — it MUST be corroborated by a
 * "clean twin" (below). A real Y-name is unaffected because it has NO space: "Yvonne"/"Yolanda"/
 * "Ysabel" are one token, so this pattern never matches them.
 */
const DETACHED_LEADING_LETTER = /^([A-Za-z])\s+(.+)$/;

/** The non-blank text lines OCR recognised for a capture (its `ocr.rawLines`), trimmed. */
function ocrNameLines(rawLines: unknown): string[] {
  return Array.isArray(rawLines)
    ? rawLines
        .filter((l): l is string => typeof l === 'string')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : [];
}

/**
 * Clean a captured Facebook name. Strips a phantom leading O/0/° glyph (sanitizeLeadingNameGlyph),
 * AND a DETACHED single leading letter ("Y Katy Seacombe" → "Katy Seacombe") — but the leading-letter
 * strip fires ONLY on positive structural evidence: the SAME capture's OCR (`rawLines`) contains the
 * EXACT name WITHOUT that letter as its own recognised line — the same-session "clean twin". A real
 * customer who commented twice yields one clean read and one avatar/badge-contaminated read; the clean
 * read proves the leading letter is noise. NEVER a blind "starts-with-Y → drop Y": a real "Yvonne"/
 * "Yolanda"/"Ysabel" has no space so it never matches, and a genuine initial with no clean twin is
 * left untouched. Pure + lightweight; safe on client or server. Owner 2026-08-28 ("Y Katy Seacombe").
 */
export function sanitizeCaptureName(
  name: string | null | undefined,
  rawLines?: unknown,
): string {
  const base = sanitizeLeadingNameGlyph(name); // phantom O/0/° first
  const m = DETACHED_LEADING_LETTER.exec(base);
  if (!m) return base;
  const rest = (m[2] ?? '').trim();
  // `rest` must be a real name (has a letter), never a stray number/claim fragment.
  if (!rest || !/[A-Za-z]/.test(rest)) return base;
  const hasCleanTwin = ocrNameLines(rawLines).some((line) => line === rest);
  return hasCleanTwin ? rest : base;
}
