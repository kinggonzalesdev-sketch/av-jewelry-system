import { describe, expect, it } from 'vitest';

import {
  AUTO_TEXT_DEFAULT_BODY,
  autoTextSampleValues,
  buildAutoTextValues,
  formatCentavosPlain,
  gramsTimesRateCentavos,
  layawayDpCentavos,
  pesosToCentavos,
  renderAutoText,
} from '@/lib/messaging/auto-text';

/**
 * The Auto Sent Text Message engine (Owner 2026-08-22). Integer-centavo money (never a float), a
 * conditional 20% Layaway DP at/above ₱15,000, and MODE-AWARE suppression from ONE template.
 */

describe('money — integer centavos, half-up (never a float)', () => {
  it('grams × rate: 3.08 × ₱7,300 = ₱22,484.00 exactly', () => {
    const c = gramsTimesRateCentavos('3.08', '7300');
    expect(c).toBe(2_248_400n);
    expect(formatCentavosPlain(c!)).toBe('22,484');
  });

  it('grams × rate rounds HALF-UP at the centavo (1.5 × ₱7,333.33 → ₱11,000.00)', () => {
    const c = gramsTimesRateCentavos('1.5', '7333.33');
    expect(c).toBe(1_100_000n); // 10,999.995 → 11,000.00
  });

  it('grams × rate carries centavos (0.333 × ₱3 → ₱1.00)', () => {
    expect(formatCentavosPlain(gramsTimesRateCentavos('0.333', '3')!)).toBe('1');
  });

  it('a fractional total shows exactly two decimals; a whole total shows none', () => {
    expect(formatCentavosPlain(2_248_400n)).toBe('22,484');
    expect(formatCentavosPlain(449_680n)).toBe('4,496.80');
    expect(formatCentavosPlain(1_500_000n)).toBe('15,000');
  });

  it('rejects a non-number rather than guessing', () => {
    expect(gramsTimesRateCentavos('abc', '7300')).toBeNull();
    expect(pesosToCentavos('—')).toBeNull();
  });
});

describe('Layaway DP — 20%, conditional at ₱15,000', () => {
  it('₱22,484 → ₱4,496.80 (20%)', () => {
    expect(formatCentavosPlain(layawayDpCentavos(2_248_400n)!)).toBe('4,496.80');
  });

  it('exactly ₱15,000 → ₱3,000 (20%)', () => {
    expect(formatCentavosPlain(layawayDpCentavos(1_500_000n)!)).toBe('3,000');
  });

  it('below ₱15,000 → no DP (null, so the line is omitted — never ₱0)', () => {
    expect(layawayDpCentavos(1_499_900n)).toBeNull(); // ₱14,999
    expect(layawayDpCentavos(1_499_999n)).toBeNull(); // ₱14,999.99
  });
});

describe('buildAutoTextValues — canonical, mode-aware, safe on incomplete data', () => {
  it('GRAMS fills per-gram/grams/total/DP; leaves fixed empty', () => {
    const v = buildAutoTextValues({
      mode: 'grams',
      firstName: 'Ruby',
      grams: '3.08',
      pricePerGram: '7300',
    })!;
    expect(v['{price_per_gram}']).toBe('7,300');
    expect(v['{grams}']).toBe('3.08');
    expect(v['{total_amount}']).toBe('22,484');
    expect(v['{layaway_dp}']).toBe('4,496.80');
    expect(v['{fixed_price}']).toBe('');
  });

  it('FIXED fills fixed/total/DP; leaves per-gram/grams empty; total = fixed price', () => {
    const v = buildAutoTextValues({ mode: 'fixed', firstName: 'Ruby', fixedPrice: '15000' })!;
    expect(v['{fixed_price}']).toBe('15,000');
    expect(v['{total_amount}']).toBe('15,000');
    expect(v['{layaway_dp}']).toBe('3,000');
    expect(v['{price_per_gram}']).toBe('');
    expect(v['{grams}']).toBe('');
  });

  it('FIXED below ₱15,000 → no DP value', () => {
    const v = buildAutoTextValues({ mode: 'fixed', firstName: 'Ruby', fixedPrice: '14999' })!;
    expect(v['{total_amount}']).toBe('14,999');
    expect(v['{layaway_dp}']).toBe('');
  });

  it('returns null when the business data is incomplete (grams with no rate → do not send)', () => {
    expect(buildAutoTextValues({ mode: 'grams', firstName: 'Ruby', grams: '3.08' })).toBeNull();
    expect(
      buildAutoTextValues({ mode: 'grams', firstName: 'Ruby', pricePerGram: '7300' }),
    ).toBeNull();
    expect(buildAutoTextValues({ mode: 'fixed', firstName: 'Ruby', fixedPrice: '' })).toBeNull();
  });
});

