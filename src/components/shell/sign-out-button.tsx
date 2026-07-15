'use client';

import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { signOut } from '@/lib/auth/actions';

/**
 * Sign-out control. Invokes the server action, which clears the session
 * server-side and redirects — the session is not merely forgotten client-side.
 */
export function SignOutButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          await signOut();
        });
      }}
    >
      {isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
