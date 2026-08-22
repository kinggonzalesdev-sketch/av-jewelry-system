import { beforeAll, describe, expect, it } from 'vitest';

import {
  buildPrivateReplyMessage,
  decryptShareToken,
  encryptShareToken,
  firstNameOf,
  hashShareToken,
  newShareToken,
  shareLinkUrl,
} from '@/lib/capture/share-link';

// A deterministic 32-byte test key so encrypt/decrypt round-trips (encKey reads env at call time).
beforeAll(() => {
  process.env.CAPTURE_LINK_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
});

describe('secure share-link token', () => {
  it('hash is deterministic 64-hex (irreversible public lookup key)', () => {
    expect(hashShareToken('abc')).toBe(hashShareToken('abc'));
    expect(hashShareToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ciphertext hides the raw token and decrypts back (same-URL recovery)', () => {
    const t = 'my-opaque-token';
    const ct = encryptShareToken(t)!;
    expect(ct).not.toContain(t);
    expect(decryptShareToken(ct)).toBe(t);
  });

  it('newShareToken: opaque base64url, no internal/sequential id, hash+ciphertext consistent', () => {
    const { raw, hash, ciphertext } = newShareToken();
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // opaque, url-safe
    expect(raw.length).toBeGreaterThanOrEqual(43); // 32 random bytes
    expect(raw).not.toMatch(/\d{6,}/); // not a bare sequential/internal id
    expect(hash).toBe(hashShareToken(raw));
    expect(decryptShareToken(ciphertext)).toBe(raw);
  });

  it('two tokens are different', () => {
    expect(newShareToken().raw).not.toBe(newShareToken().raw);
  });

  it('shareLinkUrl is https /m/{token}', () => {
    expect(shareLinkUrl('TOK')).toMatch(/^https:\/\/.+\/m\/TOK$/);
  });

  it('no key configured → encrypt fails safe (null), so Route B → Needs Review not a broken link', () => {
    const prev = process.env.CAPTURE_LINK_ENC_KEY;
    delete process.env.CAPTURE_LINK_ENC_KEY;
    expect(encryptShareToken('x')).toBeNull();
    expect(newShareToken().ciphertext).toBeNull();
    process.env.CAPTURE_LINK_ENC_KEY = prev;
  });
});

describe('first name + Private Reply template', () => {
  it('first display-name token, safe fallback to empty', () => {
    expect(firstNameOf('King Gonzales')).toBe('King');
    expect(firstNameOf('  Maria  Cruz ')).toBe('Maria');
    expect(firstNameOf('')).toBe('');
    expect(firstNameOf('123')).toBe('');
    expect(firstNameOf(null)).toBe('');
  });

  it('exact Owner template (2026-08-22): blank line before the 🔗 URL, "about your order"', () => {
    const msg = buildPrivateReplyMessage('King', 'https://x/m/TOK');
    // Full-string equality locks the EXACT template the Owner approved.
    expect(msg).toBe(
      'Hi beshy King! 💛 Thank you for mining with A.V. Jewelry ✨\n\n' +
        "Here's the screenshot of your mined item:\n\n🔗 https://x/m/TOK\n\n" +
        'Please reply here if you have any questions or concerns about your order.\n\n' +
        'Thank you, beshy!',
    );
    // The URL sits on its own line with a blank line above it (never glued to the label).
    expect(msg).toContain('mined item:\n\n🔗 https://x/m/TOK');
  });

  it('falls back to "Hi beshy!" without a first name', () => {
    expect(buildPrivateReplyMessage('', 'u')).toContain('Hi beshy! 💛');
  });
});
