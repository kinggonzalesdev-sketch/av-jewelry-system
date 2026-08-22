/**
 * The AUTO SENT TEXT MESSAGE engine (Owner 2026-08-22).
 *
 * This is the ONE configurable template a customer receives when a Capture cannot send the actual
 * screenshot PHOTO (Route B Private Reply). It is deliberately NOT `server-only`: the Settings editor
 * (a client component) must build its Live Preview with the SAME substitution + money math the server
 * uses when it renders the real message, so the two can never drift.
 *
 * Design:
 *   - MODE-AWARE by SUPPRESSION, from ONE template. The saved body carries BOTH pricing blocks
 *     (grams: "Item Per Gram" + "Grams"; fixed: "Fixed Price"). A line whose only dynamic value is an
 *     OPTIONAL token (per-gram / grams / fixed price / layaway DP) is DROPPED when that value is empty
 *     — so a grams Capture never shows a Fixed Price line, a fixed Capture never shows a grams line,
 *     and the Layaway DP line disappears below the threshold. The Owner keeps ONE template, never two.
 *   - Financial VALUES are computed from the FINALIZED Capture business data (grams × rate, or the
 *     fixed price) — never OCR'd or reclassified here. The template text may be edited (greeting,
 *     payment instructions, contacts, closing); the numbers always come from canonical data.
 *   - Money is INTEGER-CENTAVO (BigInt) math, half-up — never a float (0.1 + 0.2 !== 0.3). Formatting
 *     reuses the ONE canonical peso formatter so an AUTO TEXT peso matches every other peso in the app.
 *   - NO link of any kind (payment / orders / screenshot / secure /m). Locked by tests.
 */

import { formatPeso } from '@/lib/payments/format';
import { normalizeGrams, parseFixedPrice } from '@/lib/print/order-receipt';

export const AUTO_TEXT_KEY = 'auto_text';
export const AUTO_TEXT_LABEL = 'Auto Sent Text Message';
export const SHOP_NAME_DEFAULT = 'A.V. Jewelry';

/**
 * Owner rule (2026-08-22): SUGGEST a layaway down payment only when the total is at least ₱15,000,
 * at 20% of the total. This is a MESSAGING/display rule for the auto-reply — it does NOT change the
 * canonical Layaway ACTIVATION rule (app_private.required_down_payment = 20% of the fee-included
 * Layaway Amount Payable, half-up to 2dp, no threshold). Both use 20% and half-up rounding, so the
 * suggested figure is consistent; it is an ESTIMATE on the item total (a layaway term later adds the
 * ₱150 × grams × months fee to the canonical required deposit).
 */
export const LAYAWAY_DP_THRESHOLD_PESOS = 15000;
export const LAYAWAY_DP_THRESHOLD_CENTAVOS = 1_500_000n;
export const LAYAWAY_DP_PERCENT = 20;

export type AutoTextMode = 'grams' | 'fixed';

/** Every variable the AUTO TEXT template may use — its own contract, separate from the Invoice set. */
export const AUTO_TEXT_VARIABLES: ReadonlyArray<{
  token: string;
  description: string;
  sample: string;
}> = [
  { token: '{first_name}', description: "The customer's first name", sample: 'Ruby' },
  {
    token: '{price_per_gram}',
    description: 'Price per gram — grams mode only',
    sample: '7,300',
  },
  { token: '{grams}', description: 'Weight in grams — grams mode only', sample: '3.08' },
  {
    token: '{fixed_price}',
    description: 'Fixed price — fixed-price mode only',
    sample: '15,000',
  },
  {
    token: '{total_amount}',
    description: 'Computed total (grams × rate, or the fixed price)',
    sample: '22,484',
  },
  {
    token: '{layaway_dp}',
    description: '20% down payment — shown only when the total is ₱15,000 or more',
    sample: '4,496.80',
  },
  { token: '{shop_name}', description: 'Your shop name', sample: SHOP_NAME_DEFAULT },
];

