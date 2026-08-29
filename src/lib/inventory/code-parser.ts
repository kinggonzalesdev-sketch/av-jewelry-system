/**
 * Inventory code parser (UI/UX spec §4–§8).
 *
 * Turns a legacy inventory string like `SBA-N-2683 1.80g 16"` into structured
 * fields WITHOUT ever discarding or rewriting the original. Pure and
 * deterministic — no I/O, no database — so it runs identically in the Excel-import
 * preview, the inventory table, live-selling mine detection, search, and labels
 * (§10). Matching a supplier INITIAL against real supplier records is a separate,
 * data-dependent step (§7) and is deliberately not done here: this returns the
 * raw initial and leaves the mapping to the caller.
 *
 * Structure: [Condition(2)][Supplier(1)]-[ItemType]-[Sequence] [Grams] [Size] [Attrs]
 *   SBA-N-2683 1.80g 16"  →  SB + A + N + 2683, 1.80g, 16"
 *
 * The sequence is kept as a STRING (§4): it is a legacy/business number, never
 * assumed to be a database primary key.
 */

export type ParseStatus = 'ok' | 'needs_review';

export type ParsedInventoryCode = {
  /** The original string, exactly as given — never discarded (§8). */
  raw: string;
  /** Normalised full code, e.g. "SBA-N-2683", or null when unrecognised. */
  inventoryCode: string | null;
  conditionCode: string | null; // "SB"
  condition: string | null; // "Subasta" — null when the prefix is unknown
  supplierInitial: string | null; // "A" (raw; not yet matched to a supplier)
  /** Supplier name resolved from `supplierInitial` via the configured supplier-code
   *  map, or null when there is no match / no config (§7). */
  supplier: string | null;
  itemTypeCode: string | null; // "N"
  itemType: string | null; // "Necklace" — null when the code is unknown
  sequence: string | null; // "2683" (string — legacy/business number)
  grams: string | null; // "1.80"
  size: string | null; // '16"' or '6-7"' — null when absent
  attributes: string[]; // ["K18", "EF"]
  /** True when an Electro Form (EF) flag is present (as a trailing token or the
   *  condition prefix). Parsed but not part of the Unique Code. */
  electroForm: boolean;
  status: ParseStatus;
  /** Human-readable reasons a row is `needs_review`. */
  issues: string[];
};

export type InventoryCodeConfig = {
  /** Condition prefix → label. Case-insensitive input; stored uppercase (§5). */
  conditions: Record<string, string>;
  /** Item-type code → label. Configurable in Settings (§6). */
  itemTypes: Record<string, string>;
  /** Supplier initial → supplier name. Configured in Settings (§7). */
  suppliers: Record<string, string>;
};

/** Confirmed condition prefixes (§5). */
export const DEFAULT_CONDITIONS: Record<string, string> = {
  BN: 'Brand New',
  SB: 'Subasta',
  EF: 'Electro Form',
};

/** Initial item-type codes (§6). "B" stays Bracelet / Anklet and is not
 *  auto-narrowed — the user classifies it more specifically when known. */
export const DEFAULT_ITEM_TYPES: Record<string, string> = {
  B: 'Bracelet / Anklet',
  N: 'Necklace',
  R: 'Ring',
  E: 'Earrings',
  P: 'Pendant',
  C: 'Chain',
};

// The separators between supplier, item-type, and sequence may be hyphens OR
// spaces, inconsistently (spec §8): "SBA-N-2683", "SBA-P 2265", "BNA-B-2279".
const CODE_RE = /^([A-Za-z]{2})([A-Za-z])[\s-]+([A-Za-z]+)[\s-]+(\d+)/;
// Grams may be written with a leading dot (".73g") or a leading zero ("0.73g").
const GRAMS_RE = /(\d*\.?\d+)\s*g\b/i;
const SIZE_RE = /(\d+(?:-\d+)?)\s*"/; //  16"  |  6-7"  |  7"
const KARAT_RE = /\bK\d{2}\b/i; //  K18
const EF_RE = /\bEF\b/i; //  Electro Form flag (trailing token)

