import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import { requireServiceRoleKey, getClientEnv } from '@/lib/env';

/**
 * PRIVILEGED SUPABASE CLIENT — SERVER-ONLY. HANDLE WITH CARE.
 * ===========================================================
 *
 * This module is the single, isolated boundary for the service-role key
 * (ADR §11, Bible §30.15). The `server-only` import above is the enforcement
 * mechanism: if any Client Component ever reaches this module, even transitively,
 * the BUILD FAILS. That is by design and must not be worked around. ESLint
 * additionally blocks importing this from `src/components/**`.
 *
 * What makes this client dangerous
 * --------------------------------
 * The service-role key BYPASSES ROW LEVEL SECURITY ENTIRELY. RLS is the last line
 * of defense (ADR §8), and this client steps around it. It therefore carries none
 * of the protection the rest of the system relies on.
 *
 * Rules for any future use (ADR §7, §8; Bible §29.3, §30.3 r1)
 * -----------------------------------------------------------
 *  1. Never import this from a Client Component or from `src/components/**`.
 *  2. Using this client does NOT authorize the action. The caller must still
 *     re-validate, at execution time and on the server: the exact permission,
 *     shop/page scope, current record state, and Owner approval where required.
 *     Bypassing RLS removes the safety net — it does not grant authority.
 *  3. Never expose its results to a user who is not permitted to see them; RLS
 *     is not filtering them for you here.
 *  4. Prefer `@/lib/supabase/server` (the user-scoped client). Reach for this only
 *     when an operation genuinely cannot be performed as the signed-in user.
 *  5. `requireServiceRoleKey()` throws when the key is absent, so ordinary startup
 *     never depends on it. Nothing in Phase 0 calls this function.
 *
 * Phase 0 status: boundary only. No caller exists yet, and none should be added
 * until a phase that genuinely requires privileged access is approved.
 */
export function createAdminClient() {
  const env = getClientEnv();
  const serviceRoleKey = requireServiceRoleKey();

  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
