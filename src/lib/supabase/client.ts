'use client';

import { createBrowserClient } from '@supabase/ssr';

import { getClientEnv } from '@/lib/env';

/**
 * Browser-safe Supabase client (ADR §11).
 *
 * Uses only the publishable anon key. Data protection for anything this client
 * touches comes from Row Level Security at the data layer plus server-side
 * authorization checks — never from the secrecy of this key, and never from what
 * the UI chooses to render (Bible §30.3 r2: UI visibility is not authorization).
 *
 * A fresh client per call (createBrowserClient shares auth via the cookie storage
 * adapter, so realtime auth stays correct). We deliberately do NOT memoize this: a
 * memoized singleton muddied the Realtime socket's auth/connection timing.
 */
export function createClient() {
  const env = getClientEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      // The browser client rewrites the sb-* cookies on a client-side token refresh; keep them
      // HTTPS-only wherever the page itself is served over HTTPS (production), matching the
      // server-side writes (system audit 2026-09-16). Plain-http localhost keeps working.
      cookieOptions: {
        secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
      },
    },
  );
}
