'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { setTestModeAction } from '@/lib/live/live-ops-actions';
import type { TestMode } from '@/lib/live/test-mode-types';
import { Button } from '@/components/ui/button';

/**
 * Start / End Test Session (Super Admin). Reads the current state from the server
 * page and toggles it; the banner and every device update via realtime. "Reset Test
 * Data" is shown as the next increment (it needs the per-transaction test tagging).
 */
export function TestModeControls({ initial }: { initial: TestMode }) {
  const router = useRouter();
  const [active, setActive] = useState(initial.active);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (next: boolean) => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await setTestModeAction(next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setActive(res.active);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="test-mode-controls">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`flex items-center gap-1.5 text-sm font-semibold ${
            active ? 'text-amber-700' : 'text-muted-foreground'
          }`}
          data-testid="test-mode-status"
        >
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${active ? 'bg-amber-500' : 'bg-muted-foreground/50'}`}
          />
          {active ? 'Test session ACTIVE' : 'Production (test session off)'}
        </span>
        {active ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void toggle(false)}
            disabled={pending}
            data-testid="end-test-session"
          >
            {pending ? 'Ending…' : 'End Test Session'}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => void toggle(true)}
            disabled={pending}
            data-testid="start-test-session"
          >
            {pending ? 'Starting…' : 'Start Test Session'}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Reset Test Data (deleting only test-tagged records) arrives with the next
        increment — the transaction tagging it depends on.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
