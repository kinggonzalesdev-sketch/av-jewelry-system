'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  endLiveSessionAction,
  startLiveSessionAction,
} from '@/lib/live/live-ops-actions';
import type {
  LiveMode,
  LiveSessionFormData,
} from '@/lib/live/live-session-types';
import { Button } from '@/components/ui/button';

/**
 * Start / End Live Session (Super Admin). One active session at a time; its id is
 * stamped on everything created while it runs. A Test session also turns Test Mode
 * on. Screenshot/printer device selection joins here when the device registry lands.
 */
export function LiveSessionControls({ data }: { data: LiveSessionFormData }) {
  const router = useRouter();
  const active = data.active;
  const [name, setName] = useState('');
  const [operator, setOperator] = useState(data.operators[0]?.id ?? '');
  const [mode, setMode] = useState<LiveMode>('review');
  const [isTest, setIsTest] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await startLiveSessionAction({
        name,
        operatorStaffId: operator || null,
        mode,
        isTest,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const end = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await endLiveSessionAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  if (active) {
    return (
      <div className="space-y-2" data-testid="live-session-active">
        <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm">
          <p className="font-semibold">Live session running: {active.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active.mode === 'automatic' ? 'Automatic Mode' : 'Review Mode'} ·{' '}
            {active.isTest ? 'TEST' : 'Production'}
            {active.operatorName ? ` · operator ${active.operatorName}` : ''}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void end()}
          disabled={pending}
          data-testid="end-live-session"
        >
          {pending ? 'Ending…' : 'End Live Session'}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';
  const field = 'h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold';

  return (
    <div className="space-y-3" data-testid="live-session-start">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Session Name</span>
          <input
            className={field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Friday Night Live"
            data-testid="live-session-name"
          />
        </label>
        <label className="block">
          <span className={label}>Live Operator</span>
          <select
            className={field}
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            data-testid="live-session-operator"
          >
            {data.operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <span className={label}>Mode</span>
          <div className="inline-flex gap-1 rounded-md border border-border p-0.5">
            {(['review', 'automatic'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                  mode === m ? 'bg-gold text-black' : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid={`live-session-mode-${m}`}
              >
                {m === 'review' ? 'Review' : 'Automatic'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={label}>Session Type</span>
          <div className="inline-flex gap-1 rounded-md border border-border p-0.5">
            {([true, false] as const).map((t) => (
              <button
                key={String(t)}
                type="button"
                onClick={() => setIsTest(t)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                  isTest === t ? 'bg-gold text-black' : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid={`live-session-type-${t ? 'test' : 'production'}`}
              >
                {t ? 'Test' : 'Production'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Facebook Page: {data.facebookPageName ?? data.facebookPageId ?? 'none selected'}.
        A <strong>Test</strong> session turns Test Mode on (no real inventory or
        customer messages). Screenshot/printer device selection joins here with the
        device registry.
      </p>

      <Button
        type="button"
        onClick={() => void start()}
        disabled={pending || !name.trim()}
        data-testid="start-live-session"
      >
        {pending ? 'Starting…' : 'Start Live Session'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
