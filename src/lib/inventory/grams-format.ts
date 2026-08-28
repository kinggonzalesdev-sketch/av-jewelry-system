/**
 * Grams display for the Inventory Total Grams cards (Owner 2026-08-28).
 *
 * Pure + deterministic (no I/O) so it can be unit-tested for the Owner's exact format:
 * thousands-separated, ALWAYS 2 decimals, a "g" suffix — e.g. 3,842.56 g. The zero state
 * is "0.00 g" (a real total of zero), while a null/unknown total (a read error) shows "—"
 * so a failure never masquerades as 0.00 g.
 */
const GRAMS_FORMAT = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatGrams(grams: number | null | undefined): string {
  if (grams === null || grams === undefined || Number.isNaN(grams)) return '—';
  return `${GRAMS_FORMAT.format(grams)} g`;
}