/** Just the tokens — the whitelist the AUTO TEXT template is validated against on Save. */
export const AUTO_TEXT_TOKENS: readonly string[] = AUTO_TEXT_VARIABLES.map((v) => v.token);

/**
 * The OPTIONAL tokens: a template line whose dynamic content is ONE of these is removed entirely when
 * the value is empty. This is what makes the single template mode-aware — the grams lines vanish for a
 * fixed Capture, the fixed line vanishes for a grams Capture, and the DP line vanishes below ₱15,000.
 * `{total_amount}`, `{first_name}` and `{shop_name}` are NEVER drop-triggers (they always render).
 */
export const AUTO_TEXT_OPTIONAL_TOKENS = [
  '{price_per_gram}',
  '{grams}',
  '{fixed_price}',
  '{layaway_dp}',
] as const;

/**
 * The shipped default (Owner-approved 2026-08-22). ONE body carries both pricing blocks; suppression
 * shows the right ones per mode. MUST stay byte-identical to the `auto_text` row seeded in the
 * database (migration), so Reset-to-Default and the production fallback agree.
 */
export const AUTO_TEXT_DEFAULT_BODY = [
  'Hi beshy {first_name}! 💛 Thank you for mining with A.V. Jewelry ✨',
  '',
  'Item Per Gram: ₱{price_per_gram}/g',
  'Grams: {grams}g',
  'Fixed Price: ₱{fixed_price}',
  'Total Amount: ₱{total_amount}',
  'For Layaway DP: ₱{layaway_dp}',
  '',
  'ONLY Mode of Payment:',
  'BDO - AV De Asis Jewelry 010128006991',
  'BPI - April De Asis 0659122723',
  '',
  'For questions, message us or call:',
  '0917-2035-820',
  '0919-0969-617',
  '0919-0975-063',
  '',
  'Thank you beshy for trusting & supporting A.V. Jewelry!💕😊',
].join('\n');

/* --------------------------------- money (integer centavos, never a float) --------------------------------- */

