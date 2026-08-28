import { normalizeGrams } from '@/lib/print/order-receipt';

/**
 * Value-only Pancake canonical safety net — leading-decimal grams (Owner 2026-08-28).
 *
 * Android OCR sometimes drops an explicit LEADING decimal ("mine .33" read as "33"). When a Capture
 * is matched to its EXACT Pancake Live comment (PSID-exact, single qualifying comment), and that
 * comment text carries the SAME digits as a leading decimal, the value is canonicalized to "0.33".
 * Pure + deterministic (no I/O) so it is unit-testable. Downstream safety net only — the raw OCR
 * value is preserved by the caller; Android OCR + the immediate local sticker are never touched.
 */

/** Strip the simple HTML/entities Pancake wraps a Live comment in ("<div>mine .33</div>"). */
function plainCommentText(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the canonical grams string ("0.33") ONLY for the proven lost-leading-decimal case, else
 * null. DIGIT AGREEMENT is REQUIRED — the comment's post-dot digits must equal the OCR integer:
 *   OCR "33" + comment ".33" / "0.33" → "0.33"   (safe correction)
 *   OCR "33" + comment ".44"          → null       (mismatch → caller keeps raw / review)
 *   OCR "33" + comment "33"           → null       (whole number → preserved as 33g)
 *   OCR "1.16" (already a decimal)     → null       (not a lost-leading-decimal shape)
 *   comment "3.36" (dot preceded by a digit = a normal mid-number decimal) → null (not LEADING)
 * Never blindly divides an integer; a Fixed Price is never produced (a leading decimal is always < 1).
 */
export function canonicalLeadingDecimalGrams(
  ocrValue: string | null | undefined,
  commentText: string | null | undefined,
): string | null {
  const ocr = (ocrValue ?? '').trim();
  // OCR must be a BARE 1–3 digit integer (grams range) with no dot/comma/k — the lost-leading-decimal shape.
  if (!/^\d{1,3}$/.test(ocr)) return null;

  const text = plainCommentText(commentText ?? '');
  if (!text) return null;

  // Every LEADING decimal in the comment: a dot NOT preceded by a digit (an optional single "0" allowed),
  // then digits. Matches ".33" and "0.33" but NOT "3.36" (a normal mid-number decimal).
  const leadingDecimals = [...text.matchAll(/(?<![0-9])0?\.(\d{1,3})\b/g)];
  // DIGIT AGREEMENT: use a leading decimal whose fractional digits EXACTLY equal the OCR integer.
  const hit = leadingDecimals.find((m) => (m[1] ?? '') === ocr);
  if (!hit) return null;

  const canon = normalizeGrams(`0.${hit[1] ?? ''}`);
  if (!canon) return null;
  const n = Number(canon);
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null; // must be a sub-1 gram value
  return canon;
}
