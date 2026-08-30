import {
  detectInventoryCodeIssues,
  normalizeInventoryCode,
  parseInventoryCode,
} from '@/lib/inventory/code-parser';

/**
 * Inventory import DETECTION engine (pure, deterministic, no I/O) — so it runs
 * identically in the browser preview, the server import, and unit tests.
 *
 * It takes already-read worksheets (a matrix of string cells per sheet) and:
 *   - finds each horizontal inventory BLOCK (header row + its column group), and
 *     supports several side-by-side blocks in one sheet;
 *   - maps headers by common ALIASES (Code / Item / Grams / Date / Notes / Fixed
 *     Price / Price per Gram), de-duplicated;
 *   - parses Inventory Code, Item, Type, Grams, Size, Date, Notes, and Pricing;
 *   - detects `HK ITEM` (any casing/variation) → Fixed Price, extracting the price
 *     from a price column, the HK description, or an adjacent block cell;
 *   - flags duplicates and gives SPECIFIC needs-review reasons.
 *
 * It never invents a Price per Gram from unrelated numbers, and never mistakes a
 * code number / grams / ring size / length / date / row number for a Fixed Price.
 */

export type PricingType = 'fixed' | 'per_gram';

export type ImportField =
  | 'code'
  | 'item'
  | 'grams'
  | 'size'
  | 'date'
  | 'notes'
  | 'fixed_price'
  | 'price_per_gram';

export type ImportValidation = 'valid' | 'duplicate' | 'needs_review' | 'ignored';

export type ImportCandidate = {
  sheet: string;
  /** 1-based worksheet row (as the spreadsheet shows it). */
  sourceRow: number;
  /** Which detected block within the sheet (1-based). */
  sourceBlock: number;
  /** The complete original cell text of the item/description, untouched. */
  original: string;
  inventoryCode: string | null;
  itemName: string | null;
  condition: string | null;
  supplierCode: string | null;
  itemType: string | null;
  grams: string | null;
  size: string | null;
  pricingType: PricingType | null;
  fixedPrice: string | null;
  pricePerGram: string | null;
  computedPrice: string | null;
  date: string | null;
  notes: string | null;
  isHkItem: boolean;
  duplicate: boolean;
  validation: ImportValidation;
  /** Specific reasons (never a bare "needs review"). */
  issues: string[];
};

export type SheetInput = { name: string; rows: string[][] };

export type DetectSummary = {
  worksheets: number;
  blocks: number;
  candidates: number;
  valid: number;
  duplicate: number;
  needsReview: number;
  ignoredBlank: number;
  ignoredHeader: number;
  perSheet: Record<
    string,
    { candidates: number; valid: number; duplicate: number; needsReview: number }
  >;
};

export type DetectResult = { candidates: ImportCandidate[]; summary: DetectSummary };

// ---- header aliases --------------------------------------------------------

const ALIASES: Record<ImportField, string[]> = {
  code: ['code', 'item code', 'inventory code', 'unique code', 'stock code'],
  item: ['item', 'items', 'item name', 'description', 'product'],
  grams: ['grams', 'gram', 'weight', 'wt', 'g'],
  size: ['size', 'length'],
  date: ['date', 'date encoded', 'date added', 'purchase date'],
  notes: ['note', 'notes', 'remarks'],
  fixed_price: [
    'fixed price',
    'price',
    'item price',
    'selling price',
    'srp',
    'cash price',
  ],
  price_per_gram: [
    'price per gram',
    'per gram',
    'price/gram',
    'price per g',
    'ppg',
    'rate',
  ],
};

function normHeader(s: string): string {
  return (s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.:]+$/, '');
}

/** Map a header cell to a field, or null when it is not a recognised header. */
function headerField(cell: string): ImportField | null {
  const n = normHeader(cell);
  if (!n) return null;
  for (const field of Object.keys(ALIASES) as ImportField[]) {
    if (ALIASES[field].includes(n)) return field;
  }
  return null;
}

// ---- HK item + price -------------------------------------------------------

