/**
 * Persistent auth cookies (Owner 2026-09-07 — "stay logged in on a trusted device until explicit
 * Logout").
 *
 * `@supabase/ssr` writes the `sb-*` auth cookies (access + refresh token) with a long-lived
 * (~400-day) maxAge. We pass those options THROUGH so the cookies survive browser/PWA close and
 * device restart — the user is not signed out just because they closed the app. This keeps
 * Supabase's model intact: the short-lived ACCESS token still expires and is SILENTLY refreshed
 * via the persistent REFRESH token (NO permanent access token is created), and revocation still
 * works because every request revalidates with `auth.getUser()`. Explicit Logout is unaffected:
 * `auth.signOut()` writes value-clearing removal cookies (maxAge 0) regardless of this helper.
 *
 * (Previously this STRIPPED maxAge/expires to force a session cookie + re-login on close — Owner
 * request 2026-07-28, reversed here.)
 *
 * We only add a maxAge floor when a write arrives WITHOUT one, so a cookie is never accidentally
 * session-scoped; we never shorten a lifetime Supabase already set.
 */

// 400 days — the @supabase/ssr default cookie lifetime.
const PERSISTENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;

export function toPersistentCookie<T extends object>(options: T | undefined): T {
  const next = { ...(options ?? {}) } as Record<string, unknown>;
  // Guarantee persistence: if neither a maxAge nor an expiry is present, add the default floor.
  if (next.maxAge == null && next.expires == null) {
    next.maxAge = PERSISTENT_MAX_AGE_SECONDS;
  }
  return next as T;
}
