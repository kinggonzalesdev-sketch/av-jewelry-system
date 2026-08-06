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
 * MEMOIZED as one instance per browser tab so the WHOLE app shares a SINGLE Realtime
 * websocket (the standard Supabase browser pattern). Without this, every caller —
 * the live-sync provider, each list, the System Check — opened its own socket, so a
 * check that spun up a fresh client had to cold-connect and frequently timed out
 * ("slow to connect" Warning). Reusing the already-open socket makes it connect
 * instantly. The cookie storage adapter is read per request, so auth stays correct
 * across login/logout.
 */
function makeClient() {
  const env = getClientEnv();
  return createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

// Inferred from the concrete factory call so the fully-typed client (and its typed
// Realtime `.subscribe` callbacks) is preserved — not widened to `any`.
let cachedClient: ReturnType<typeof makeClient> | null = null;

export function createClient() {
  return (cachedClient ??= makeClient());
}
