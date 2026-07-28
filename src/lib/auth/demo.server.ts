import 'server-only';

/**
 * Demo login — SERVER-ONLY credential resolution and enable gate.
 *
 * SECURITY / HONESTY:
 *   - Demo login is OFF unless the Owner explicitly sets `DEMO_LOGIN_ENABLED=true`
 *     AND provides `DEMO_LOGIN_PASSWORD`. Both are deliberate, server-side env
 *     decisions — never a default, never client-controlled.
 *   - The password is read here (server-only) and never reaches the browser; the
 *     buttons send only a persona KEY, and this module resolves it to credentials.
 *   - The demo accounts are the REAL seeded accounts. Nothing is faked.
 *
 * WHERE TO ENABLE: a demo/staging deployment only — NEVER the live production
 * tenant that holds real customer data. Because the point is to demo a deployed
 * build to a client, the gate is the explicit flag (not NODE_ENV), so it stays
 * usable on a hosted demo while remaining off everywhere by default.
 *
 * Enable it with, e.g. in `.env.local` or the demo deployment's env:
 *   DEMO_LOGIN_ENABLED=true
 *   DEMO_LOGIN_PASSWORD=UatPass123!
 *   # optional email overrides (defaults are the seeded UAT accounts):
 *   DEMO_OWNER_EMAIL=uat-owner@uat.local
 *   DEMO_ADMIN_EMAIL=uat-admin@uat.local
 *   DEMO_STAFF_EMAIL=uat-staff-full@uat.local
 */

function demoPassword(): string | null {
  const pw = process.env.DEMO_LOGIN_PASSWORD;
  return pw && pw.length > 0 ? pw : null;
}

/** True only when the Owner has deliberately enabled demo login AND set a password. */
export function isDemoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN_ENABLED === 'true' && demoPassword() !== null;
}

// Resolved at call time (not import time) so env overrides always take effect.
function demoEmail(personaKey: string): string | undefined {
  switch (personaKey) {
    case 'owner':
      return process.env.DEMO_OWNER_EMAIL ?? 'uat-owner@uat.local';
    case 'admin':
      return process.env.DEMO_ADMIN_EMAIL ?? 'uat-admin@uat.local';
    case 'staff':
      return process.env.DEMO_STAFF_EMAIL ?? 'uat-staff-full@uat.local';
    default:
      return undefined;
  }
}

/**
 * Resolve a persona key to real sign-in credentials, or null when demo login is
 * disabled or the key is unknown. Callers must treat null as "not permitted".
 */
export function demoCredentials(
  personaKey: string,
): { email: string; password: string } | null {
  if (!isDemoLoginEnabled()) return null;
  const email = demoEmail(personaKey);
  const password = demoPassword();
  if (!email || !password) return null;
  return { email, password };
}
