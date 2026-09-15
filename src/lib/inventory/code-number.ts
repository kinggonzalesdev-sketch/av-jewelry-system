import { parseInventoryCode } from '@/lib/inventory/code-parser';

/**
 * The NUMERIC identity of an inventory code, and code-first search ranking (Owner 2026-09-15).
 *
 * THE RULE: the sequence number is the unique identity of an item, across every prefix. Once
 * `8413` exists as SBA-E-8413, no SBA-P-8413 / K18-8413 / EF-8413 may be created — the Owner found
 * SBA-E-8413 (1.30g) and SBA-P-8413 (2.07g) both live, and prefix-only uniqueness let it happen.
 * The database enforces this with a trigger (migration 20260915120000, which mirrors this exact
 * extraction); everything here exists so the WEB paths can refuse early with a helpful message and
 * so pickers/lists can rank code matches sensibly.
 *
 * Codes with no recognisable sequence (HK ITEM, PL- auto codes, free-text legacy rows) have NO
 * numeric identity and are exempt from the numeric rule — full-code uniqueness still applies to
 * them via the existing unique lower(item_code) index.
 */

/**
 * A standalone 3–6 digit run bounded by start/space/dash on the left and end/space/dash on the
 * right. Skips grams ("1.30g" — digits touch a dot/letter), sizes ('7"'), and karat marks
 * ("K18" — digits touch the K). MUST mirror the fallback branch of
 * app_private.inventory_code_number in migration 20260915120000.
 */
const LOOSE_SEQUENCE_RE = /(?:^|[\s-])(\d{3,6})(?=[\s-]|$)/;

/**
 * The sequence number of a code ("SBA-E-8413 1.30g" → "8413"), or null when the code has no
 * numeric identity. The Owner's rule covers ANY prefix shape — SBA-P-8413, K18-8413, EF-8413 all
 * claim 8413 — so codes the canonical parser cannot read fall back to the bounded digit run.
 * PL- auto codes are internal placeholders and are exempt (null), as are codes whose only
 * numbers are shorter than 3 or longer than 6 digits outside a parsed sequence.
 */
export function inventoryCodeNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = parseInventoryCode(raw).sequence;
  if (parsed) return parsed;
  const text = raw.trim();
  if (/^PL-/i.test(text)) return null;
  return LOOSE_SEQUENCE_RE.exec(text.replace(/\s+/g, ' '))?.[1] ?? null;
}

/** Canonical prefix form ("SBA-E-8413"), or null when the code does not parse. */
export function inventoryCodeCanonical(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return parseInventoryCode(raw).inventoryCode;
}

/** The one duplicate message, worded exactly as the Owner specified. */
export function duplicateCodeNumberMessage(number: string, existingCode: string): string {
  return `Code ${number} is already assigned to ${existingCode}. Please use another code.`;
}

/**
 * Code-first search rank — LOWER is better. Mirrors the ORDER BY in the two inventory RPCs
 * (same migration); a drift between them makes pickers and lists disagree, so both sides are
 * pinned by tests.
 *
 *   0  exact full code ("SBA-E-8413" matches the item whose code is SBA-E-8413 …)
 *   1  exact numeric code ("8413" matches any code whose sequence is 8413)
 *   2  code starts with the query
 *   3  code contains the query
 *   4  no code match (other searchable fields only)
 *
 * Case-insensitive; leading/trailing spaces ignored; interior whitespace collapsed. Deliberately
 * NO fuzzy matching — approximate code matches are exactly what buried the real item.
 */
export function rankInventoryCode(query: string, code: string): 0 | 1 | 2 | 3 | 4 {
  const q = query.trim().replace(/\s+/g, ' ').toLowerCase();
  if (q === '') return 4;
  const c = code.trim().replace(/\s+/g, ' ').toLowerCase();

  if (c === q) return 0;
  const canonical = inventoryCodeCanonical(code);
  if (canonical && canonical.toLowerCase() === q) return 0;

  if (/^\d+$/.test(q) && inventoryCodeNumber(code) === q) return 1;
  if (c.startsWith(q)) return 2;
  if (c.includes(q)) return 3;
  return 4;
}

/** Sort helper for picker results: by code rank, then code, so exact hits surface first. */
export function sortByCodeRank<T>(
  rows: T[],
  query: string,
  codeOf: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const ra = rankInventoryCode(query, codeOf(a));
    const rb = rankInventoryCode(query, codeOf(b));
    if (ra !== rb) return ra - rb;
    return codeOf(a).localeCompare(codeOf(b));
  });
}
