/**
 * Turn a Supabase `signInWithPassword` failure into (a) the ONE message the person at the screen
 * should see and (b) a structured reason for the server log.
 *
 * WHY THIS EXISTS (Owner 2026-09-14). Every failure used to collapse to
 * "Invalid credentials, or this account cannot sign in." A Super Admin whose new password worked
 * on one PC was told exactly that on another device — a message that names TWO different causes
 * and proves neither, so nobody could tell whether the password was wrong, the account was blocked,
 * or Supabase had simply rate-limited a burst of attempts (which returns 429, and ALSO read as
 * "invalid credentials"). Diagnosis needed a database, and the database was not reachable.
 *
 * SECURITY BOUNDARY, unchanged: a wrong password and an unknown email produce the SAME message —
 * Supabase already folds both into `invalid_credentials`, and we never separate them, so an
 * unauthenticated caller still cannot enumerate staff accounts. Every other class is only ever
 * reported for an email the caller already typed; none reveals a password, a role, or a device.
 * Nothing here decides access — Supabase Auth, the profile guard and RLS still do.
 *
 * Pure and unit-tested. Keep it free of I/O.
 */

export type SignInFailureKind =
  /** Wrong password OR no such account — deliberately indistinguishable. */
  | 'invalid_credentials'
  /** The account exists but is administratively blocked (banned / disabled) in Supabase Auth. */
  | 'account_blocked'
  /** The account has never confirmed its email. */
  | 'email_not_confirmed'
  /** Supabase refused the ATTEMPT, not the credentials: too many tries from this client. */
  | 'rate_limited'
  /** The Auth server could not be reached or errored. Not a credential problem. */
  | 'server_unavailable'
  /** Anything Supabase can return that we did not anticipate. */
  | 'unknown';

/** The subset of a Supabase AuthError we read. Both fields are optional on the real object. */
export type SignInFailureInput = {
  code?: string | null | undefined;
  status?: number | null | undefined;
  message?: string | null | undefined;
  name?: string | null | undefined;
};

export function classifySignInFailure(error: SignInFailureInput): SignInFailureKind {
  const code = (error.code ?? '').toLowerCase();
  const status = typeof error.status === 'number' ? error.status : null;
  const name = (error.name ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();

  // Transport / server failures first: nothing about the credentials has been evaluated.
  if (/retryable|fetch|networkerror|timeout/.test(name)) return 'server_unavailable';
  if (status === 0 || status === 408 || status === 425 || (status !== null && status >= 500)) {
    return 'server_unavailable';
  }

  if (status === 429 || code.includes('rate_limit') || message.includes('rate limit')) {
    return 'rate_limited';
  }
  if (code === 'user_banned' || message.includes('banned')) return 'account_blocked';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'email_not_confirmed';
  }
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'invalid_credentials';
  }
  return 'unknown';
}

/** What the person at the screen reads. Never blames the password for a failure that was not one. */
export function signInFailureMessage(kind: SignInFailureKind): string {
  switch (kind) {
    case 'invalid_credentials':
      return 'Invalid email or password.';
    case 'account_blocked':
      return 'This account cannot sign in right now. Please contact the Owner.';
    case 'email_not_confirmed':
      return "This account's email has not been confirmed yet. Please contact the Owner.";
    case 'rate_limited':
      return 'Too many sign-in attempts. Please wait a minute and try again.';
    case 'server_unavailable':
      return 'The sign-in server could not be reached. Check your connection and try again.';
    case 'unknown':
      return 'Sign-in failed. Please try again, or contact the Owner if it keeps happening.';
  }
}

/** first character + domain — enough to correlate a report, never a full address in a log line. */
export function redactEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
