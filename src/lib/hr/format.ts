/**
 * Pure, client-safe HR display helpers. Duration is a time span (not money), so
 * a float is fine here — SALARY, which is money, is computed in SQL and never
 * touched as a float in TS.
 */

/** Hours between two ISO timestamps, or null if the session is still open. */
export function durationHours(timeIn: string, timeOut: string | null): number | null {
  if (!timeOut) return null;
  const ms = new Date(timeOut).getTime() - new Date(timeIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/** "8h 30m" style label for a fractional hours value. */
export function formatDuration(hours: number | null): string {
  if (hours === null) return '—';
  const whole = Math.floor(hours);
  const mins = Math.round((hours - whole) * 60);
  return mins === 0 ? `${whole}h` : `${whole}h ${mins}m`;
}

/**
 * Validate a raw hourly-rate input into a string Postgres can cast to
 * numeric(10,2), or null to clear the rate. Money stays a STRING end to end —
 * this never parses the value into a JS float. An empty input clears the rate;
 * anything that is not a non-negative amount with up to two decimals is refused.
 * The column's own `>= 0` check constraint remains the final authority.
 */
export function normalizeHourlyRate(
  raw: string | null,
): { rate: string | null } | { error: string } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { rate: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { error: 'Enter a rate like 85 or 85.50 (no negatives).' };
  }
  return { rate: trimmed };
}
