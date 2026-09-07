import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { getClientEnv } from '@/lib/env';
import { toPersistentCookie } from '@/lib/supabase/cookies';
import { createRetryingFetch } from '@/lib/supabase/retry-fetch';

/**
 * Server-side Supabase client, scoped to the caller's session (ADR §7).
 *
 * This client acts AS THE SIGNED-IN USER: it carries the user's session and is
 * therefore still subject to Row Level Security. It is the correct client for
 * essentially all application reads and writes. It is not a privileged client
 * and deliberately cannot bypass RLS — see `admin.ts` for that boundary.
 */
export async function createClient() {
  const env = getClientEnv();
  const cookieStore = await cookies();

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // Transient network blips on the read path (a dropped connection, a cold-start
      // timeout, a momentary 502/503) are retried for idempotent GET/HEAD requests so
      // a one-off hiccup self-heals instead of tripping the app-wide error boundary.
      // Writes/RPCs (POST) are never retried — see retry-fetch.ts.
      global: { fetch: createRetryingFetch() },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, toPersistentCookie(options));
            }
          } catch {
            // `setAll` throws when called from a Server Component, where cookies are
            // read-only. Session refresh is handled by middleware, so this is safe
            // to ignore here.
          }
        },
      },
    },
  );
}
