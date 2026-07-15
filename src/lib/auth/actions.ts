'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { signInSchema } from '@/lib/validation/auth';

/**
 * Authentication server actions (ADR §4).
 *
 * Staff email + password only. There is deliberately NO sign-up action here:
 * public self-registration does not exist, and there is no customer login.
 * Staff accounts are created through an authorized internal administration
 * process (Bible §5.3, §30.5), which is NOT implemented in Phase 0.
 */

export type SignInState = {
  error: string | null;
};

export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  // Credential errors stay deliberately generic: distinguishing "no such account"
  // from "wrong password" would let an unauthenticated caller enumerate valid
  // staff accounts.
  if (!parsed.success) {
    return { error: 'Enter a valid email address and password.' };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: 'Invalid credentials, or this account cannot sign in.' };
  }

  // MFA note (ADR §5): where a user has a verified TOTP factor, Supabase reports an
  // Authenticator Assurance Level of aal1 with a target of aal2 after this step, and
  // the session must be elevated by verifying a TOTP challenge before it is fully
  // trusted. That elevation step is NOT implemented in Phase 0 — see
  // `src/lib/auth/mfa.ts`. MFA is therefore NOT enforced by this action.

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signOut(): Promise<never> {
  const supabase = await createClient();

  await supabase.auth.signOut();

  revalidatePath('/', 'layout');
  redirect('/sign-in');
}