const HK_RE = /\bHK[\s-]?ITEMS?\b/i;
/** A peso amount after an HK marker, e.g. "K18 HK ITEM ₱12,500" / "HK-ITEM 8,500.50". */
const HK_PRICE_RE = /\bHK[\s-]?ITEMS?\b[^\d]*?(?:php|₱|p)?\s*([\d][\d,]*(?:\.\d{1,2})?)/i;

export function isHkText(...parts: Array<string | null | undefined>): boolean {
  return parts.some((p) => p != null && HK_RE.test(p));
}

/** Clean a raw price token ("₱12,500" / "PHP 8,500.50") to a numeric string, or null. */
export function cleanPrice(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const stripped = String(raw)
    .replace(/php/gi, '')
    .replace(/₱/g, '')
    .replace(/,/g, '')
    .trim();
  const m = /(\d+(?:\.\d{1,2})?)/.exec(stripped);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Guard against absurd values (a bare grams/size/row number sneaking in): a real
  // jewelry fixed price is at least ₱100.
  if (n < 100) return null;
  return m[1] ?? null;
}

/** Extract an HK Item's Fixed Price from its description, or null when not present. */
export function extractHkPrice(text: string): string | null {
  const m = HK_PRICE_RE.exec(text ?? '');
  if (!m) return null;
  return cleanPrice(m[1] ?? null);
}

/** Extract the HK item NAME (e.g. "K18 HK ITEM"), keeping any karat prefix. */
function extractHkName(text: string): string | null {
  const m = /((?:k\d{2}\s+)?HK[\s-]?ITEMS?)/i.exec(text ?? '');
  return m ? (m[1] ?? '').replace(/\s+/g, ' ').trim() : null;
}

// ---- block detection -------------------------------------------------------

type Block = {
  index: number;
  headerRow: number; // 0-based
  minCol: number;
  maxCol: number;
  cols: Partial<Record<ImportField, number>>;
};

/** True when a row looks like a header (≥2 recognised header cells). */
function isHeaderRow(row: string[]): boolean {
  let hits = 0;
  for (const cell of row) if (headerField(cell)) hits += 1;
  return hits >= 2;
}

/** Cluster a header row's mapped cells into side-by-side blocks (gap > 2 splits). */
function blocksFromHeaderRow(
  row: string[],
  headerRow: number,
  startIndex: number,
): Block[] {
  const mapped: Array<{ col: number; field: ImportField }> = [];
  row.forEach((cell, col) => {
    const f = headerField(cell);
    if (f) mapped.push({ col, field: f });
  });
  const out: Block[] = [];
  let current: Array<{ col: number; field: ImportField }> = [];
  const flush = () => {
    if (current.length === 0) return;
    const cols: Partial<Record<ImportField, number>> = {};
    for (const { col, field } of current)
      if (cols[field] === undefined) cols[field] = col;
    out.push({
      index: startIndex + out.length,
      headerRow,
      minCol: current[0]!.col,
      maxCol: current[current.length - 1]!.col,
      cols,
    });
  };
  for (const m of mapped) {
    if (current.length > 0 && m.col - current[current.length - 1]!.col > 2) {
      flush();
      current = [];
    }
    current.push(m);
  }
  flush();
  return out;
}

const blank = (s: string | undefined): boolean => (s ?? '').trim() === '';

// ---- per-row parse ---------------------------------------------------------

function get(row: string[], col: number | undefined): string {
  if (col === undefined) return '';
  return (row[col] ?? '').trim();
}

/** Find, within a block's column span, the best "item/description" text for a row —
 *  the mapped item/code column, else the longest non-price text cell in the block. */
function itemTextForBlock(row: string[], block: Block): string {
  const mappedCol = block.cols.item ?? block.cols.code;
  if (mappedCol !== undefined && !blank(row[mappedCol]))
    return (row[mappedCol] ?? '').trim();
  let best = '';
  for (let c = block.minCol; c <= block.maxCol; c += 1) {
    const v = (row[c] ?? '').trim();
    if (v.length > best.length && !/^\d[\d,]*(\.\d+)?$/.test(v)) best = v;
  }
  return best;
}

