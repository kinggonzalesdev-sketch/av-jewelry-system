import 'server-only';

import { cache } from 'react';

import type { User } from '@supabase/supabase-js';

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
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
});

/**
 * Returns whether a valid authenticated session exists.
 */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
