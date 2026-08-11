'use client';

import type { createClient } from '@/lib/supabase/client';

type BrowserClient = ReturnType<typeof createClient>;

/**
 * Authorize a browser client's Realtime socket with the signed-in user's JWT, and keep
 * that token fresh for the life of the subscription.
 *
 * WHY THIS EXISTS
 * ---------------
 * `postgres_changes` is filtered by Row Level Security, so the Realtime websocket must
 * carry the USER'S access token — not just the publishable/anon key. Without it the
 * websocket handshake is rejected (the 401 seen on `/realtime/v1/websocket`, most
 * visibly on mobile) and no live events ever arrive, so the screen only updates on a
 * manual refresh or a navigation — exactly the "live updates don't work on my phone"
 * symptom.
 *
 * It sets the token as soon as the session is known AND re-sets it on every auth change
 * (INITIAL_SESSION / SIGNED_IN / TOKEN_REFRESHED), so a mid-session token refresh keeps
 * the socket authorized instead of silently going stale.
 *
 * Best-effort by design: an unauthorized socket only DEGRADES live updates (navigation
 * and manual refresh still show official data) — it never blocks the page — so every
 * step here swallows its own errors and callers can ignore the result.
 *
 * @returns a cleanup that detaches the auth-change listener.
 */
export function authorizeRealtime(supabase: BrowserClient): () => void {
  const apply = (token: string | null | undefined) => {
    if (!token) return;
    try {
      // `setAuth` may be sync or return a promise depending on the client version;
      // normalize so a rejected promise can never become an unhandled rejection.
      void Promise.resolve(supabase.realtime.setAuth(token)).catch(() => undefined);
    } catch {
      // best-effort — a failed setAuth just leaves live updates degraded, not broken
    }
  };

  // Set the token up front so the first (or next) socket connect is authorized.
  void supabase.auth
    .getSession()
    .then(({ data }) => apply(data.session?.access_token))
    .catch(() => undefined);

  // And keep it current across refreshes for the life of the subscription.
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    apply(session?.access_token);
  });

  return () => data.subscription.unsubscribe();
}
