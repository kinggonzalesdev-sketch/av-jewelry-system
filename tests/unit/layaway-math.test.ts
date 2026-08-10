import { describe, expect, it } from 'vitest';

import { layawaySetupFigures, normalizeLayawayTerm } from '@/lib/payments/layaway-math';

/**
 * Layaway interest is charged for the WHOLE term: total = monthly × term. These are
 * the exact success-test figures from the spec (item ₱9,940; 1.42g × ₱150 = ₱213/mo).
 * All amounts are exact integer centavos.
 */

const ITEM = 994000n; // ₱9,940.00
const MONTHLY = 21300n; // ₱213.00 (1.42g × ₱150)

describe('layawaySetupFigures — term-based interest', () => {
  it('1 month → interest ₱213, grand ₱10,153', () => {
    const f = layawaySetupFigures({ itemCentavos: ITEM, monthlyInterestCentavos: MONTHLY, term: 1, paymentCentavos: 0n });
    expect(f.totalInterest).toBe(21300n);
    expect(f.grandTotal).toBe(1015300n);
    expect(f.balance).toBe(1015300n);
  });

  it('2 months → interest ₱426, grand ₱10,366', () => {
    const f = layawaySetupFigures({ itemCentavos: ITEM, monthlyInterestCentavos: MONTHLY, term: 2, paymentCentavos: 0n });
    expect(f.totalInterest).toBe(42600n);
    expect(f.grandTotal).toBe(1036600n);
  });

  it('3 months → interest ₱639, grand ₱10,579; a ₱1,000 payment leaves ₱9,579', () => {
    const f = layawaySetupFigures({ itemCentavos: ITEM, monthlyInterestCentavos: MONTHLY, term: 3, paymentCentavos: 100000n });
    expect(f.totalInterest).toBe(63900n);
    expect(f.grandTotal).toBe(1057900n);
    expect(f.balance).toBe(957900n); // ₱9,579.00
  });

  it('no interest → grand equals the item total for any term', () => {
    const f = layawaySetupFigures({ itemCentavos: ITEM, monthlyInterestCentavos: 0n, term: 3, paymentCentavos: 0n });
    expect(f.totalInterest).toBe(0n);
    expect(f.grandTotal).toBe(ITEM);
  });

  it('normalizes an out-of-range term to a single month', () => {
    expect(normalizeLayawayTerm(1)).toBe(1);
    expect(normalizeLayawayTerm(2)).toBe(2);
    expect(normalizeLayawayTerm(3)).toBe(3);
    expect(normalizeLayawayTerm(0)).toBe(1);
    expect(normalizeLayawayTerm(5)).toBe(1);
  });
});
