import { parseCsvGrid } from '@/lib/import/parse-csv';

/**
 * Layaway CSV analyzer (Owner request). The A.V. layaway sheet is NOT header-first:
 * it has title/spacer rows above the real header, a blank Code header, a blank
 * Customer-Name header, 100+ columns, and repeated installment (DATE/INTEREST) and
 * payment (DATE/MOP/DP) groups. This module:
 *   1. detects the real header row (scan the first 10),
 *   2. auto-maps the main columns + the repeated groups (no dropdowns needed),
 *   3. parses each account into main fields + installment schedule + payment
 *      history + derived fields, with row-detection + balance validation.
 * Pure + deterministic — the modal only PREVIEWS it; nothing is written until the
 * user confirms and the database RPC re-checks everything.
 */

export type LayawayInstallment = {
  sequence: number;
  dueDate: string | null;
  interest: string | null;
  sourcePosition: number;
};
export type LayawayPayment = {
  sequence: number;
  paymentDate: string | null;
  amount: string | null;
  mop: string | null;
  sourcePosition: number;
};

export type LayawayImportRecord = {
  sourceRow: number;
  code: string | null;
  name: string;
  status: 'active' | 'completed' | 'needs_review';
  statusRaw: string;
  remarks: string | null;
  datePurchased: string | null;
  item: string | null;
  interest: string | null;
  grandTotal: string | null;
  payment: string | null;
  balance: string | null;
  // Derived
  nextDueDate: string | null;
  monthlyInterest: string | null;
  totalInstallmentInterest: string | null;
  lastPaymentDate: string | null;
  modeOfPayment: string | null;
  latestPaymentDp: string | null;
  resize: string | null;
  screw: string | null;
  notes: string | null;
  interestType: 'standard' | 'zero' | 'custom';
  layawayTerm: number | null;
  interestRate: string | null;
  fixedInterest: string | null;
  installments: LayawayInstallment[];
  payments: LayawayPayment[];
  // Flags
  balanceMismatch: boolean;
  needsReview: boolean;
  reviewReason: string | null;
};

export type LayawayCsvAnalysis = {
  ok: boolean;
  error: string | null;
  headerRowIndex: number;
  detectedColumns: string[];
  /** True when the Customer Name column could not be identified (manual map needed). */
  needsManualMapping: boolean;
  records: LayawayImportRecord[];
};

/** Peso/number text → a plain decimal string (strip ₱, commas, spaces), or null. */
export function money(raw: string | undefined): string | null {
  const cleaned = (raw ?? '').replace(/[₱,\s]/g, '').replace(/[^\d.-]/g, '');
  return /^-?\d+(\.\d+)?$/.test(cleaned) ? cleaned : null;
}

