'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { resetTestDataAction, setTestModeAction } from '@/lib/live/live-ops-actions';
import type { TestMode } from '@/lib/live/test-mode-types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Start / End Test Session + Reset Test Data (Super Admin). The banner and every
 * device update via realtime. Reset permanently deletes only TEST-tagged records
 * (never production) — it is gated behind a type-DELETE confirmation.
 */
export function TestModeControls({ initial }: { initial: TestMode }) {
  const router = useRouter();
  const [active, setActive] = useState(initial.active);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

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

  const runReset = async () => {
    if (resetting || confirm !== 'DELETE') return;
    setResetting(true);
    setError(null);
    try {
      const res = await resetTestDataAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const c = res.counts;
      const total =
        (c.orders ?? 0) +
        (c.payments ?? 0) +
        (c.messages ?? 0) +
        (c.labels ?? 0) +
        (c.captures ?? 0) +
        (c.reminders ?? 0);
      setResetMsg(
        total === 0
          ? 'No test records to delete.'
          : `Deleted ${c.orders ?? 0} order(s), ${c.payments ?? 0} payment(s), ${c.messages ?? 0} message(s), ${c.labels ?? 0} label(s), ${c.captures ?? 0} capture(s), ${c.reminders ?? 0} reminder(s).`,
      );
      setResetOpen(false);
      setConfirm('');
      router.refresh();
    } finally {
      setResetting(false);
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setConfirm('');
            setError(null);
            setResetOpen(true);
          }}
          data-testid="reset-test-data"
          className="text-destructive"
        >
          Reset Test Data
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Reset permanently deletes only records created while Test Mode was on — never
        production data. (Inventory a test order committed is released in the next
        increment.)
      </p>

      {resetMsg ? (
        <p
          role="status"
          className="text-xs font-medium text-green-700"
          data-testid="reset-result"
        >
          {resetMsg}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset all test data?"
        description="This permanently deletes every TEST-tagged record."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void runReset()}
              disabled={resetting || confirm !== 'DELETE'}
              data-testid="reset-test-confirm"
            >
              {resetting ? 'Deleting…' : 'Delete test data'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm">
            Production records (orders, payments, invoices not created in a test session)
            are <strong>not</strong> touched. Type{' '}
            <span className="font-mono font-semibold">DELETE</span> to confirm.
          </p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            placeholder="DELETE"
            data-testid="reset-test-confirm-input"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
          />
        </div>
      </Modal>
    </div>
  );
}
