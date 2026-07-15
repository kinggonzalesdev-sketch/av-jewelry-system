'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signIn, type SignInState } from '@/lib/auth/actions';

const initialState: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

/**
 * Staff email + password sign-in form (ADR §4).
 *
 * Credentials are submitted to a server action; no authentication decision is made
 * in the browser. There is no "create account" or "sign up" link, by design.
 */
export function SignInForm() {
  const [state, formAction] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-describedby={state.error ? 'sign-in-error' : undefined}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={state.error ? 'sign-in-error' : undefined}
        />
      </div>

      {state.error ? (
        <p
          id="sign-in-error"
          role="alert"
          className="text-sm text-[--color-destructive]"
          data-testid="sign-in-error"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
