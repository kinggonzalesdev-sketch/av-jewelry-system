import 'server-only';

import { cache } from 'react';

import type { User } from '@supabase/supabase-js';

import { isTransientAuthError } from '@/lib/supabase/auth-error';
import { createClient } from '@/lib/supabase/server';

/**
 * Authenticated-session lookup (ADR §6).
 *
 * Always uses `supabase.auth.getUser()`, which revalidates the token against the
 * Supabase Auth server. `getSession()` reads the cookie without verifying it and
 * is therefore not trustworthy for any authorization decision.
 *
 * PERFORMANCE: wrapped in React `cache()`, so the auth-server round trip happens
 * ONCE per server request no matter how many callers (guard, permissions, staff
 * profile, audit) ask for the user during a single render. It never caches across
 * requests, so the security guarantee is unchanged.
 */

/**
 * Returns the authenticated user, or `null` when there is no valid session.
 * Does not redirect — callers decide how to handle the unauthenticated case.
 */
/**
 * The authenticated user plus whether a NULL result was caused by a TRANSIENT network / Auth-
 * server failure (vs a genuine missing/invalid/revoked session). Cached per request. `transient`
 * lets the guard RETRY (via the data-free /offline page) instead of treating a temporary network
 * failure as a logout — the session cookie is never cleared here, so access self-heals once
 * connectivity returns. A definitive failure has `transient: false` and still goes to sign-in.
 */
export type AuthState = { user: User | null; transient: boolean };

const getAuthStateCached = cache(async (): Promise<AuthState> => {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (user) return { user, transient: false };
  return { user: null, transient: isTransientAuthError(error) };
});

export async function getAuthState(): Promise<AuthState> {
  return getAuthStateCached();
}

/**
 * Returns the authenticated user, or `null` when there is no valid session (or the Auth server
 * could not be reached). Does not redirect — callers decide how to handle the null case.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  return (await getAuthStateCached()).user;
});

/**
 * Returns whether a valid authenticated session exists.
 */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
