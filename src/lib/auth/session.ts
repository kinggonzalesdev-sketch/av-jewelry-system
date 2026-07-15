import 'server-only';

import type { User } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/server';

/**
 * Authenticated-session lookup (ADR §6).
 *
 * Always uses `supabase.auth.getUser()`, which revalidates the token against the
 * Supabase Auth server. `getSession()` reads the cookie without verifying it and
 * is therefore not trustworthy for any authorization decision.
 */

/**
 * Returns the authenticated user, or `null` when there is no valid session.
 * Does not redirect — callers decide how to handle the unauthenticated case.
 */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

/**
 * Returns whether a valid authenticated session exists.
 */
export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}