function buildCandidate(
  sheet: string,
  rowIndex0: number,
  row: string[],
  block: Block,
): ImportCandidate | null {
  const original = itemTextForBlock(row, block);
  const codeCell = get(row, block.cols.code);
  const source = codeCell || original;
  if (blank(source) && blank(original)) return null;

  const parsed = parseInventoryCode(source || original);
  const inventoryCode = parsed.inventoryCode;

  const notes = get(row, block.cols.notes) || null;
  const dateCell = get(row, block.cols.date) || null;
  const hk = isHkText(original, source, notes);

  // Grams: dedicated column first, else parsed from the description.
  const gramsCell = get(row, block.cols.grams);
  const grams = (gramsCell && cleanGrams(gramsCell)) || parsed.grams || null;

  const size = parsed.size;

  // Pricing. HK ITEM → Fixed Price. Else a mapped Fixed Price → Fixed. Else a
  // mapped Price per Gram → per-gram. Never invent a per-gram from stray numbers.
  const fixedCol = cleanPrice(get(row, block.cols.fixed_price));
  const ppgCol = cleanPrice(get(row, block.cols.price_per_gram));

  let pricingType: PricingType | null = null;
  let fixedPrice: string | null = null;
  let pricePerGram: string | null = null;
  const issues: string[] = [];

  if (hk) {
    pricingType = 'fixed';
    fixedPrice =
      fixedCol ??
      extractHkPrice(original) ??
      extractHkPrice(source) ??
      adjacentPrice(row, block);
    if (!fixedPrice)
      issues.push('HK Item detected, but Fixed Price could not be identified.');
  } else if (fixedCol) {
    pricingType = 'fixed';
    fixedPrice = fixedCol;
  } else if (ppgCol) {
    pricingType = 'per_gram';
    pricePerGram = ppgCol;
  }

  const computedPrice =
    pricingType === 'per_gram' && pricePerGram && grams
      ? String(Math.round(Number(grams) * Number(pricePerGram) * 100) / 100)
      : pricingType === 'fixed'
        ? fixedPrice
        : null;

  const itemName = hk
    ? (extractHkName(original) ?? parsed.itemType ?? (original || null))
    : (parsed.itemType ?? (original || null));

  // Validation reasons (specific). Duplicate marking is a SEPARATE workbook-wide
  // pass (markDuplicates) so EVERY occurrence of a repeated code is flagged, not
  // just the second one.
  if (!inventoryCode && !itemName) issues.push('Inventory Code missing');
  if (!inventoryCode && itemName && !hk) issues.push('Inventory Code missing');
  if (
    fixedCol === null &&
    !hk &&
    block.cols.fixed_price !== undefined &&
    !blank(get(row, block.cols.fixed_price))
  ) {
    issues.push('Fixed Price invalid');
  }

  // Save-time corruption guard (Owner 2026-08-29): flag likely code typos — a sequence fused with the
  // grams, a broken decimal, a stray "g", a duplicated code — in the import preview too (the bulk
  // code-entry point), so they land in "needs review" instead of silently importing and inflating the
  // Grams totals. NON-HK only: HK items legitimately carry a comma price inside the code.
  if (!hk) {
    const codeText = (source || '').trim();
    if (codeText) {
      for (const w of detectInventoryCodeIssues(codeText)) issues.push(w);
    }
  }

  let validation: ImportValidation;
  if (
    issues.length > 0 &&
    !(hk && issues.length === 1 && issues[0]!.startsWith('HK Item detected'))
  )
    validation = 'needs_review';
  else if (hk && !fixedPrice) validation = 'needs_review';
  else validation = 'valid';

  return {
    sheet,
    sourceRow: rowIndex0 + 1,
    sourceBlock: block.index,
    original:
      (source && source !== original ? `${source} ${original}`.trim() : original) ||
      source,
    inventoryCode,
    itemName,
    condition: parsed.condition,
    supplierCode: parsed.supplierInitial,
    itemType: parsed.itemType,
    grams,
    size,
    pricingType,
    fixedPrice,
    pricePerGram,
    computedPrice,
    date: dateCell,
    notes,
    isHkItem: hk,
    duplicate: false,
    validation,
    issues,
  };
}

