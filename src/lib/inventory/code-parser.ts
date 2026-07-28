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
