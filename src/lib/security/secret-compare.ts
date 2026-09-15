import 'server-only';

import { timingSafeEqual } from 'node:crypto';

/**
 * Constant-time secret comparison for the shared-secret endpoints (cron routes, the Pancake
 * webhook). A plain `===` / `Array.includes` short-circuits on the first differing byte, which
 * leaks how much of the secret matched through response timing.
 *
 * `timingSafeEqual` requires equal lengths, so a length mismatch still runs one full-length
 * comparison (against itself) before returning false — the work done never depends on where the
 * inputs differ. Only the LENGTH of the expected secret can be inferred, which is not secret for a
 * fixed-format random token. No hashing is involved (none is needed to compare two strings).
 */
export function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** True when `provided` equals ANY of the accepted secrets (current + next during rotation). */
export function secretMatchesAny(provided: string, accepted: readonly string[]): boolean {
  // Evaluate every candidate so the timing does not reveal WHICH one matched.
  let ok = false;
  for (const candidate of accepted) {
    if (secretMatches(provided, candidate)) ok = true;
  }
  return ok;
}
