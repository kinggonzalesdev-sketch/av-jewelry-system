/**
 * CANONICAL LAYAWAY SEARCH ALLOWLIST (Owner 2026-09-17).
 *
 * Layaway search must be VISIBLE, USEFUL AND EXPLAINABLE: a row appears for a term only when that
 * term sits inside an approved business field the user can see on the row (or in its details). The
 * server enforces this in SQL — the `searched` predicate of public.layaway_page, migration
 * supabase/migrations/20260917120000_layaway_search_visible_codes.sql. This module is the readable
 * statement of the same rule, the shared normalization, and a diagnostic that names the field that
 * matched. The tests lock this list and the SQL together.
 *
 * WHY IT EXISTS: the Unique Code on DAN OLLUGRAC's row (`SBA-N-7695 3.10g' 16"`) could not be found,
 * because search read only the ledger's own item link, which is empty for every layaway created
 * from an order, while the table shows the code from the converted order's claimed item.
 *
 * Pure and dependency-free: safe to import from server and client code. Special characters are
 * written as code points (String.fromCharCode) so the source never carries invisible characters.
 */

/** The subset of a Layaway row that search is allowed to look at. */
export type LayawaySearchRow = {
  /** 'ledger' = layaway_ledger account; 'arrangement' = order-derived arrangement. */
  source: 'ledger' | 'arrangement';
  /**
   * EVERY Unique Code the row can display: the ledger's linked item, each layaway_ledger_items
   * item (its linked item's current code, else the stored code), and the items claimed on the
   * converted / linked order.
   */
  uniqueCodes: readonly string[];
  layawayCode: string | null;
  /** Ledger account number (shown in the row tooltip and the payment/transfer dialogs). */
  accountNo: string | null;
  customerName: string | null;
  /** Arrangement financer name (Remarks / Financer column for order-derived rows). */
  financer: string | null;
  /** Remarks / Financer text (ledger rows keep the financer here, e.g. "NEZ"). */
  remarks: string | null;
};

/** One searchable field: the label the user sees, and the value(s) read off a row. */
export type LayawaySearchField = {
  label: string;
  values: (row: LayawaySearchRow) => readonly (string | null | undefined)[];
};

export const LAYAWAY_SEARCH_FIELDS: readonly LayawaySearchField[] = [
  // Each code is matched on its own, so a search never spans two codes.
  { label: 'Unique Code', values: (r) => r.uniqueCodes },
  { label: 'Code', values: (r) => [r.layawayCode] },
  // Order-derived arrangements have no account number of their own ('—').
  {
    label: 'Account No.',
    values: (r) => (r.source === 'ledger' ? [r.accountNo] : []),
  },
  { label: 'Customer Name', values: (r) => [r.customerName] },
  { label: 'Remarks / Financer', values: (r) => [r.financer, r.remarks] },
];

/**
 * Never searchable, on any Layaway surface: internal identifiers and retired numbers. The tests
 * assert none of these reaches the SQL search predicate or the columns that feed it.
 */
export const LAYAWAY_NEVER_SEARCHED = [
  'id',
  'ledgerId',
  'officialOrderId',
  'inventoryItemId',
  'orderNumber',
  'invoiceNumber',
  'paymentId',
  'auditEventId',
] as const;

/**
 * Typographic characters mapped to their plain equivalents. MUST stay 1:1 with the translate()
 * in app_private.layaway_search_norm: “ ” ″ become a straight double quote, ‘ ’ ′ become a straight
 * apostrophe, and a non-breaking space becomes a space.
 */
export const LAYAWAY_NORM_FROM = String.fromCharCode(
  8220,
  8221,
  8243,
  8216,
  8217,
  8242,
  160,
);
export const LAYAWAY_NORM_TO = '"""' + "'''" + ' ';

/**
 * The whitespace this mirror folds: tab, line feed, vertical tab, form feed, carriage return and
 * space — the characters PostgreSQL's whitespace class always covers. The database may also fold
 * some other Unicode spaces; this mirror deliberately never claims MORE than the SQL guarantees.
 */
const FOLDED_SPACE_CODES = new Set([9, 10, 11, 12, 13, 32]);

/**
 * The normalization both sides of a Layaway search go through, in the SQL's order: quote / prime /
 * non-breaking-space mapping, lower case, each run of whitespace collapsed to one space, trimmed.
 * Letters and digits are never altered.
 */
export function layawaySearchNorm(text: string | null | undefined): string {
  let out = '';
  let pendingSpace = false;
  for (const ch of text ?? '') {
    const i = LAYAWAY_NORM_FROM.indexOf(ch);
    const mapped = i >= 0 ? (LAYAWAY_NORM_TO[i] ?? ch) : ch;
    if (FOLDED_SPACE_CODES.has(mapped.charCodeAt(0))) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) {
      out += ' ';
      pendingSpace = false;
    }
    out += mapped.toLowerCase();
  }
  return out;
}

/**
 * The normalized search term, as the RPC builds it: control characters (code points 0-31 and 127)
 * become spaces FIRST, then the term is normalized — so a pasted tab or stray control byte collapses
 * like any other space, and the term can never contain the separator the SQL puts between codes.
 */
export function layawaySearchNeedle(query: string | null | undefined): string {
  let spaced = '';
  for (const ch of query ?? '') {
    const n = ch.charCodeAt(0);
    spaced += n < 32 || n === 127 ? ' ' : ch;
  }
  return layawaySearchNorm(spaced);
}

/** Whether one field value contains the normalized term (the SQL `norm(value) like '%term%'`). */
export function layawayValueMatches(
  value: string | null | undefined,
  query: string | null | undefined,
): boolean {
  const needle = layawaySearchNeedle(query);
  if (needle === '') return true;
  return layawaySearchNorm(value).includes(needle);
}

/**
 * Diagnostic: which approved field made this row match `query`? The field label, or null when no
 * visible field matches — meaning the row must NOT be in the results. Same semantics as the SQL.
 * Development/test aid; not rendered in the production UI.
 */
export function explainLayawayMatch(row: LayawaySearchRow, query: string): string | null {
  if (layawaySearchNeedle(query) === '') return 'All (empty search)';
  for (const field of LAYAWAY_SEARCH_FIELDS) {
    if (field.values(row).some((v) => v && layawayValueMatches(v, query))) {
      return field.label;
    }
  }
  return null;
}

/**
 * Split a row's display string of codes ("CODE1, CODE2") into codes. Codes are always joined with
 * a comma followed by a space, so a comma inside one code (an HK price such as "37,500") stays intact.
 */
export function splitUniqueCodes(uniqueCode: string | null | undefined): string[] {
  return (uniqueCode ?? '')
    .split(', ')
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * The codes with the one(s) matching `query` first, so a result found by its second item's code
 * shows that code in the table rather than hiding it behind "+1". Order is otherwise unchanged.
 */
export function codesMatchedFirst(
  codes: readonly string[],
  query: string | null | undefined,
): string[] {
  if (layawaySearchNeedle(query) === '') return [...codes];
  const hit = codes.filter((c) => layawayValueMatches(c, query));
  if (hit.length === 0) return [...codes];
  return [...hit, ...codes.filter((c) => !hit.includes(c))];
}
