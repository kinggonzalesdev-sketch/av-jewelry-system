/**
 * Tell a TRANSIENT auth failure apart from a DEFINITIVE one (Owner 2026-09-07).
 *
 * A transient failure = the Supabase Auth server was momentarily unreachable or erroring (a
 * network blip, cold start, timeout, 429, or 5xx). It is NOT a logout: the refresh-token cookie
 * is intact and will verify once connectivity returns, so the caller should RETRY (surface the
 * data-free /offline page) rather than redirect to sign-in.
 *
 * A definitive failure = there is no session, or the session is invalid/revoked/expired-beyond-
 * refresh. Supabase reports this as an AuthApiError (401/403) or AuthSessionMissingError — the
 * user is genuinely signed out and must return to /sign-in.
 *
 * The default for anything ambiguous is FALSE (definitive → /sign-in), so a genuinely
 * unauthenticated request is never mistaken for a network blip and let past the boundary.
 */
export function isTransientAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const name = (error as { name?: unknown }).name;
  const nameStr = typeof name === 'string' ? name : '';
  // AuthRetryableFetchError (network / 5xx) is Supabase's transient class.
  if (/retryable|fetch|networkerror|timeout/i.test(nameStr)) return true;

  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') {
    // 0 = fetch/transport failure; 408 timeout; 425 too-early; 429 rate-limited; 5xx server error.
    return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
  }

  return false;
}
