/**
 * Session-only auth cookies (Owner request 2026-07-28 — "always through sign-in",
 * stronger re-login). Stripping `maxAge`/`expires` turns a persistent auth cookie
 * into a SESSION cookie, so the browser drops it when it closes and staff must sign
 * in again on a new browser session. Combined with the idle-timeout logout, an
 * unattended or closed browser never keeps a live session. Applied wherever the
 * Supabase SSR client writes cookies (server client + middleware refresh).
 */
export function toSessionCookie<T extends object>(options: T | undefined): T {
  const next: Record<string, unknown> = { ...(options ?? {}) };
  delete next.maxAge;
  delete next.expires;
  return next as T;
}