/** Decimal string → integer at `decimals` scale, HALF-UP, as BigInt. Null when not a clean number. */
function decimalToScaled(
  value: string | null | undefined,
  decimals: number,
): bigint | null {
  const s = (value ?? '').trim().replace(/[₱,\s]/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const scaleDigits = f.slice(0, decimals).padEnd(decimals, '0');
  let scaled = BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(scaleDigits || '0');
  // Half-up on the first digit BEYOND the kept scale.
  if (f.length > decimals && Number(f[decimals]) >= 5) scaled += 1n;
  return scaled;
}

/**
 * grams (≤3dp) × ₱/g rate (≤2dp) → total CENTAVOS, half-up. Pure integer math:
 *   mg (1e-3 g) × rc (1e-2 ₱/g) = 1e-5 ₱ → divide by 1000 to reach centavos (1e-2 ₱).
 * e.g. 3.08 × ₱7,300 → 3080 × 730000 = 2,248,400,000 → /1000 = 2,248,400 = ₱22,484.00.
 */
export function gramsTimesRateCentavos(grams: string, rate: string): bigint | null {
  const mg = decimalToScaled(grams, 3);
  const rc = decimalToScaled(rate, 2);
  if (mg === null || rc === null) return null;
  return (mg * rc + 500n) / 1000n;
}

/** A whole/decimal peso string → centavos, half-up. */
export function pesosToCentavos(value: string | null | undefined): bigint | null {
  return decimalToScaled(value, 2);
}

/**
 * The suggested Layaway down payment in centavos: 20% of the total, HALF-UP — but ONLY at/above the
 * ₱15,000 threshold. Below the threshold returns null, so the "For Layaway DP" line is omitted (never
 * "₱0"). Percent + rounding match the canonical `app_private.required_down_payment` rule.
 */
export function layawayDpCentavos(totalCentavos: bigint): bigint | null {
  if (totalCentavos < LAYAWAY_DP_THRESHOLD_CENTAVOS) return null;
  return (totalCentavos * BigInt(LAYAWAY_DP_PERCENT) + 50n) / 100n;
}

function centavosToPesoString(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return `${neg ? '-' : ''}${(a / 100n).toString()}.${(a % 100n).toString().padStart(2, '0')}`;
}

/** ₱-less, comma-grouped, 2dp only when non-zero (the canonical formatter, peso sign stripped). */
export function formatCentavosPlain(c: bigint): string {
  return formatPeso(centavosToPesoString(c)).replace(/^₱/, '');
}

/** ₱-less formatting of a peso string — e.g. a rate "7300" → "7,300". */
export function formatPesoPlain(pesoStr: string): string {
  return formatPeso((pesoStr ?? '').trim()).replace(/^₱/, '');
}

/* --------------------------------- values + render --------------------------------- */

/**
 * Build the token→value map for ONE finalized Capture. Returns null when the business data is
 * INCOMPLETE (grams with no rate, missing grams/price, an unparseable value) so the caller can refuse
 * to consume the one Private Reply. Values are ₱-less numeric strings (the template supplies literal ₱).
 */
export function buildAutoTextValues(input: {
  mode: AutoTextMode;
  firstName: string;
  grams?: string | null;
  pricePerGram?: string | null;
  fixedPrice?: string | null;
  shopName?: string;
}): Record<string, string> | null {
  const values: Record<string, string> = {
    '{first_name}': (input.firstName ?? '').trim(),
    '{shop_name}': (input.shopName ?? SHOP_NAME_DEFAULT).trim() || SHOP_NAME_DEFAULT,
    '{price_per_gram}': '',
    '{grams}': '',
    '{fixed_price}': '',
    '{total_amount}': '',
    '{layaway_dp}': '',
  };

  let totalCentavos: bigint | null;
  if (input.mode === 'grams') {
    const grams = normalizeGrams(input.grams);
    const rate = (input.pricePerGram ?? '').trim();
    if (!grams || !rate) return null;
    totalCentavos = gramsTimesRateCentavos(grams, rate);
    if (totalCentavos === null) return null;
    values['{price_per_gram}'] = formatPesoPlain(rate);
    values['{grams}'] = grams;
  } else {
    const fixed = parseFixedPrice(input.fixedPrice);
    if (!fixed) return null;
    totalCentavos = pesosToCentavos(fixed);
    if (totalCentavos === null) return null;
    values['{fixed_price}'] = formatPesoPlain(fixed);
  }

  values['{total_amount}'] = formatCentavosPlain(totalCentavos);
  const dp = layawayDpCentavos(totalCentavos);
  if (dp !== null) values['{layaway_dp}'] = formatCentavosPlain(dp);
  return values;
}

/**
 * Render the saved template with mode-aware line suppression. A line is DROPPED when its only dynamic
 * content is an optional token that resolved empty; otherwise tokens are substituted. An empty
 * {first_name} would leave "Hi beshy !" — the tidy pass removes a space that hugs sentence punctuation
 * (never touching newlines or intentional spacing).
 */
export function renderAutoText(body: string, values: Record<string, string>): string {
  const kept = body.split('\n').filter((line) => {
    const present = AUTO_TEXT_OPTIONAL_TOKENS.filter((t) => line.includes(t));
    if (present.length === 0) return true; // no optional token → always keep
    return present.some((t) => (values[t] ?? '').trim() !== ''); // keep only if one has a value
  });
  return kept
    .map((line) =>
      line
        .replace(/\{[a-z_]+\}/g, (t) => values[t] ?? '')
        .replace(/ +([!,.?])/g, '$1')
        .replace(/[ \t]+$/, ''),
    )
    .join('\n');
}

/** Sample values for the Settings Live Preview — the SAME engine, so preview == real output. */
export function autoTextSampleValues(mode: AutoTextMode): Record<string, string> {
  const v =
    mode === 'grams'
      ? buildAutoTextValues({
          mode: 'grams',
          firstName: 'Ruby',
          grams: '3.08',
          pricePerGram: '7300',
        })
      : buildAutoTextValues({ mode: 'fixed', firstName: 'Ruby', fixedPrice: '15000' });
  return v ?? {};
}
