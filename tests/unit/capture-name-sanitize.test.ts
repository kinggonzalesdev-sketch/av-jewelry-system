import { describe, expect, it } from 'vitest';

import { sanitizeCaptureName, sanitizeLeadingNameGlyph } from '@/lib/capture/name-sanitize';

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

/**
 * Owner 2026-08-28 — a Facebook avatar/icon left a DETACHED "Y" fused onto the pinned name during OCR
 * ("Y Katy Seacombe"), while the SAME capture also read the clean "Katy Seacombe" (Katy commented
 * twice). Strip the detached letter ONLY on that clean-twin evidence — never a blind "starts-with-Y".
 * Real record from prod: capture cap-1787911697710, rawLines carry both "Katy Seacombe" and
 * "Y Katy Seacombe".
 */
describe('sanitizeCaptureName — detached leading letter (twin-evidence)', () => {
  const KATY_RAWLINES = [
    'Pola Lhyn',
    'Earrings po loop',
    'Katy Seacombe',
    '13.91 mine',
    'Y Katy Seacombe',
    '13.91 mine',
    '3 Send 200 Stars to pin your comment here.',
  ];

  it('THE BUG: strips the detached Y when the clean twin co-occurs', () => {
    expect(sanitizeCaptureName('Y Katy Seacombe', KATY_RAWLINES)).toBe('Katy Seacombe');
  });

  it('leaves the detached-letter name UNTOUCHED when there is NO clean twin (no evidence)', () => {
    expect(sanitizeCaptureName('Y Katy Seacombe', ['Pola Lhyn', 'Earrings po loop'])).toBe(
      'Y Katy Seacombe',
    );
    expect(sanitizeCaptureName('Y Katy Seacombe', undefined)).toBe('Y Katy Seacombe');
    expect(sanitizeCaptureName('Y Katy Seacombe', [])).toBe('Y Katy Seacombe');
  });

  it('PRESERVES real Y-names (one token, no space → never matches)', () => {
    // Even with a coincidental twin present, a space-less Y-name is never touched.
    for (const n of ['Yvonne Santos', 'Yolanda Cruz', 'Ysabel Reyes', 'Yeng Constantino']) {
      expect(sanitizeCaptureName(n, [n, 'vonne', 'olanda'])).toBe(n);
    }
  });

  it('PRESERVES a clean name with no leading single-letter', () => {
    expect(sanitizeCaptureName('Katy Seacombe', KATY_RAWLINES)).toBe('Katy Seacombe');
    expect(sanitizeCaptureName('Maria Kristina Delos Santos', [])).toBe(
      'Maria Kristina Delos Santos',
    );
  });

  it('PRESERVES a genuine leading initial when no clean twin proves contamination', () => {
    expect(sanitizeCaptureName('J Smith', ['J Smith', 'Mine 1.5'])).toBe('J Smith');
    expect(sanitizeCaptureName('O King Gonzales', ['O King Gonzales'])).toBe('O King Gonzales');
  });

  it('NEVER strips when the remainder is a number/claim (not a real name)', () => {
    expect(sanitizeCaptureName('Y 13.91', ['13.91', '13.91 mine'])).toBe('Y 13.91');
  });

  it('requires an EXACT twin (a different read does not trigger a strip)', () => {
    expect(sanitizeCaptureName('Y Katy Seacombe', ['Katy Seacomb', 'Katy'])).toBe(
      'Y Katy Seacombe',
    );
  });

  it('still applies the phantom O/0/° strip (delegates to sanitizeLeadingNameGlyph)', () => {
    expect(sanitizeCaptureName('ORoshelle Akitan Gavino')).toBe('Roshelle Akitan Gavino');
    // O/0/° strip first, then no detached-letter left → clean.
    expect(sanitizeCaptureName('0Roshelle Akitan Gavino', [])).toBe('Roshelle Akitan Gavino');
  });

  it('handles null / empty', () => {
    expect(sanitizeCaptureName(null)).toBe('');
    expect(sanitizeCaptureName(undefined, [])).toBe('');
  });
});