describe('renderAutoText — one template, mode-aware suppression', () => {
  const grams = () =>
    renderAutoText(
      AUTO_TEXT_DEFAULT_BODY,
      buildAutoTextValues({ mode: 'grams', firstName: 'Ruby', grams: '3.08', pricePerGram: '7300' })!,
    );
  const fixed = () =>
    renderAutoText(
      AUTO_TEXT_DEFAULT_BODY,
      buildAutoTextValues({ mode: 'fixed', firstName: 'Ruby', fixedPrice: '15000' })!,
    );

  it('GRAMS shows per-gram + grams + total + DP; HIDES the Fixed Price line', () => {
    const m = grams();
    expect(m).toContain('Item Per Gram: ₱7,300/g');
    expect(m).toContain('Grams: 3.08g');
    expect(m).toContain('Total Amount: ₱22,484');
    expect(m).toContain('For Layaway DP: ₱4,496.80');
    expect(m).not.toContain('Fixed Price');
  });

  it('FIXED shows fixed + total + DP; HIDES Item Per Gram + Grams + /g', () => {
    const m = fixed();
    expect(m).toContain('Fixed Price: ₱15,000');
    expect(m).toContain('Total Amount: ₱15,000');
    expect(m).toContain('For Layaway DP: ₱3,000');
    expect(m).not.toContain('Item Per Gram');
    expect(m).not.toMatch(/\bGrams:/);
    expect(m).not.toContain('/g');
  });

  it('DP line is omitted below ₱15,000 (grams total ₱7,300)', () => {
    const m = renderAutoText(
      AUTO_TEXT_DEFAULT_BODY,
      buildAutoTextValues({ mode: 'grams', firstName: 'Ruby', grams: '1', pricePerGram: '7300' })!,
    );
    expect(m).toContain('Total Amount: ₱7,300');
    expect(m).not.toContain('For Layaway DP');
  });

  it('keeps the payment + contact lines (no dynamic token → never dropped)', () => {
    const m = grams();
    expect(m).toContain('ONLY Mode of Payment:');
    expect(m).toContain('BDO - AV De Asis Jewelry 010128006991');
    expect(m).toContain('0917-2035-820');
    expect(m).toContain('Thank you beshy for trusting & supporting A.V. Jewelry!💕😊');
  });

  it('empty {first_name} → "Hi beshy!" (no stray space before the "!")', () => {
    const m = renderAutoText(
      AUTO_TEXT_DEFAULT_BODY,
      buildAutoTextValues({ mode: 'fixed', firstName: '', fixedPrice: '15000' })!,
    );
    expect(m).toContain('Hi beshy! 💛');
    expect(m).not.toContain('Hi beshy !');
  });
});

// GUARD (Owner 2026-08-22 payment-link incident): the AUTO TEXT must NEVER carry a link — no URL,
// no /orders, no /payments, no secure 🔗 link, no "vercel"/"http"/l.php.
describe('AUTO TEXT is link-free (locked)', () => {
  const bodies = [
    AUTO_TEXT_DEFAULT_BODY,
    renderAutoText(
      AUTO_TEXT_DEFAULT_BODY,
      buildAutoTextValues({ mode: 'grams', firstName: 'Ruby', grams: '3.08', pricePerGram: '7300' })!,
    ),
    renderAutoText(
      AUTO_TEXT_DEFAULT_BODY,
      buildAutoTextValues({ mode: 'fixed', firstName: 'Ruby', fixedPrice: '15000' })!,
    ),
  ];
  it('no link of any kind in the default or either rendered mode', () => {
    for (const m of bodies) {
      expect(m).not.toMatch(/https?:\/\//i);
      expect(m).not.toMatch(/\/orders|\/payments|orders\/payments/i);
      expect(m).not.toMatch(/vercel|avjewelry\.online|l\.php|🔗/i);
    }
  });
});

describe('Live Preview parity — the sample the Settings editor renders', () => {
  it('GRAMS sample = Owner spec (₱7,300/g · 3.08g · ₱22,484 · DP ₱4,496.80)', () => {
    const v = autoTextSampleValues('grams');
    expect(v['{price_per_gram}']).toBe('7,300');
    expect(v['{grams}']).toBe('3.08');
    expect(v['{total_amount}']).toBe('22,484');
    expect(v['{layaway_dp}']).toBe('4,496.80');
  });

  it('FIXED sample = ₱15,000 → total ₱15,000 → DP ₱3,000', () => {
    const v = autoTextSampleValues('fixed');
    expect(v['{fixed_price}']).toBe('15,000');
    expect(v['{total_amount}']).toBe('15,000');
    expect(v['{layaway_dp}']).toBe('3,000');
  });
});
