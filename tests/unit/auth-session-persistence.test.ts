import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isTransientAuthError } from '@/lib/supabase/auth-error';
import { toPersistentCookie } from '@/lib/supabase/cookies';

/**
 * Persistent trusted-device session (Owner 2026-09-07).
 *
 * Staff stay signed in on a trusted device until they explicitly Logout. Two behaviours make that
 * safe rather than a permanent-token hack:
 *   1. A TRANSIENT network / Auth-server failure must NOT be treated as a logout (retry, don't
 *      sign out). A DEFINITIVE failure (no/invalid/revoked session) still signs out.
 *   2. Auth cookies must persist across browser/PWA close + device restart, but Supabase's own
 *      value-clearing removal cookie (maxAge 0) from `signOut()` must NEVER be re-persisted.
 */

const projectRoot = join(__dirname, '..', '..');
const srcDir = join(projectRoot, 'src');

describe('isTransientAuthError — transient vs definitive (Owner 2026-09-07)', () => {
  it('treats no error as definitive (a genuine sign-out is never a network blip)', () => {
    expect(isTransientAuthError(null)).toBe(false);
    expect(isTransientAuthError(undefined)).toBe(false);
  });

  it('classifies Supabase AuthRetryableFetchError as transient by name', () => {
    expect(isTransientAuthError({ name: 'AuthRetryableFetchError' })).toBe(true);
  });

  it('classifies fetch / network / timeout error names as transient', () => {
    expect(isTransientAuthError({ name: 'FetchError' })).toBe(true);
    expect(isTransientAuthError({ name: 'NetworkError' })).toBe(true);
    expect(isTransientAuthError({ name: 'AbortError: timeout' })).toBe(true);
    // A bare TypeError name (no matching substring, no status) is treated as definitive — the
    // retry-fetch layer already absorbs genuine transport blips on the read path first.
    expect(isTransientAuthError({ name: 'TypeError', message: 'fetch failed' })).toBe(false);
  });

  it('classifies transport (0), timeout (408/425), rate-limit (429) and 5xx as transient', () => {
    for (const status of [0, 408, 425, 429, 500, 502, 503, 504]) {
      expect(isTransientAuthError({ status })).toBe(true);
    }
  });

  it('classifies a genuine missing / invalid / revoked session as DEFINITIVE', () => {
    // These must still redirect to /sign-in — never mistaken for a network blip.
    expect(isTransientAuthError({ name: 'AuthSessionMissingError' })).toBe(false);
    expect(isTransientAuthError({ name: 'AuthApiError', status: 401 })).toBe(false);
    expect(isTransientAuthError({ name: 'AuthApiError', status: 403 })).toBe(false);
    expect(isTransientAuthError({ status: 400 })).toBe(false);
  });
});

describe('toPersistentCookie — trusted-device persistence (Owner 2026-09-07)', () => {
  const FOUR_HUNDRED_DAYS = 60 * 60 * 24 * 400;

  it('adds a ~400-day maxAge floor when the write carries no lifetime', () => {
    expect(toPersistentCookie(undefined)).toEqual({ maxAge: FOUR_HUNDRED_DAYS });
    expect(toPersistentCookie({})).toEqual({ maxAge: FOUR_HUNDRED_DAYS });
  });

  it('NEVER overrides an explicit-logout removal cookie (maxAge 0 stays 0)', () => {
    // supabase.auth.signOut() writes value-clearing cookies with maxAge 0. If we floored those to
    // 400 days the user could never log out — the single most important case in this file.
    expect(toPersistentCookie({ maxAge: 0 }).maxAge).toBe(0);
  });

  it('preserves a lifetime Supabase already set (never shortens or lengthens it)', () => {
    expect(toPersistentCookie({ maxAge: 120 }).maxAge).toBe(120);
    const expires = new Date('2027-01-01T00:00:00Z');
    const withExpiry = toPersistentCookie({ expires });
    expect(withExpiry.expires).toBe(expires);
    expect((withExpiry as { maxAge?: number }).maxAge).toBeUndefined();
  });

  it('passes every other cookie option through unchanged', () => {
    const opts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
    expect(toPersistentCookie(opts)).toEqual({ ...opts, maxAge: FOUR_HUNDRED_DAYS });
  });
});

describe('no idle / arbitrary logout remains (Owner 2026-09-07)', () => {
  it('has removed the IdleLogout component entirely', () => {
    expect(existsSync(join(srcDir, 'components', 'shell', 'idle-logout.tsx'))).toBe(false);
  });

  it('does not mount any idle-timeout logout in the app shell', () => {
    const shell = readFileSync(join(srcDir, 'components', 'shell', 'app-shell.tsx'), 'utf8');
    expect(shell).not.toMatch(/IdleLogout/);
  });
});

describe('explicit Logout stays authoritative (Owner 2026-09-07, R5)', () => {
  const actions = readFileSync(join(srcDir, 'lib', 'auth', 'actions.ts'), 'utf8');

  it('clears the local sb-* auth cookies even when auth.signOut() errors', () => {
    // Sessions are persistent now, so a silently-failed signOut would strand a long-lived cookie
    // on a shared device. The local clear must NOT be inside an `if (!error)` branch.
    expect(actions).toMatch(/name\.startsWith\('sb-'\)/);
    expect(actions).toMatch(/cookieStore\.delete\(name\)/);
  });

  it('still redirects to sign-in and revalidates the layout after logout', () => {
    expect(actions).toMatch(/revalidatePath\('\/',\s*'layout'\)/);
    expect(actions).toMatch(/redirect\('\/sign-in'\)/);
  });
});

describe('transient failure retries instead of signing out (Owner 2026-09-07)', () => {
  const guard = readFileSync(join(srcDir, 'lib', 'authz', 'guard.ts'), 'utf8');
  const proxy = readFileSync(join(srcDir, 'lib', 'supabase', 'proxy.ts'), 'utf8');
  const session = readFileSync(join(srcDir, 'lib', 'auth', 'session.ts'), 'utf8');

  it('exposes an AuthState carrying the transient flag', () => {
    expect(session).toMatch(/export\s+async\s+function\s+getAuthState/);
    expect(session).toMatch(/transient:\s*isTransientAuthError\(error\)/);
  });

  it('routes a transient guard failure to /offline, a definitive one to /sign-in', () => {
    expect(guard).toMatch(/getAuthState\(\)/);
    expect(guard).toMatch(/if\s*\(\s*transient\s*\)\s*\{?\s*redirect\('\/offline'\)/);
    // The definitive path must remain — a genuine sign-out still lands on sign-in.
    expect(guard).toMatch(/redirect\('\/sign-in'\)/);
  });

  it('lets a transient failure through the session proxy instead of bouncing to sign-in', () => {
    expect(proxy).toMatch(/isTransientAuthError\(error\)/);
  });
});
