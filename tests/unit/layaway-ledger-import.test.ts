import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Imported layaway ledger (Owner request). The feature is separate from the
 * order-derived money machinery. These pin the money-honesty + import rules that
 * are hard to see in a render test: status normalization, Balance validation,
 * duplicate detection, and that no float ever touches the peso amounts.
 */

const root = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

describe('layaway ledger domain', () => {
  const domain = read('src', 'lib', 'payments', 'layaway-ledger.ts');

  it('imports through the guarded database function, Owner/Admin only', () => {
    expect(domain).toContain("rpc('import_layaway_ledger'");
    expect(domain).toContain('requireOwnerOrAdmin');
  });

  it('keeps money as strings — never parses a peso amount to a float', () => {
    expect(domain).not.toMatch(/parseFloat|Number\(\s*(item|grand|payment|balance)/i);
  });
});

describe('layaway CSV analyzer', () => {
  // A.V.-shaped sample: a junk row above the real header, a blank Code + blank
  // Customer header, main fields, one DATE/INTEREST installment pair, a TOTAL, one
  // DATE/MOP/DP payment group, then RESIZE/SCREW/NOTES.
  const H =
    ',   ,STATUS,REMARKS,DATE PURCHASE,ITEM,INTEREST,G. TOTAL,PAYMENT,BALANCE,DATE,INTEREST,TOTAL,DATE,MOP,DP,RESIZE,SCREW,NOTES';
  const sample = [
    'f,,,,,,,,,,junk,,,,,,,,',
    H,
    'A1,ALLYN MAE,ON PROGRESS,OK,"June 13, 2026","₱22,530","₱1,292","₱23,821","₱11,280","₱12,541","July 13, 2026",₱431,"₱1,292",13-Jun-26,BPI,"₱5,000",,,',
    'A6,,COMPLETED,,,,,,,,,,,,,,,,',
    'A3,ANE JO,ON PROGRESS,OK,"May 29, 2026","₱11,297",₱644,"₱11,941","₱2,300","₱9,000","June 29, 2026",₱215,₱644,03-Jun-26,BPI,"₱2,300",,,',
    'A4,ERR CUSTOMER,ERROR,OK,"May 1, 2026","₱1,000",₱0,"₱1,000",₱0,"₱1,000",,,,,,,,,',
    'A5,DONE CUSTOMER,COMPLETED,OK,"April 1, 2026","₱5,000",₱0,"₱5,000","₱5,000",₱0,,,,01-Apr-26,CASH,"₱5,000",,,',
  ].join('\n');

  it('detects the header row past the junk row and parses named rows only', async () => {
    const { analyzeLayawayCsv } = await import('@/lib/import/layaway-csv');
    const a = analyzeLayawayCsv(sample);
    expect(a.ok).toBe(true);
    expect(a.headerRowIndex).toBe(1); // row 0 is junk
    // A6 (Code + Status but no Customer Name) is skipped.
    expect(a.records.map((r) => r.code)).toEqual(['A1', 'A3', 'A4', 'A5']);
  });

  it('maps ERROR → needs_review (hard block) and COMPLETED → completed', async () => {
    const { analyzeLayawayCsv } = await import('@/lib/import/layaway-csv');
    const a = analyzeLayawayCsv(sample);
    const err = a.records.find((r) => r.code === 'A4')!;
    expect(err.status).toBe('needs_review');
    expect(err.needsReview).toBe(true); // excluded from import + totals
    const done = a.records.find((r) => r.code === 'A5')!;
    expect(done.status).toBe('completed'); // balance 0, appears under Completed
    expect(done.balanceMismatch).toBe(false);
    // The active row stays active.
    expect(a.records.find((r) => r.code === 'A1')!.status).toBe('active');
  });

  it('normalizes status, parses money as strings, and parses installments + payments', async () => {
    const { analyzeLayawayCsv } = await import('@/lib/import/layaway-csv');
    const a = analyzeLayawayCsv(sample);
    const a1 = a.records[0]!;
    expect(a1.name).toBe('ALLYN MAE');
    expect(a1.status).toBe('active'); // ON PROGRESS → active
    expect(a1.grandTotal).toBe('23821');
    expect(a1.installments).toHaveLength(1);
    expect(a1.payments).toHaveLength(1);
    expect(a1.payments[0]!.mop).toBe('BPI');
    expect(a1.balanceMismatch).toBe(false); // 23821 − 11280 = 12541
  });

  it('flags a Balance ≠ Grand Total − Payment mismatch without overwriting', async () => {
    const { analyzeLayawayCsv } = await import('@/lib/import/layaway-csv');
    const a = analyzeLayawayCsv(sample);
    const a3 = a.records[1]!; // balance 9,000 ≠ 11,941 − 2,300 = 9,641
    expect(a3.balanceMismatch).toBe(true);
    // A soft flag: still importable (not a hard needs-review ERROR block).
    expect(a3.needsReview).toBe(false);
    expect(a3.reviewReason).toContain('Balance');
    expect(a3.balance).toBe('9000'); // uploaded value preserved, never corrected
  });

  it('dedups by original Code first, else customer + date + grand total', async () => {
    const { layawayDedupKey } = await import('@/lib/import/layaway-csv');
    expect(
      layawayDedupKey({ code: 'A1', name: 'X', datePurchased: null, grandTotal: '1' }),
    ).toBe('code:A1');
    expect(
      layawayDedupKey({
        code: null,
        name: 'Ben',
        datePurchased: '2026-05-03',
        grandTotal: '100',
      }),
    ).toContain('cust:ben|2026-05-03|100');
  });
});

describe('layaway workspace merge', () => {
  const ws = read('src', 'components', 'payments', 'payments-workspace.tsx');

  it('renders the fixed 11-column Layaway Accounts order incl. Order/Account No.', () => {
    for (const h of [
      'Customer Name',
      'Status',
      'Remarks',
      'Date Purchased',
      'Item',
      'Interest',
      'Grand Total',
      'Payment',
      'Balance',
      'Order / Account No.',
    ]) {
      expect(ws).toContain(h);
    }
  });

  it('keeps the empty state and merges derived + imported ledger rows', () => {
    expect(ws).toContain('No layaway accounts found.');
    expect(ws).toContain('fromDerived');
    expect(ws).toContain('fromLedger');
  });
});
