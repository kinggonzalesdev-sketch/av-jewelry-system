import 'server-only';

import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/session';

/**
 * Authorization boundary (ADR §7, §8) — AUTHENTICATION ONLY IN PHASE 0.
 *
 * The layered model these helpers will eventually serve:
 *
 *   1. RLS at the data layer            — last line of defense
 *   2. Server action / API boundary     — exact permission per action, at execution time
 *   3. Owner-only gate                  — the six non-delegable approvals
 *   4. Shop/page scope                  — applicable-scope restriction
 *   5. UI                               — convenience only, NEVER the security control
 *
 * Standing rules that any future addition here must respect:
 *   - UI visibility is not authorization; assignment is not permission;
 *     role title is not authority (Bible §5, §11, §30.3 r2).
 *   - No sensitive write may rely solely on client-side checks (Bible §33 r3–4).
 *   - Permission, scope, record state, and Owner approval are revalidated at
 *     EXECUTION time, not just at render time (Bible §29.8).
 *
 * ⚠️  Phase 0 implements the AUTHENTICATION boundary only. Roles, granular
 *     permissions, shop/page scope, and Owner-approval gates are Roadmap Phase 2
 *     and are deliberately absent — no placeholder permission check is provided
 *     here, because a permissive stub is worse than no stub: it would read as a
 *     real gate while authorizing everything.
 */

/**
 * Requires an authenticated session, redirecting to sign-in when absent.
 * Returns the user so callers can avoid a second lookup.
 *
 * This proves only WHO the caller is — never WHAT they may do.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/sign-in');
  }

  return user;
}
