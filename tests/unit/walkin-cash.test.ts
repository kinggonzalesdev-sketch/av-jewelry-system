import { describe, expect, it } from 'vitest';

import { walkInCashSplit, type WalkInPayLite } from '@/lib/orders/walkin-cash';

/** Pesos → integer centavos. */
const c = (peso: number): bigint => BigInt(Math.round(peso * 100));
const cash = (peso: number): WalkInPayLite => ({ method: 'Cash', amountCentavos: c(peso) });
const gcash = (peso: number): WalkInPayLite => ({ method: 'GCash', amountCentavos: c(peso) });

describe('walkInCashSplit — cash change (Owner 2026-09-02)', () => {
  // CASE 1 — exact cash: no change, fully applied.
  it('CASE 1 exact cash: total 189240, cash 189240 → change 0, applied 189240', () => {
    const s = walkInCashSplit([cash(189240)], c(189240));
    expect(s.changeCentavos).toBe(c(0));
    expect(s.appliedCentavos).toBe(c(189240));
    expect(s.tenderedCentavos).toBe(c(189240));
    expect(s.applied).toEqual([c(189240)]);
    expect(s.nonCashOverpays).toBe(false);
  });

  // CASE 2 — cash exceeds: change = excess, applied capped at total.
  it('CASE 2 cash exceeds: total 189240, cash 189250 → change 10, applied 189240', () => {
    const s = walkInCashSplit([cash(189250)], c(189240));
    expect(s.tenderedCentavos).toBe(c(189250)); // "Total Paid" shows the gross tender
    expect(s.changeCentavos).toBe(c(10));
    expect(s.appliedCentavos).toBe(c(189240)); // revenue = applied, never 189250
    expect(s.applied).toEqual([c(189240)]); // the SAVED cash amount is capped
  });

  // CASE 3 — large bill.
  it('CASE 3 large bill: total 850, cash 1000 → change 150, applied 850', () => {
    const s = walkInCashSplit([cash(1000)], c(850));
    expect(s.changeCentavos).toBe(c(150));
    expect(s.appliedCentavos).toBe(c(850));
    expect(s.applied).toEqual([c(850)]);
  });

  // CASE 4 — partial cash: no change, balance remains.
  it('CASE 4 partial cash: total 1000, cash 600 → change 0, applied 600 (balance remains)', () => {
    const s = walkInCashSplit([cash(600)], c(1000));
    expect(s.changeCentavos).toBe(c(0));
    expect(s.appliedCentavos).toBe(c(600));
    expect(s.applied).toEqual([c(600)]);
    expect(s.nonCashOverpays).toBe(false);
  });

  // CASE 5 — mixed: change from cash only; applied total = sale total; net collected = 10000.
  it('CASE 5 mixed: total 10000, GCash 4000 + cash 6500 → change 500, applied 10000 (cash applied 6000)', () => {
    const s = walkInCashSplit([gcash(4000), cash(6500)], c(10000));
    expect(s.tenderedCentavos).toBe(c(10500));
    expect(s.nonCashCentavos).toBe(c(4000));
    expect(s.changeCentavos).toBe(c(500));
    expect(s.appliedCentavos).toBe(c(10000)); // NOT 10500 — change is not collected
    expect(s.applied).toEqual([c(4000), c(6000)]); // GCash as-is, cash capped to the room left
    expect(s.nonCashOverpays).toBe(false);
  });

  // CASE 6 — non-cash overpayment: flagged for the caller to BLOCK.
  it('CASE 6 non-cash overpay: total 1000, GCash 1100 → nonCashOverpays true', () => {
    const s = walkInCashSplit([gcash(1100)], c(1000));
    expect(s.nonCashOverpays).toBe(true);
  });

  // Non-cash exactly at total, cash on top → all cash is change, cash applies 0 (dropped on save).
  it('non-cash fills the total; extra cash is pure change (applies 0)', () => {
    const s = walkInCashSplit([gcash(1000), cash(200)], c(1000));
    expect(s.changeCentavos).toBe(c(200));
    expect(s.appliedCentavos).toBe(c(1000));
    expect(s.applied).toEqual([c(1000), c(0)]); // the cash row applies nothing — it's change
    expect(s.nonCashOverpays).toBe(false);
  });

  it('no payments → zero everything', () => {
    const s = walkInCashSplit([], c(1000));
    expect(s.tenderedCentavos).toBe(c(0));
    expect(s.appliedCentavos).toBe(c(0));
    expect(s.changeCentavos).toBe(c(0));
  });
});
