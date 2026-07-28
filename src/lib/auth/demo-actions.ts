'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { demoCredentials, isDemoLoginEnabled } from '@/lib/auth/demo.server';
import { createClient } from '@/lib/supabase/server';

/**
 * Demo sign-in server action (see `demo.server.ts` for the security model).
 *
 * The client sends only a persona KEY; this action re-checks the enable gate
 * server-side (never trust the client) and resolves the real credentials here.
 * On success it lands on the dashboard exactly like a normal sign-in.
 */

// Declared locally (not re-exported) so Next's action loader is not broken —
// same pattern as SignInState in auth/actions.ts.
export type DemoSignInState = { error: string | null };

export async function demoSignIn(
  _prevState: DemoSignInState,
  formData: FormData,
): Promise<DemoSignInState> {
  // Server-side gate. If demo login is not deliberately enabled, refuse — even
  // if a crafted request reaches this action.
  if (!isDemoLoginEnabled()) {
    return { error: 'Demo login is not enabled.' };
  }

  const personaKey = formData.get('persona');
  const creds = typeof personaKey === 'string' ? demoCredentials(personaKey) : null;
  if (!creds) {
    return { error: 'Unknown demo role.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(creds);
  if (error) {
    // Honest: the account genuinely could not sign in (not seeded, wrong
    // password env, or disabled) — say so without inventing a session.
    return {
      error:
        'Demo account unavailable. Seed the demo accounts and check DEMO_LOGIN_PASSWORD.',
    };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
