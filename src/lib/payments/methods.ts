/**
 * Mode of Payment — the ONE shared source of truth (Owner request 2026-07-31).
 *
 * Every "Mode of Payment" dropdown across the whole system offers exactly these
 * choices, with this exact capitalization. New records store the canonical value
 * verbatim; historical records that still hold the legacy machine keys
 * (bank_transfer / e_wallet / cash / card / other) remain valid and readable —
 * the database CHECK constraint accepts BOTH sets so no past transaction breaks.
 */
export const PAYMENT_METHODS = ['Cash', 'GCash', 'BPI', 'BDO', 'BDO NEW', 'Credit Card'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** {value,label} pairs for a <select>. Value === label (the canonical string). */
export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> =
  PAYMENT_METHODS.map((m) => ({ value: m, label: m }));

/** The default choice for a fresh form. */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'Cash';

/** Legacy machine keys retained only so historical records still validate. */
export const LEGACY_PAYMENT_METHODS = [
  'bank_transfer',
  'e_wallet',
  'cash',
  'card',
  'other',
] as const;

/** Everything the data layer accepts: canonical (new) + legacy (historical). */
export const ACCEPTED_PAYMENT_METHODS = [
  ...PAYMENT_METHODS,
  ...LEGACY_PAYMENT_METHODS,
] as const;

/** True for Cash in either the canonical ("Cash") or legacy ("cash") form. */
export function isCashMethod(method: string | null | undefined): boolean {
  return (method ?? '').trim().toLowerCase() === 'cash';
}
