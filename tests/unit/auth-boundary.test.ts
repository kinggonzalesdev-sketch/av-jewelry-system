import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APPROVED_MFA_METHOD, MFA_ENFORCEMENT_IMPLEMENTED } from '@/lib/auth/mfa';

/**
 * Structural guards for the authentication boundary (ADR §4, §5).
 *
 * These assert facts about the source tree rather than runtime behaviour, because
 * the invariants they protect are structural: "no registration route EXISTS" is a
 * property of the repository, and a runtime test could not prove absence.
 */

const projectRoot = join(__dirname, '..', '..');
const appDir = join(projectRoot, 'src', 'app');

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);

  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? collectFiles(fullPath) : [fullPath];
  });
}

describe('no public registration and no customer login (Invariants #10, ADR §4)', () => {
  const routeFiles = collectFiles(appDir);

  it('exposes no sign-up / register route', () => {
    const registrationRoutes = routeFiles.filter((file) =>
      /(sign-up|signup|register|create-account)/i.test(file),
    );

    expect(registrationRoutes).toEqual([]);
  });

  it('exposes no customer-facing login route', () => {
    const customerAuthRoutes = routeFiles.filter((file) =>
      /(customer-login|customer-sign-in|customer-portal|customer-account)/i.test(file),
    );

    expect(customerAuthRoutes).toEqual([]);
  });

  it('defines no sign-up action anywhere in src/', () => {
    const sourceFiles = collectFiles(join(projectRoot, 'src')).filter((file) =>
      /\.(ts|tsx)$/.test(file),
    );

    const withSignUpCalls = sourceFiles.filter((file) => {
      const contents = readFileSync(file, 'utf8');
      // Supabase's registration primitives must not be called anywhere.
      return /auth\s*\.\s*signUp\s*\(/.test(contents);
    });

    expect(withSignUpCalls).toEqual([]);
  });

  it('keeps self-registration disabled in the Supabase local config', () => {
    const config = readFileSync(join(projectRoot, 'supabase', 'config.toml'), 'utf8');

    expect(config).toMatch(/enable_signup\s*=\s*false/);
    expect(config).toMatch(/enable_anonymous_sign_ins\s*=\s*false/);
  });

  it('offers no registration link on the sign-in page', () => {
    const signInPage = readFileSync(
      join(appDir, '(auth)', 'sign-in', 'page.tsx'),
      'utf8',
    );

    expect(signInPage).not.toMatch(/sign\s*up|create an account|register/i);
  });
});

describe('protected route boundary (ADR §7, Invariant #3)', () => {
  it('requires a verified user in the protected layout', () => {
    const layout = readFileSync(join(appDir, '(app)', 'layout.tsx'), 'utf8');

    // The protected group must gate on the server, not merely rely on middleware.
    expect(layout).toMatch(/requireUser\s*\(\s*\)/);
  });

  it('redirects to sign-in when no user is present', () => {
    const guard = readFileSync(
      join(projectRoot, 'src', 'lib', 'authz', 'guard.ts'),
      'utf8',
    );

    expect(guard).toMatch(/redirect\('\/sign-in'\)/);
  });

  it('verifies sessions with getUser, never with the unverified getSession', () => {
    // getSession() trusts the cookie without contacting the auth server and must
    // never back an authorization decision.
    const session = readFileSync(
      join(projectRoot, 'src', 'lib', 'auth', 'session.ts'),
      'utf8',
    );
    const middleware = readFileSync(
      join(projectRoot, 'src', 'lib', 'supabase', 'proxy.ts'),
      'utf8',
    );

    expect(session).toMatch(/auth\.getUser\(\)/);
    expect(session).not.toMatch(/auth\.getSession\(\)/);
    expect(middleware).toMatch(/auth\.getUser\(\)/);
    expect(middleware).not.toMatch(/auth\.getSession\(\)/);
  });

  it('keeps the public route list minimal and explicit', () => {
    // Phase 2 added /account-disabled: a signed-in user whose account was
    // deactivated must be able to see they are blocked and sign out. `/` was
    // added deliberately as the PUBLIC MARKETING LANDING page — it exposes no
    // data, reads no database, and makes no authorization decision; and because
    // isPublicRoute matches `pathname === route`, only the EXACT root is public,
    // so every other path stays protected. Any OTHER addition here would widen
    // the unauthenticated surface and must be deliberate.
    const middleware = readFileSync(
      join(projectRoot, 'src', 'lib', 'supabase', 'proxy.ts'),
      'utf8',
    );

    expect(middleware).toMatch(
      /PUBLIC_ROUTES\s*=\s*\['\/',\s*'\/sign-in',\s*'\/account-disabled'\]/,
    );
  });
});

describe('TOTP MFA hook (ADR §5)', () => {
  it('records TOTP as the approved method', () => {
    expect(APPROVED_MFA_METHOD).toBe('totp');
  });

  it('does not claim MFA enforcement is implemented', () => {
    // Phase 0 records the method and the hook only. This assertion exists so that
    // flipping the flag without building enforcement fails the test suite.
    expect(MFA_ENFORCEMENT_IMPLEMENTED).toBe(false);
  });

  it('keeps SMS and phone MFA disabled in the Supabase local config', () => {
    const config = readFileSync(join(projectRoot, 'supabase', 'config.toml'), 'utf8');
    const phoneMfaSection = config.slice(config.indexOf('[auth.mfa.phone]'));

    expect(phoneMfaSection).toMatch(/enroll_enabled\s*=\s*false/);
    expect(phoneMfaSection).toMatch(/verify_enabled\s*=\s*false/);
  });
});
