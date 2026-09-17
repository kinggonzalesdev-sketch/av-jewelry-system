import { describe, expect, it } from 'vitest';

import { walkInCashSplit } from '@/lib/orders/walkin-cash';
import {
  ACCEPTED_PAYMENT_METHODS,
  DEFAULT_PAYMENT_METHOD,
  LEGACY_PAYMENT_METHODS,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_METHODS,
  isCashMethod,
} from '@/lib/payments/methods';

/**
 * The ONE canonical Mode of Payment list (src/lib/payments/methods.ts).
 *
 * WHY THIS TEST EXISTS: "Remittance" was requested on 2026-08-13. The database was widened then
 * (migration 20260813120000), but the one-line edit to this list was never committed and a later
 * session reverted it, so for a month no dropdown offered Remittance and validation refused it.
 * Pinning the exact list makes any future loss of a method fail loudly here.
 */
describe('PAYMENT_METHODS — canonical Mode of Payment list', () => {
  it('is exactly the approved list, in display order, with Remittance last', () => {
    expect([...PAYMENT_METHODS]).toEqual([
      'Cash',
      'GCash',
      'BPI',
      'BDO',
      'BDO NEW',
      'BDO UNIBANK',
      'Credit Card',
      'Remittance',
    ]);
  });

  it('offers Remittance in every dropdown built from the shared options, labelled exactly "Remittance"', () => {
    expect(PAYMENT_METHOD_OPTIONS).toContainEqual({ value: 'Remittance', label: 'Remittance' });
    expect(PAYMENT_METHOD_OPTIONS.filter((o) => o.value === 'Remittance')).toHaveLength(1);
    // value === label for every option (the canonical string is stored verbatim).
    for (const o of PAYMENT_METHOD_OPTIONS) expect(o.label).toBe(o.value);
  });

  it('accepts Remittance in the data layer and keeps every legacy key readable', () => {
    expect(ACCEPTED_PAYMENT_METHODS).toContain('Remittance');
    for (const legacy of LEGACY_PAYMENT_METHODS) expect(ACCEPTED_PAYMENT_METHODS).toContain(legacy);
  });

  it('treats Remittance as NON-cash (no collection location, never counted as drawer cash)', () => {
    expect(isCashMethod('Remittance')).toBe(false);
    expect(isCashMethod('Cash')).toBe(true);
    expect(isCashMethod('cash')).toBe(true);
    expect(DEFAULT_PAYMENT_METHOD).toBe('Cash');
  });

  it('keeps Scrap Walk-In-only and does not add Trade (out of scope)', () => {
    expect(PAYMENT_METHODS as readonly string[]).not.toContain('Scrap');
    expect(PAYMENT_METHODS as readonly string[]).not.toContain('Trade');
  });
});

describe('Walk-In cash split — Remittance behaves like any other non-cash method', () => {
  const c = (peso: number): bigint => BigInt(Math.round(peso * 100));

  it('applies a Remittance payment as entered and never produces change', () => {
    const s = walkInCashSplit([{ method: 'Remittance', amountCentavos: c(1000) }], c(1000));
    expect(s.appliedCentavos).toBe(c(1000));
    expect(s.changeCentavos).toBe(c(0));
    expect(s.nonCashCentavos).toBe(c(1000));
    expect(s.nonCashOverpays).toBe(false);
  });

  it('blocks a Remittance payment larger than the sale (only cash may exceed)', () => {
    const s = walkInCashSplit([{ method: 'Remittance', amountCentavos: c(1200) }], c(1000));
    expect(s.nonCashOverpays).toBe(true);
  });

  it('splits Remittance + Cash with change only from the cash part', () => {
    const s = walkInCashSplit(
      [
        { method: 'Remittance', amountCentavos: c(600) },
        { method: 'Cash', amountCentavos: c(500) },
      ],
      c(1000),
    );
    expect(s.applied).toEqual([c(600), c(400)]);
    expect(s.changeCentavos).toBe(c(100));
    expect(s.nonCashOverpays).toBe(false);
  });
});
