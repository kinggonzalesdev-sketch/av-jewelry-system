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
 * Formats a peso string for display.
 *
 * Groups thousands by string manipulation only — never through a float, because
 * a peso that round-trips through one can arrive a centavo short.
 */
export function formatPeso(amount: string): string {
  const [whole = '0', fraction = '00'] = amount.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₱${grouped}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
