/**
 * Client-safe payment helpers (Bible §16, §17).
 *
 * NO 'server-only' HERE, deliberately: these are pure functions and constants
 * the approved Payments & Layaway screen needs, and a client component cannot
 * import a server-only module. Everything that touches the database stays in
 * workspace.ts / balances.ts, which remain server-only.
 *
 * Nothing here computes financial truth. Formatting a peso is not deciding one.
 */

export type DateRangeKey = 'today' | '7d' | '14d' | '30d' | 'month' | 'custom';

/** The six approved date filters (frozen UI). */
export const RANGE_LABEL: Record<DateRangeKey, string> = {
  today: 'Today',
  '7d': '7 Days',
  '14d': '14 Days',
  '30d': '30 Days',
  month: 'This Month',
  custom: 'Custom Date Range',
};

/**
 * Coerces a database value to a money string.
 *
 * Never `String(unknown)`: that would render an unexpected object as
 * "[object Object]" inside a PESO FIELD, which is worse than failing. Postgres
 * numeric arrives as a string; a number is accepted but converted without
 * arithmetic. Anything else becomes a zero rather than displayed junk.
 */
export function moneyString(value: unknown, fallback = '0.00'): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  return fallback;
}

/**
 * Formats a peso string for display — the ONE centralized money formatter for the
 * whole system (orders, payments, layaway, payroll, inventory, reports, invoices…).
 *
 * Rules (Owner request 2026-07-25):
 *   - Peso sign `₱` and comma thousands separators (₱1,000 · ₱1,000,000).
 *   - Two decimals ONLY when needed: a whole amount shows none (₱1,000), a
 *     fractional amount shows exactly two (₱1,250.50).
 *
 * Groups thousands by string manipulation only — never through a float, because a
 * peso that round-trips through one can arrive a centavo short. Display-only: it
 * changes no stored value and no calculation.
 */
export function formatPeso(amount: string): string {
  const [whole = '0', fractionRaw = ''] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = fractionRaw.padEnd(2, '0').slice(0, 2);
  return fraction === '00' ? `₱${grouped}` : `₱${grouped}.${fraction}`;
}
