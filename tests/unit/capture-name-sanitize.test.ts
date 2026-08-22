import { describe, expect, it } from 'vitest';

import { sanitizeLeadingNameGlyph } from '@/lib/capture/name-sanitize';

/**
 * Owner 2026-08-22 — a Facebook avatar/badge/follower-icon next to the name is intermittently OCR'd
 * as O/0/° and FUSED onto the name ("ORoshelle Akitan Gavino"). Strip it — but NEVER a real O-name.
 */
describe('sanitizeLeadingNameGlyph — phantom leading O/0/° removal', () => {
  it('strips a phantom O/0/° fused before a Capitalised name', () => {
    expect(sanitizeLeadingNameGlyph('ORoshelle Akitan Gavino')).toBe('Roshelle Akitan Gavino');
    expect(sanitizeLeadingNameGlyph('0Roshelle Akitan Gavino')).toBe('Roshelle Akitan Gavino');
    expect(sanitizeLeadingNameGlyph('°Roshelle Akitan Gavino')).toBe('Roshelle Akitan Gavino');
  });

  it('PRESERVES legitimate O-names exactly (never strips a real first letter)', () => {
    for (const n of [
      'Olivia Santos',
      'Oscar Reyes',
      'Ocampo',
      'Orlando Cruz',
      "O'Brien",
      'O King Gonzales',
      'OJ Cruz',
    ]) {
      expect(sanitizeLeadingNameGlyph(n)).toBe(n);
    }
  });

  it('handles null / empty / whitespace', () => {
    expect(sanitizeLeadingNameGlyph(null)).toBe('');
    expect(sanitizeLeadingNameGlyph(undefined)).toBe('');
    expect(sanitizeLeadingNameGlyph('  Roshelle  ')).toBe('Roshelle');
  });
});