/**
 * Workbook-wide duplicate pass (runs AFTER every candidate is parsed). Builds one
 * normalized-code index across ALL sheets/blocks/rows — valid, needs-review, HK,
 * per-gram, code-column, and text-extracted alike — and flags EVERY occurrence of a
 * repeated code as Duplicate (not just the 2nd). Also flags codes already in
 * inventory, and explains conflicting details across occurrences.
 */
function markDuplicates(candidates: ImportCandidate[], existing: Set<string>): void {
  const groups = new Map<string, ImportCandidate[]>();
  for (const c of candidates) {
    if (!c.inventoryCode) continue;
    const key = c.inventoryCode; // already normalized (parseInventoryCode output)
    const arr = groups.get(key);
    if (arr) arr.push(c);
    else groups.set(key, [c]);
  }

  for (const c of candidates) {
    if (!c.inventoryCode) continue;
    const key = c.inventoryCode;
    const group = groups.get(key) ?? [c];
    const inInventory = existing.has(key);
    const fileCount = group.length;
    if (!inInventory && fileCount <= 1) continue;

    c.duplicate = true;
    c.validation = 'duplicate';

    const conflicts = fileCount > 1 ? conflictingFields(group) : [];
    const where = group
      .filter((g) => g !== c)
      .slice(0, 3)
      .map((g) => `${g.sheet} row ${g.sourceRow}`)
      .join(', ');

    let reason: string;
    if (conflicts.length > 0) {
      reason =
        `Duplicate code with conflicting details — ${conflicts.join(', ')} differ` +
        (where ? ` (also ${where})` : '') +
        '.';
    } else if (fileCount > 1) {
      reason =
        `Duplicate — code ${key} appears ${fileCount}× in this file` +
        (where ? ` (${where})` : '') +
        '.';
    } else {
      reason = `Duplicate — code ${key} already exists in inventory.`;
    }
    if (inInventory && conflicts.length === 0 && fileCount > 1) {
      reason = `Duplicate — code ${key} already exists in inventory and appears ${fileCount}× here.`;
    }
    // Prepend the duplicate reason; keep any parsing/HK issues after it.
    c.issues = [reason, ...c.issues];
  }
}

/** Which detail fields differ across occurrences of the same code. */
function conflictingFields(group: ImportCandidate[]): string[] {
  const fields: Array<[string, (c: ImportCandidate) => string | null]> = [
    ['Grams', (c) => c.grams],
    ['Size', (c) => c.size],
    ['Type', (c) => c.itemType],
    ['Fixed Price', (c) => c.fixedPrice],
    ['Price per Gram', (c) => c.pricePerGram],
    ['Description', (c) => c.itemName],
    ['Date', (c) => c.date],
    ['Source Sheet', (c) => c.sheet],
  ];
  const out: string[] = [];
  for (const [label, read] of fields) {
    const distinct = new Set(group.map((c) => (read(c) ?? '—').trim()));
    if (distinct.size > 1) out.push(label);
  }
  return out;
}

/** Grams cleaner: "1.57g" / "4.67 grams" / "14.95 G" → "1.57"; rejects size/price. */
export function cleanGrams(raw: string): string | null {
  const t = (raw ?? '').trim();
  // A value with an explicit gram unit is unambiguous.
  const withUnit = /(\d*\.?\d+)\s*(?:g|gram|grams)\b/i.exec(t);
  if (withUnit) return withUnit[1] ?? null;
  // A bare number in a Grams COLUMN — accept a plausible weight (< 10000, not a year).
  const bare = /^(\d*\.?\d+)$/.exec(t);
  if (bare) {
    const n = Number(bare[1]);
    if (Number.isFinite(n) && n > 0 && n < 10000) return bare[1] ?? null;
  }
  return null;
}

/** A price from a cell adjacent to (just right of) the block, same row. */
function adjacentPrice(row: string[], block: Block): string | null {
  for (let c = block.maxCol + 1; c <= block.maxCol + 2 && c < row.length; c += 1) {
    const p = cleanPrice(row[c]);
    if (p) return p;
  }
  return null;
}