/** A date like "June 20, 2026" or "13-Jun-26" → "2026-06-20", or null. */
export function toDate(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Status mapping: ON PROGRESS → active, COMPLETED → completed, ERROR → needs_review.
 * Needs-review rows are hard-blocked from import and from every financial total —
 * they require manual correction first.
 */
function classifyStatus(raw: string): 'active' | 'completed' | 'needs_review' {
  const s = (raw ?? '').toUpperCase();
  if (/ERROR/.test(s)) return 'needs_review';
  if (/COMPLETE/.test(s)) return 'completed';
  return 'active';
}

/** Exact integer centavos from a decimal string (no float). */
function centavos(value: string | null): bigint | null {
  if (value === null) return null;
  const neg = value.startsWith('-');
  const [whole = '0', frac = ''] = value.replace('-', '').split('.');
  const c = BigInt(whole || '0') * 100n + BigInt(`${frac}00`.slice(0, 2) || '0');
  return neg ? -c : c;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');
const compact = (h: string) => norm(h).replace(/[.\s]/g, '');

const HEADER_MARKERS = [
  'status',
  'remarks',
  'datepurchase',
  'item',
  'interest',
  'gtotal',
  'payment',
  'balance',
];

function scoreHeaderRow(row: string[]): number {
  const cells = row.map(compact);
  return HEADER_MARKERS.filter((m) =>
    cells.some((c) => c === m || (m === 'datepurchase' && c === 'datepurchased')),
  ).length;
}

export function analyzeLayawayCsv(text: string): LayawayCsvAnalysis {
  const grid = parseCsvGrid(text);
  if (grid.length === 0) {
    return { ok: false, error: 'That file is empty.', headerRowIndex: -1, detectedColumns: [], needsManualMapping: false, records: [] };
  }

  // 1 — detect the header row within the first 10 rows.
  let headerRowIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, grid.length); i++) {
    const s = scoreHeaderRow(grid[i] ?? []);
    if (s > bestScore) {
      bestScore = s;
      headerRowIndex = i;
    }
  }
  if (bestScore < 4) {
    return {
      ok: false,
      error: 'Could not find the layaway header row (Status, Item, Interest, G. Total, Payment, Balance).',
      headerRowIndex: -1,
      detectedColumns: [],
      needsManualMapping: true,
      records: [],
    };
  }

  const header = grid[headerRowIndex] ?? [];
  const findFirst = (pred: (h: string, i: number) => boolean, from = 0): number => {
    for (let i = from; i < header.length; i++) if (pred(norm(header[i] ?? ''), i)) return i;
    return -1;
  };

  // 2 — main columns, anchored at STATUS (they are contiguous in the sheet).
  const idxStatus = findFirst((h) => h === 'status');
  const idxRemarks = findFirst((h) => h.startsWith('remark'), idxStatus + 1);
  const idxDate = findFirst((h) => h.startsWith('date purchase'), idxStatus + 1);
  const idxItem = findFirst((h) => h === 'item', idxStatus + 1);
  const idxInterest = findFirst((h) => h === 'interest', idxItem + 1);
  const idxGrand = findFirst(
    (h) => h === 'g. total' || h === 'grand total' || compact(h) === 'gtotal',
    idxInterest + 1,
  );
  const idxPayment = findFirst((h) => h === 'payment', idxGrand + 1);
  const idxBalance = findFirst((h) => h === 'balance', idxPayment + 1);

  // Code + Customer sit just before STATUS (blank/whitespace headers). Verify the
  // Code column by its A1/B12 value pattern; Customer is the column beside it.
  const customerCol = idxStatus - 1 >= 0 ? idxStatus - 1 : -1;
  let codeCol = idxStatus - 2 >= 0 ? idxStatus - 2 : -1;
  if (codeCol >= 0) {
    const looksLikeCode = grid
      .slice(headerRowIndex + 1, headerRowIndex + 12)
      .some((r) => /^[A-Za-z]\d{1,3}$/.test((r[codeCol] ?? '').trim()));
    if (!looksLikeCode) codeCol = -1;
  }

  // 3 — installment block (DATE/INTEREST pairs) from Balance+1 up to TOTAL.
  const idxTotal = findFirst((h) => h === 'total', idxBalance + 1);
  const installCols: Array<{ date: number; interest: number }> = [];
  {
    const end = idxTotal >= 0 ? idxTotal : header.length;
    for (let i = idxBalance + 1; i + 1 < end; i += 2) {
      if (norm(header[i] ?? '') === 'date' && norm(header[i + 1] ?? '') === 'interest') {
        installCols.push({ date: i, interest: i + 1 });
      } else break;
    }
  }

  // 4 — payment block (DATE/MOP/DP triples) after TOTAL.
  const payCols: Array<{ date: number; mop: number; dp: number }> = [];
  if (idxTotal >= 0) {
    for (let i = idxTotal + 1; i + 2 < header.length; i += 3) {
      if (
        norm(header[i] ?? '') === 'date' &&
        norm(header[i + 1] ?? '') === 'mop' &&
        norm(header[i + 2] ?? '') === 'dp'
      ) {
        payCols.push({ date: i, mop: i + 1, dp: i + 2 });
      } else break;
    }
  }

  const idxResize = findFirst((h) => h === 'resize');
  const idxScrew = findFirst((h) => h === 'screw');
  const idxNotes = findFirst((h) => h === 'notes');
  // Optional flexible-interest headers.
  const idxIntType = findFirst((h) => h === 'interest type');
  const idxIntRate = findFirst((h) => h === 'interest rate');
  const idxIntAmount = findFirst((h) => h === 'interest amount');
  const idxTerm = findFirst((h) => h === 'layaway term' || h === 'term');

  const detectedColumns: string[] = [
    codeCol >= 0 ? 'Code' : '',
    customerCol >= 0 ? 'Customer Name' : '',
    idxStatus >= 0 ? 'Status' : '',
    idxRemarks >= 0 ? 'Remarks / Financer' : '',
    idxDate >= 0 ? 'Date Purchased' : '',
    idxItem >= 0 ? 'Item' : '',
    idxInterest >= 0 ? 'Interest' : '',
    idxGrand >= 0 ? 'Grand Total' : '',
    idxPayment >= 0 ? 'Payment' : '',
    idxBalance >= 0 ? 'Balance' : '',
    installCols.length ? `${installCols.length} installment columns` : '',
    payCols.length ? `${payCols.length} payment columns` : '',
  ].filter(Boolean);

  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
  const today = new Date().toISOString().slice(0, 10);

  const records: LayawayImportRecord[] = [];
  for (let r = headerRowIndex + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const code = codeCol >= 0 ? cell(row, codeCol) || null : null;
    const name = cell(row, customerCol);
    const statusRaw = cell(row, idxStatus);
    const remarks = cell(row, idxRemarks) || null;
    const datePurchased = toDate(cell(row, idxDate));
    const item = money(cell(row, idxItem));
    const interest = money(cell(row, idxInterest));
    const grandTotal = money(cell(row, idxGrand));
    const payment = money(cell(row, idxPayment));
    const balance = money(cell(row, idxBalance));

    // Row detection: skip fully-blank rows, and rows with no Customer Name (even
    // when a Code / Status is present — template + spacer rows).
    const anyValue = [code, name, statusRaw, remarks, datePurchased, item, interest, grandTotal, payment, balance].some(
      (v) => v && String(v).length > 0,
    );
    if (!anyValue) continue;
    if (!name) continue;

    // Installment schedule.
    const installments: LayawayInstallment[] = [];
    installCols.forEach((c) => {
      const d = toDate(cell(row, c.date));
      const iv = money(cell(row, c.interest));
      if (d || iv) {
        installments.push({ sequence: installments.length + 1, dueDate: d, interest: iv, sourcePosition: c.date });
      }
    });

    // Payment history.
    const payments: LayawayPayment[] = [];
    payCols.forEach((c) => {
      const d = toDate(cell(row, c.date));
      const amt = money(cell(row, c.dp));
      const mop = cell(row, c.mop) || null;
      if (d || amt) {
        payments.push({ sequence: payments.length + 1, paymentDate: d, amount: amt, mop, sourcePosition: c.date });
      }
    });

    // Derived fields (never invented when the source is blank).
    const upcoming = installments.find((i) => i.dueDate && i.dueDate >= today) ?? installments.find((i) => i.dueDate) ?? null;
    const nextDueDate = upcoming?.dueDate ?? null;
    const monthlyInterest = upcoming?.interest ?? null;
    const totalCol = money(cell(row, idxTotal));
    const totalInstallmentInterest =
      totalCol ??
      (installments.length
        ? installments
            .reduce((sum, i) => sum + (centavos(i.interest) ?? 0n), 0n) === 0n
          ? null
          : ((): string => {
              const c = installments.reduce((sum, i) => sum + (centavos(i.interest) ?? 0n), 0n);
              return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
            })()
        : null);
    const paidPayments = payments.filter((p) => p.paymentDate);
    const lastPay = paidPayments.length ? paidPayments[paidPayments.length - 1] : null;
    const lastPaymentDate = lastPay?.paymentDate ?? null;
    const modeOfPayment = lastPay?.mop ?? null;
    const latestPaymentDp = lastPay?.amount ?? null;

    // Flexible interest.
    const rawType = cell(row, idxIntType).toUpperCase();
    const interestRate = money(cell(row, idxIntRate));
    const fixedInterest = money(cell(row, idxIntAmount));
    let interestType: 'standard' | 'zero' | 'custom';
    if (/0\s*%|ZERO\s*INTEREST|NO\s*INTEREST/.test(rawType) || rawType === '0') {
      interestType = 'zero';
    } else if (/CUSTOM/.test(rawType) || interestRate !== null || fixedInterest !== null) {
      interestType = 'custom';
    } else if (/STANDARD/.test(rawType)) {
      interestType = 'standard';
    } else {
      // Derived: no interest (0 or blank with grand == item) → zero; else standard.
      const iC = centavos(interest);
      const gC = centavos(grandTotal);
      const itC = centavos(item);
      const zeroInterest = iC === 0n || (interest === null && gC !== null && itC !== null && gC === itC);
      interestType = zeroInterest ? 'zero' : 'standard';
    }

    // Term: header, else derived from the installment count (1..3).
    const termCell = money(cell(row, idxTerm));
    let layawayTerm: number | null = termCell ? Math.min(3, Math.max(1, Math.round(Number(termCell)))) : null;
    if (layawayTerm === null && installments.length > 0) {
      layawayTerm = Math.min(3, installments.filter((i) => i.dueDate).length || installments.length);
    }

    // Balance validation: Balance = Grand Total − Payment (flag, never overwrite).
    let balanceMismatch = false;
    const g = centavos(grandTotal);
    const p = centavos(payment);
    const b = centavos(balance);
    if (g !== null && p !== null && b !== null && g - p !== b) balanceMismatch = true;

    const status = classifyStatus(statusRaw);

    // needsReview is a HARD block: ERROR-status rows AND rows without a layaway code
    // are excluded from import and from every financial total until corrected. Every
    // account must carry a code (Owner request) — a blank one can't be uploaded.
    // Other issues (balance mismatch, 0% contradiction) are SOFT flags — imported,
    // but marked.
    const noCode = !code || code.trim() === '';
    const needsReview = status === 'needs_review' || noCode;
    let reviewReason: string | null = null;
    if (status === 'needs_review') {
      reviewReason = 'ERROR status — correct before import';
    } else if (noCode) {
      reviewReason = 'Missing layaway code — a code is required to upload.';
    } else if (interestType === 'zero' && centavos(interest) !== null && centavos(interest) !== 0n) {
      reviewReason = '0% interest but a non-zero interest value';
    } else if (interestType !== 'zero' && layawayTerm === null && centavos(interest) !== 0n && interest !== null) {
      reviewReason = 'Interest present but term could not be determined';
    } else if (balanceMismatch) {
      reviewReason = 'Balance ≠ Grand Total − Payment';
    }

    records.push({
      sourceRow: r + 1,
      code,
      name,
      status,
      statusRaw,
      remarks,
      datePurchased,
      item,
      interest,
      grandTotal,
      payment,
      balance,
      nextDueDate,
      monthlyInterest,
      totalInstallmentInterest,
      lastPaymentDate,
      modeOfPayment,
      latestPaymentDp,
      resize: cell(row, idxResize) || null,
      screw: cell(row, idxScrew) || null,
      notes: cell(row, idxNotes) || null,
      interestType,
      layawayTerm,
      interestRate,
      fixedInterest,
      installments,
      payments,
      balanceMismatch,
      needsReview,
      reviewReason,
    });
  }

  return {
    ok: true,
    error: null,
    headerRowIndex,
    detectedColumns,
    needsManualMapping: customerCol < 0,
    records,
  };
}

/** Duplicate key for a record: original Code when present, else customer+date+grand. */
export function layawayDedupKey(rec: {
  code: string | null;
  name: string;
  datePurchased: string | null;
  grandTotal: string | null;
}): string {
  if (rec.code) return `code:${rec.code.trim().toUpperCase()}`;
  const numKey = (s: string | null) => {
    if (s === null || s === '') return '';
    if (!s.includes('.')) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
  };
  return `cust:${rec.name.trim().toLowerCase()}|${rec.datePurchased ?? ''}|${numKey(rec.grandTotal)}`;
}
