import { parseInventoryCode } from '@/lib/inventory/code-parser';

/**
 * Inventory code helpers: the complete-code duplicate key, the numeric sequence, and code-first
 * search ranking.
 *
 * THE UNIQUENESS RULE (Owner 2026-09-26): only the same COMPLETE code is a duplicate. The number may
 * repeat — BNA-E-6158 2.48G and BNW-N-6158 2.55g 20" are different items. The database enforces it
 * (migration 20260926110000: trigger + unique index on app_private.inventory_code_key, which
 * mirrors inventoryCodeKey below); the web pre-checks here only give a friendly message early.
 * The numeric-identity rule of 2026-09-15 (one number across all prefixes) is retired.
 *
 * The sequence NUMBER is still extracted — for search ranking ("6158" finds every 6158 item) — but
 * it is not unique.
 */

const DOUBLE_QUOTES = String.fromCharCode(0x201c, 0x201d, 0x201e, 0x201f, 0x2033);
const SINGLE_QUOTES = String.fromCharCode(0x2018, 0x2019, 0x201a, 0x201b, 0x2032);
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * The comparison form of a COMPLETE code: typographic quotes/primes → ASCII quotes, no-break
 * space → space, whitespace runs → one space, ends trimmed, letters upper-cased. Nothing else, so
 * 18" vs 20", BNA vs BNW and 2.48g vs 2.55g stay different. MUST mirror
 * app_private.inventory_code_key in migration 20260926110000.
 */
export function inventoryCodeKey(raw: string | null | undefined): string {
  let out = '';
  for (const ch of raw ?? '') {
    if (DOUBLE_QUOTES.includes(ch)) out += '"';
    else if (SINGLE_QUOTES.includes(ch)) out += "'";
    else if (ch === NO_BREAK_SPACE) out += ' ';
    else out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().toUpperCase();
}

/** The duplicate message — same wording as the database trigger. */
export function duplicateInventoryCodeMessage(existingCode: string): string {
  return `This exact Inventory Code already exists: ${existingCode}. Please review the existing item or use a different complete code.`;
}

/**
 * A LIKE pattern that finds every stored code whose key could equal `key`: whitespace runs and
 * quote characters become wildcards (the stored code may differ there), and LIKE's own special
 * characters are escaped. Candidates are then compared with inventoryCodeKey exactly.
 */
export function inventoryCodeKeyPattern(key: string): string {
  const escaped = key.replace(/[%_\\]/g, (c) => `\\${c}`);
  return `%${escaped.replace(/["']/g, '_').replace(/ /g, '%')}%`;
}

/**
 * A standalone 3–6 digit run bounded by start/space/dash on the left and end/space/dash on the
 * right. Skips grams ("1.30g" — digits touch a dot/letter), sizes ('7"'), and karat marks
 * ("K18" — digits touch the K). MUST mirror the fallback branch of
 * app_private.inventory_code_number in migration 20260915120000.
 */
const LOOSE_SEQUENCE_RE = /(?:^|[\s-])(\d{3,6})(?=[\s-]|$)/;

/**
 * The sequence number of a code ("SBA-E-8413 1.30g" → "8413"), or null when the code has no
 * sequence. Used for search ranking only — the same number may exist under several prefixes.
 * Codes the canonical parser cannot read (K18-8413, EF-8413) fall back to the bounded digit run.
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
