'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Generic application error boundary.
 *
 * Shows a safe, non-technical message. It deliberately does NOT render
 * `error.message`: an error string can carry connection details, query fragments,
 * or configuration values, and must not be shown to a user or leak secrets
 * (Bible §31 r12). The digest is surfaced instead so a specific report can be
 * correlated with server logs.
 *
 * A failed action is a failure. Nothing here retries automatically, and nothing
 * reports success — no auto cancel/release/return as a recovery shortcut
 * (Bible §32).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side monitoring/alerting provider is To be confirmed (ADR §15).
    // Until then, log to the console so the failure is never silent.
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm text-center" data-testid="error-boundary">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-[--color-muted-foreground]">
          The action did not complete. No changes were saved. You can try again, and if
          this keeps happening, report it with the reference below.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-xs text-[--color-muted-foreground]">
            Reference: {error.digest}
          </p>
        ) : null}
        <Button className="mt-5 w-full" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  );
}
