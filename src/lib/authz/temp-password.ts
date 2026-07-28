/**
 * Generate a strong temporary password for a new/reset team account.
 *
 * Auto-generation (Owner-chosen) avoids weak/reused passwords. It uses the
 * crypto RNG, guarantees each character class (lower/upper/digit/symbol) so it
 * passes any reasonable policy, and avoids ambiguous glyphs (O/0, l/1, I) so the
 * Owner can read it aloud to the member. Pure — safe to unit-test.
 */
const LOWER = 'abcdefghijkmnpqrstuvwxyz'; // no l
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, O
const DIGIT = '23456789'; // no 0, 1
const SYMBOL = '!@#$%*?';
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

function randomInt(maxExclusive: number): number {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] ?? 0) % maxExclusive;
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)] ?? chars[0] ?? '';
}

export function generateTempPassword(length = 12): string {
  const len = Math.max(10, length);
  // One of each required class, then fill, then shuffle so the classes are not
  // always in the same positions.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < len) chars.push(pick(ALL));

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
