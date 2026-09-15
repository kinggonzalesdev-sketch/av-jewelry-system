'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { recordAuditEvent, recordSystemAuditEvent } from '@/lib/audit/log';
import {
  classifySignInFailure,
  redactEmail,
  signInFailureMessage,
} from '@/lib/auth/sign-in-error';
import { createClient } from '@/lib/supabase/server';
import { signInSchema } from '@/lib/validation/auth';

/**
 * Authentication server actions (ADR §4).
 *
 * Staff email + password only. There is deliberately NO sign-up action here:
 * public self-registration does not exist, and there is no customer login.
 * Staff accounts are created through an authorized internal administration
 * process (Bible §5.3, §30.5), which is NOT implemented in Phase 0.
 */

export type SignInState = {
  error: string | null;
};

// ---- Failed-sign-in audit throttle -----------------------------------------------------------
// Per-process sliding window, same pattern as the password-reset limiter. It bounds how many
// permanent audit rows an unauthenticated caller can create; it is NOT a sign-in rate limit
// (Supabase Auth still refuses bursts itself). The map is capped so it can never grow unbounded.
const AUDIT_WINDOW_MS = 15 * 60_000;
const AUDIT_MAX_PER_KEY = 5;
const AUDIT_MAX_KEYS = 5_000;
const auditHits = new Map<string, number[]>();

function auditThrottled(key: string, now = Date.now()): boolean {
  if (auditHits.size > AUDIT_MAX_KEYS) auditHits.clear();
  const hits = (auditHits.get(key) ?? []).filter((t) => now - t < AUDIT_WINDOW_MS);
  if (hits.length >= AUDIT_MAX_PER_KEY) {
    auditHits.set(key, hits);
    return true;
  }
  hits.push(now);
  auditHits.set(key, hits);
  return false;
}

export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  // Credential errors stay deliberately generic: distinguishing "no such account"
  // from "wrong password" would let an unauthenticated caller enumerate valid
  // staff accounts.
  if (!parsed.success) {
    return { error: 'Enter a valid email address and password.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Say WHICH kind of failure this was (Owner 2026-09-14). The old single message —
    // "Invalid credentials, or this account cannot sign in." — named two unrelated causes and
    // proved neither: a rate-limited burst of attempts (HTTP 429), a blocked account, and a wrong
    // password all read identically, and a Super Admin locked out on a second device could not be
    // diagnosed without database access. A wrong password and an unknown email still share ONE
    // message (Supabase folds both into invalid_credentials), so nothing here enumerates accounts.
    const kind = classifySignInFailure(error);
    // Server-side only, redacted: this is the line that makes the NEXT incident diagnosable from
    // the runtime logs alone. Never the password, never the full email.
    console.warn('[auth] sign-in rejected', {
      email: redactEmail(parsed.data.email),
      kind,
      code: error.code ?? null,
      status: error.status ?? null,
    });
    // Login attempts are audited (system audit 2026-09-16). No session exists yet, so this is a
    // SYSTEM-actor event carrying only the redacted email + the failure class — never the
    // password, never the full address. sign-in is a PUBLIC endpoint and audit_events is
    // append-only forever, so the write is bounded: attempts Supabase already refused
    // (rate-limited) or could not judge (Auth down) are console-only, and each redacted
    // email + failure kind writes at most a few rows per window.
    const key = `${redactEmail(parsed.data.email)}:${kind}`;
    if (
      kind !== 'rate_limited' &&
      kind !== 'server_unavailable' &&
      !auditThrottled(key)
    ) {
      await recordSystemAuditEvent({
        action: 'auth.sign_in_failed',
        entityType: 'auth_session',
        outcome: 'denied',
        reason: kind,
        context: { email: redactEmail(parsed.data.email), code: error.code ?? null },
      });
    }
    return { error: signInFailureMessage(kind) };
  }

  // The session cookies are set now, so this one is attributed to the signed-in user.
  await recordAuditEvent({
    action: 'auth.sign_in_succeeded',
    entityType: 'auth_session',
    context: { email: redactEmail(parsed.data.email) },
  });

  // MFA note (ADR §5): where a user has a verified TOTP factor, Supabase reports an
  // Authenticator Assurance Level of aal1 with a target of aal2 after this step, and
  // the session must be elevated by verifying a TOTP challenge before it is fully
  // trusted. That elevation step is NOT implemented in Phase 0 — see
  // `src/lib/auth/mfa.ts`. MFA is therefore NOT enforced by this action.

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();

  // Explicit Logout is AUTHORITATIVE (Owner 2026-09-07). `auth.signOut()` revokes the refresh
  // token server-side AND writes the value-clearing cookies — but it can return early WITHOUT
  // clearing them when the access token has already expired and the Auth server is unreachable
  // (auth-js `_signOut` bails on a non-"session missing" session error). Sessions are now
  // PERSISTENT, so a silently-failed logout would leave a long-lived cookie on a shared device
  // instead of a browser-session one. We therefore always clear the local `sb-*` auth cookies
  // ourselves as well, so Logout ends the session ON THIS DEVICE even when the network call
  // fails. Server-side revocation still happens whenever Auth is reachable.
  // Audited BEFORE the session is revoked, while it can still be attributed.
  await recordAuditEvent({ action: 'auth.sign_out', entityType: 'auth_session' });

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error(
      '[auth] signOut failed; clearing session cookies locally',
      error.message,
    );
  }

  const cookieStore = await cookies();
  for (const { name } of cookieStore.getAll()) {
    if (name.startsWith('sb-')) {
      cookieStore.delete(name);
    }
  }

  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
