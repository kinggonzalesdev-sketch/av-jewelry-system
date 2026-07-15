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
 */
export function createClient() {
  const env = getClientEnv();

  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