export function parseInventoryCode(
  raw: string,
  config?: Partial<InventoryCodeConfig>,
): ParsedInventoryCode {
  const conditions = config?.conditions ?? DEFAULT_CONDITIONS;
  const itemTypes = config?.itemTypes ?? DEFAULT_ITEM_TYPES;
  const suppliers = config?.suppliers ?? {};

  const original = raw ?? '';
  // Collapse the whitespace variations of §8, but keep the original untouched.
  const text = original.replace(/\s+/g, ' ').trim();

  const issues: string[] = [];
  let inventoryCode: string | null = null;
  let conditionCode: string | null = null;
  let condition: string | null = null;
  let supplierInitial: string | null = null;
  let itemTypeCode: string | null = null;
  let itemType: string | null = null;
  let sequence: string | null = null;

  const m = CODE_RE.exec(text);
  if (m) {
    conditionCode = (m[1] ?? '').toUpperCase();
    supplierInitial = (m[2] ?? '').toUpperCase();
    itemTypeCode = (m[3] ?? '').toUpperCase();
    sequence = m[4] ?? null;
    inventoryCode = `${conditionCode}${supplierInitial}-${itemTypeCode}-${sequence}`;

    condition = conditions[conditionCode] ?? null;
    if (!condition) {
      // Unknown prefixes are never silently classified (§5).
      issues.push(`Unknown condition prefix "${conditionCode}".`);
    }

    itemType = itemTypes[itemTypeCode] ?? null;
    if (!itemType) {
      issues.push(`Unknown item type code "${itemTypeCode}".`);
    }
  } else {
    issues.push('Inventory code format not recognized.');
  }

  const gm = GRAMS_RE.exec(text);
  const grams = gm?.[1] ?? null;
  if (!grams) issues.push('No grams found.');

  // Size is optional — a missing size is NOT a problem (e.g. SBA-E-2679).
  const sm = SIZE_RE.exec(text);
  const size = sm ? `${sm[1] ?? ''}"` : null;

  const km = KARAT_RE.exec(text);
  const attributes = km ? [(km[0] ?? '').toUpperCase()] : [];

  // Electro Form: a trailing "EF" token (e.g. `BNA-R-2297 0.98g "6" EF`) or the
  // condition prefix itself being EF. A flag only — never part of the Unique Code.
  const electroForm = conditionCode === 'EF' || EF_RE.test(text);
  if (electroForm && !attributes.includes('EF')) attributes.push('EF');

  return {
    raw: original,
    inventoryCode,
    conditionCode,
    condition,
    supplierInitial,
    supplier: supplierInitial ? (suppliers[supplierInitial] ?? null) : null,
    itemTypeCode,
    itemType,
    sequence,
    grams,
    size,
    attributes,
    electroForm,
    status: issues.length === 0 ? 'ok' : 'needs_review',
    issues,
  };
}

/** Normalised code for duplicate detection / matching (§9, §10): uppercased,
 *  inner whitespace stripped. Returns null when there is no recognizable code. */
export function normalizeInventoryCode(raw: string): string | null {
  return parseInventoryCode(raw).inventoryCode;
}

/**
 * Save-time corruption guard (Owner 2026-08-29). Flags LIKELY data-entry typos in an inventory
 * code BEFORE it is stored — a sequence fused with the grams, a broken decimal, a stray "g", a
 * price sitting inside the code, or a duplicated code — the exact shapes found inflating the
 * Inventory Grams totals. Returns staff-facing warning messages. PURE, so it runs identically in
 * the New Entry form (live, as you type) and in the server create guard (authoritative backstop).
 * These are WARNINGS the operator can consciously override — never a hard block.
 */
export function detectInventoryCodeIssues(raw: string): string[] {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (text === '') return [];
  const issues: string[] = [];

  // Grams implausibly high — almost always the sequence number fused with the grams.
  const gm = GRAMS_RE.exec(text);
  if (gm) {
    const grams = Number(gm[1]);
    if (Number.isFinite(grams) && grams > 150) {
      issues.push(
        `Grams looks unusually high (${gm[1]}g). The sequence may be stuck to the grams — e.g. "SBA-B-6281 4.13g".`,
      );
    }
  }

  // Sequence with 5+ digits (canonical is 4) — a fused or mistyped sequence.
  const cm = CODE_RE.exec(text);
  const seq = cm?.[4] ?? '';
  if (seq.length >= 5) {
    issues.push(`The sequence has ${seq.length} digits (${seq}). Codes are usually 4 — check for a fused number.`);
  }

  // Broken decimal: a space between two digit runs right before "g" (e.g. "0 87g" → "0.87g").
  if (/\d+\s\d+\s*g\b/i.test(text)) {
    issues.push('The grams has a space inside it (e.g. "0 87g"). It may be a lost decimal point — e.g. "0.87g".');
  }

  // Stray "g" welded to the sequence number (e.g. "BNA-P-2544g").
  if (/-\d+g\b/i.test(text)) {
    issues.push('A "g" is stuck to the sequence number (e.g. "2544g"). Remove it if that is not the grams.');
  }

  // Two grams tokens — only one can be the weight.
  if ((text.match(/\d\s*g\b/gi) ?? []).length >= 2) {
    issues.push('There are two "…g" values. Only one is the weight — which is correct?');
  }

  // A comma number (a price) sitting inside the code.
  if (/\d,\d/.test(text)) {
    issues.push('There is a comma number (e.g. "1,100") inside the code. If it is a price, put it in the Price field.');
  }

  // The whole code appears more than once (copy-paste duplication).
  if ((text.match(/[A-Za-z]{2}[A-Za-z][\s-]+[A-Za-z]+[\s-]+\d+/g) ?? []).length >= 2) {
    issues.push('The whole code appears more than once — it looks duplicated. Keep a single copy.');
  }

  return issues;
}