// ---- top-level detection ---------------------------------------------------

export function detectInventory(
  sheets: SheetInput[],
  existingCodes: string[],
): DetectResult {
  const existing = new Set(
    existingCodes
      .map((c) => normalizeInventoryCode(c) ?? c.toUpperCase().trim())
      .filter(Boolean),
  );
  const candidates: ImportCandidate[] = [];
  const summary: DetectSummary = {
    worksheets: sheets.length,
    blocks: 0,
    candidates: 0,
    valid: 0,
    duplicate: 0,
    needsReview: 0,
    ignoredBlank: 0,
    ignoredHeader: 0,
    perSheet: {},
  };

  for (const sheet of sheets) {
    summary.perSheet[sheet.name] = {
      candidates: 0,
      valid: 0,
      duplicate: 0,
      needsReview: 0,
    };

    // 1) Find header rows and their blocks.
    const blocksByRow = new Map<number, Block[]>();
    let blockCounter = 0;
    sheet.rows.forEach((row, r) => {
      if (isHeaderRow(row)) {
        const blocks = blocksFromHeaderRow(row, r, blockCounter + 1);
        blockCounter += blocks.length;
        blocksByRow.set(r, blocks);
        summary.blocks += blocks.length;
        summary.ignoredHeader += 1;
      }
    });

    const headerRowSet = new Set(blocksByRow.keys());

    if (blocksByRow.size > 0) {
      // 2) For each block, read data rows until the next header row or a run-ending
      //    blank row within the block's columns.
      for (const [headerRow, blocks] of blocksByRow) {
        for (const block of blocks) {
          for (let r = headerRow + 1; r < sheet.rows.length; r += 1) {
            if (headerRowSet.has(r)) break; // next block/table starts
            const row = sheet.rows[r] ?? [];
            const spanBlank = row
              .slice(block.minCol, block.maxCol + 1)
              .every((c) => blank(c));
            if (spanBlank) {
              summary.ignoredBlank += 1;
              continue;
            }
            const cand = buildCandidate(sheet.name, r, row, block);
            if (!cand) {
              summary.ignoredBlank += 1;
              continue;
            }
            candidates.push(cand);
          }
        }
      }
    } else {
      // 3) No headers at all — a description-only sheet. Accept rows that resolve to
      //    a code OR contain an HK item; skip pure noise.
      const block: Block = { index: 1, headerRow: -1, minCol: 0, maxCol: 0, cols: {} };
      summary.blocks += 1;
      sheet.rows.forEach((row, r) => {
        if (blank(row.join(''))) {
          summary.ignoredBlank += 1;
          return;
        }
        // Choose the longest text cell as the description.
        let best = '';
        let bestCol = 0;
        row.forEach((c, i) => {
          const v = (c ?? '').trim();
          if (v.length > best.length) {
            best = v;
            bestCol = i;
          }
        });
        const singleBlock: Block = { ...block, minCol: bestCol, maxCol: bestCol };
        if (!normalizeInventoryCode(best) && !isHkText(best)) {
          summary.ignoredBlank += 1;
          return;
        }
        const cand = buildCandidate(sheet.name, r, row, singleBlock);
        if (cand) candidates.push(cand);
        else summary.ignoredBlank += 1;
      });
    }
  }

  // Workbook-wide duplicate pass — ALL sheets/blocks together, every occurrence.
  markDuplicates(candidates, existing);

  // Per-sheet + overall counts (after duplicates are marked).
  for (const c of candidates) {
    const per = summary.perSheet[c.sheet];
    if (per) {
      per.candidates += 1;
      if (c.validation === 'valid') per.valid += 1;
      else if (c.validation === 'duplicate') per.duplicate += 1;
      else if (c.validation === 'needs_review') per.needsReview += 1;
    }
  }

  summary.candidates = candidates.length;
  summary.valid = candidates.filter((c) => c.validation === 'valid').length;
  summary.duplicate = candidates.filter((c) => c.validation === 'duplicate').length;
  summary.needsReview = candidates.filter((c) => c.validation === 'needs_review').length;

  return { candidates, summary };
}
