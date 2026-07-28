'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import type { DemoPersona } from '@/lib/auth/demo';
import { demoSignIn, type DemoSignInState } from '@/lib/auth/demo-actions';

const initialState: DemoSignInState = { error: null };

function PersonaButton({ persona }: { persona: DemoPersona }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="persona"
      value={persona.key}
      variant="outline"
      className="h-auto w-full justify-between py-2.5"
      disabled={pending}
    >
      <span className="font-medium">{persona.label}</span>
      <span className="text-xs font-normal text-muted-foreground">
        {persona.description}
      </span>
    </Button>
  );
}

/**
 * One-tap demo sign-in buttons (rendered only when the Owner has enabled demo
 * login — see demo.server.ts). Each button submits only its persona KEY; the
 * server action resolves the real credentials. Signing in as a persona lands on
 * the dashboard exactly like a normal login, so a client sees the real system.
 */
export function DemoLoginButtons({ personas }: { personas: DemoPersona[] }) {
  const [state, formAction] = useActionState<DemoSignInState, FormData>(
    demoSignIn,
    initialState,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Demo login
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="grid gap-2">
        {personas.map((persona) => (
          <PersonaButton key={persona.key} persona={persona} />
        ))}
      </form>

      {state.error ? (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="demo-login-error"
        >
          {state.error}
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        For demonstration. Each button signs into a real seeded account with sample data —
        nothing is faked. Not available in a live production tenant.
      </p>
    </div>
  );
}
