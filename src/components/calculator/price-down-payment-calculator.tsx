'use client';

import { useState } from 'react';

import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Price & Down Payment Calculator (Owner request 2026-08-01; simplified 2026-08-24) — a STAFF
 * UTILITY only. It computes a jewelry item's price (fixed or per-gram) and, for live selling, ONE
 * down payment at a time: a 20% / 30% toggle (default 20%) shows a single DP result. There is no
 * Remaining Balance (Owner removed it) — it updates live as they type.
 *
 * It touches NOTHING else: no order, payment, inventory, or layaway record is read
 * or written here. It is a scratch calculator — numbers in, numbers out.
 */

const PRICE_RE = /^\d{0,12}(\.\d{0,2})?$/;
const GRAMS_RE = /^\d{0,9}(\.\d{0,3})?$/;

/** Parse a money string to integer centavos (avoids floating-point drift). */
function centavos(raw: string): bigint {
  const s = (raw ?? '').trim();
  if (!s || !/^\d*(\.\d*)?$/.test(s)) return 0n;
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w || '0') * 100n + BigInt(`${f}00`.slice(0, 2) || '0');
}

/** centavos → a plain "12345.67" string for formatPeso. */
function toMoney(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** grams (up to 3dp) × price-per-gram (money) → centavos, rounded to the peso cent. */
function perGramCentavos(grams: string, rate: string): bigint {
  const g = (grams ?? '').trim();
  if (!g || !/^\d*(\.\d*)?$/.test(g)) return 0n;
  const [gw = '0', gf = ''] = g.split('.');
  const milli = BigInt(gw || '0') * 1000n + BigInt(`${gf}000`.slice(0, 3) || '0');
  const r = centavos(rate);
  if (milli === 0n || r === 0n) return 0n;
  return (r * milli + 500n) / 1000n;
}

/** percent (10/20/30) of a centavos amount, rounded to the cent. */
function percentOf(amount: bigint, pct: bigint): bigint {
  return (amount * pct + 50n) / 100n;
}

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-11 w-full rounded-lg border border-border bg-background px-3 text-base outline-none focus:border-gold';

export function PriceDownPaymentCalculator() {
  const [pricingType, setPricingType] = useState<'fixed' | 'per_gram'>('fixed');
  const [grams, setGrams] = useState('');
  const [fixedPrice, setFixedPrice] = useState('');
  const [pricePerGram, setPricePerGram] = useState('');
  // The single down-payment percentage shown at a time (Owner 2026-08-24). Default 20%.
  const [dpPct, setDpPct] = useState<20 | 30>(20);

  const isFixed = pricingType === 'fixed';
  const itemCentavos = isFixed
    ? centavos(fixedPrice)
    : perGramCentavos(grams, pricePerGram);
  const hasPrice = itemCentavos > 0n;

  // Only the SELECTED percentage is computed/shown (no Remaining Balance).
  const selectedDown = percentOf(itemCentavos, BigInt(dpPct));

  const onMoney = (setter: (v: string) => void) => (v: string) => {
    if (v === '' || PRICE_RE.test(v)) setter(v);
  };
  const onGrams = (v: string) => {
    if (v === '' || GRAMS_RE.test(v)) setGrams(v);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Special Calculator</h1>

      {/* Inputs card */}
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        {/* Pricing Type — segmented selector */}
        <div>
          <L>Pricing Type</L>
          <div className="flex gap-1 rounded-lg border border-border p-1">
            {(
              [
                ['fixed', 'Fixed Price'],
                ['per_gram', 'Price per Gram'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPricingType(value)}
                data-testid={`calc-type-${value}`}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  pricingType === value
                    ? 'bg-gold text-black'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Fixed → show Fixed Price. Per Gram → show Grams + Price per Gram. */}
        {isFixed ? (
          <label className="block">
            <L>Fixed Price (₱)</L>
            <input
              inputMode="decimal"
              className={fieldClass}
              placeholder="e.g. 20000"
              value={fixedPrice}
              onChange={(e) => onMoney(setFixedPrice)(e.target.value)}
              data-testid="calc-fixed-price"
            />
          </label>
        ) : (
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <label className="block">
              <L>Grams</L>
              <input
                inputMode="decimal"
                className={fieldClass}
                placeholder="e.g. 2.50"
                value={grams}
                onChange={(e) => onGrams(e.target.value)}
                data-testid="calc-grams"
              />
            </label>
            <label className="block">
              <L>Price per Gram (₱)</L>
              <input
                inputMode="decimal"
                className={fieldClass}
                placeholder="e.g. 3800"
                value={pricePerGram}
                onChange={(e) => onMoney(setPricePerGram)(e.target.value)}
                data-testid="calc-price-per-gram"
              />
            </label>
          </div>
        )}

        {/* Computed Item Price */}
        <div className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3">
          <span className="text-sm font-medium text-muted-foreground">
            Computed Item Price
          </span>
          <span className="text-2xl font-bold tabular-nums" data-testid="calc-item-price">
            {hasPrice ? formatPeso(toMoney(itemCentavos)) : '₱0'}
          </span>
        </div>
      </div>

      {/* ✨ SPECIAL FEATURE — attention-grabbing down-payment breakdown. */}
      <div className="overflow-hidden rounded-2xl border-2 border-gold bg-gradient-to-b from-gold/15 to-transparent shadow-lg">
        <div className="flex items-center gap-2 border-b border-gold/40 bg-gold/15 px-4 py-2.5">
          <span className="text-lg" aria-hidden>
            ✨
          </span>
          <h2 className="text-sm font-extrabold uppercase tracking-widest text-gold-strong">
            Special Feature — Down Payment Breakdown
          </h2>
        </div>

        <div className="space-y-4 p-4">
          {/* 20% / 30% toggle — single-select, default 20%, green active state. */}
          <div
            className="flex gap-1 rounded-lg border border-border p-1"
            role="group"
            aria-label="Down payment percentage"
          >
            {([20, 30] as const).map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setDpPct(pct)}
                aria-pressed={dpPct === pct}
                data-testid={`calc-dp-toggle-${pct}`}
                className={cn(
                  'flex-1 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                  dpPct === pct
                    ? 'bg-emerald-600 text-white'
                    : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {pct}% Down Payment
              </button>
            ))}
          </div>

          {/* ONE result card — the selected percentage only, no Remaining Balance. */}
          <div
            className="rounded-xl border border-gold/40 bg-card/80 p-5 text-center"
            data-testid={`calc-tier-${dpPct}`}
          >
            <div className="text-xs font-bold uppercase tracking-wide text-gold-strong">
              {dpPct}% Down Payment
            </div>
            <div
              className="mt-1 text-3xl font-extrabold tabular-nums"
              data-testid={`calc-down-${dpPct}`}
            >
              {hasPrice ? formatPeso(toMoney(selectedDown)) : '₱0'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
