import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Secure screenshot-link tokens (Owner 2026-08-21, Route B).
 *
 * The token is 32 random bytes (base64url) and appears ONLY in the sent /m/{token} URL. The DB
 * stores its SHA-256 hash (the public lookup key) AND an AES-256-GCM ciphertext (server-only
 * recovery, so a retry rebuilds the SAME URL instead of rotating it — hashing alone can't recover
 * the raw token). A DB dump without the env key `CAPTURE_LINK_ENC_KEY` cannot reveal a valid link;
 * clients never read the table (RLS + DEFINER RPCs). No customer/order/PSID/comment id is in the URL.
 */

const ALGO = 'aes-256-gcm';

function encKey(): Buffer | null {
  const raw = process.env.CAPTURE_LINK_ENC_KEY;
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/** SHA-256 hex of the raw token — the indexed public /m lookup key (irreversible). */
export function hashShareToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** AES-256-GCM encrypt the raw token for server-side recovery. "iv:ct:tag" (base64), or null when
 *  no key is configured (Route B then fails safe → Needs Review, never a broken link). */
export function encryptShareToken(rawToken: string): string | null {
  const key = encKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

/** Recover the raw token from its ciphertext (server-only), or null. */
export function decryptShareToken(ciphertext: string | null | undefined): string | null {
  const key = encKey();
  if (!key || !ciphertext) return null;
  try {
    const [ivB, ctB, tagB] = ciphertext.split(':');
    if (!ivB || !ctB || !tagB) return null;
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** A fresh opaque token + its hash + ciphertext. `ciphertext` is null when no key is configured. */
export function newShareToken(): { raw: string; hash: string; ciphertext: string | null } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashShareToken(raw), ciphertext: encryptShareToken(raw) };
}

/** The public HTTPS screenshot URL for a raw token. */
export function shareLinkUrl(rawToken: string): string {
  const base = (process.env.CAPTURE_LINK_BASE_URL || 'https://av-jewelry.vercel.app').replace(
    /\/+$/,
    '',
  );
  return `${base}/m/${rawToken}`;
}

/** Safe first name for the template — the first LETTER-containing display-name token, else "". */
export function firstNameOf(name: string | null | undefined): string {
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return /[A-Za-z]/.test(first) ? first : '';
}

/** The EXACT Owner-approved Private Reply TEXT template (first name optional). */
export function buildPrivateReplyMessage(firstName: string, url: string): string {
  const greeting = firstName ? `Hi beshy ${firstName}!` : 'Hi beshy!';
  return (
    `${greeting} 💛 Thank you for mining with A.V. Jewelry ✨\n\n` +
    `Here's the screenshot of your mined item:\n🔗 ${url}\n\n` +
    `Please reply here if you have any questions or concerns with your order.\n\n` +
    `Thank you, beshy!`
  );
}
