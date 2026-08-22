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

  it('GRAMS mode → Item Per Gram + Grams (exact Owner template); NO Fixed Price', () => {
    const msg = buildPrivateReplyMessage({
      firstName: 'Roshelle',
      mode: 'grams',
      grams: '3.55',
      pricePerGram: '7100',
    });
    expect(msg).toBe(
      'Hi beshy Roshelle! 💛 Thank you for mining with A.V. Jewelry ✨\n\n' +
        'Item Per Gram: ₱7,100/g\nGrams: 3.55g\n\n' +
        'Kindly settle your deposit.\n\nThank you, beshy!',
    );
    expect(msg).not.toContain('Fixed Price');
  });

  it('GRAMS small value → "Grams: 0.55g" (normalized upstream)', () => {
    const msg = buildPrivateReplyMessage({
      firstName: 'Roshelle',
      mode: 'grams',
      grams: '0.55',
      pricePerGram: '7100',
    });
    expect(msg).toContain('Grams: 0.55g');
  });

  it('FIXED mode → Fixed Price ONLY (exact Owner template); NO Item Per Gram / Grams / /g', () => {
    const msg = buildPrivateReplyMessage({
      firstName: 'Roshelle',
      mode: 'fixed',
      fixedPrice: '15000',
    });
    expect(msg).toBe(
      'Hi beshy Roshelle! 💛 Thank you for mining with A.V. Jewelry ✨\n\n' +
        'Fixed Price: ₱15,000\n\n' +
        'Kindly settle your deposit.\n\nThank you, beshy!',
    );
    expect(msg).not.toContain('Item Per Gram');
    expect(msg).not.toContain('Grams');
    expect(msg).not.toContain('/g');
  });

  it('falls back to "Hi beshy!" without a first name', () => {
    expect(
      buildPrivateReplyMessage({ firstName: '', mode: 'fixed', fixedPrice: '15000' }),
    ).toContain('Hi beshy! 💛');
  });

  // GUARD (Owner 2026-08-22 payment-link incident): the AUTO TEXT must NEVER carry ANY link — no
  // URL, no /orders, no /payments, no secure 🔗 link, no "vercel"/"http". A customer only ever
  // receives the plain mode-aware deposit message. This locks MineFlow's automatic messaging as
  // link-free so no future edit can reintroduce a payment/orders/screenshot URL.
  it('AUTO TEXT contains NO link of any kind (both modes)', () => {
    const grams = buildPrivateReplyMessage({
      firstName: 'Roshelle',
      mode: 'grams',
      grams: '3.55',
      pricePerGram: '7100',
    });
    const fixed = buildPrivateReplyMessage({
      firstName: 'Roshelle',
      mode: 'fixed',
      fixedPrice: '15000',
    });
    for (const msg of [grams, fixed]) {
      expect(msg).not.toMatch(/https?:\/\//i);
      expect(msg).not.toMatch(/\/orders|\/payments|orders\/payments/i);
      expect(msg).not.toMatch(/vercel|avjewelry\.online|l\.php|🔗/i);
    }
  });
});
