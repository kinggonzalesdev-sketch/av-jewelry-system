'use client';

import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { CheckStatus, SystemCheckItem } from '@/lib/live/system-check-types';
import { runSystemCheckAction } from '@/lib/live/live-ops-actions';
import { Button } from '@/components/ui/button';

/**
 * Verify Realtime by asking the app's OWN shared socket whether it is connected.
 * DashboardSyncProvider keeps one Realtime websocket open for the whole app (the
 * memoized client), so once it is up, realtime works. Opening a SECOND
 * postgres_changes subscription here just to test it competes with that one on the
 * same socket and often never acks (the "Warning" you saw) — so instead we read the
 * live socket state directly, nudging it to connect if needed. Realtime is a NUDGE
 * (the app still works via navigation + manual refresh), so failing to come up is a
 * non-blocking WARNING, never a critical Failed.
 */
function checkRealtime(): Promise<CheckStatus> {
  return new Promise((resolve) => {
    try {
      const rt = createClient().realtime;
      const isUp = () => {
        try {
          return rt.isConnected();
        } catch {
          return false;
        }
      };
      if (isUp()) {
        resolve('ready');
        return;
      }
      // The socket isn't open yet — open it and poll briefly for it to come up.
      try {
        rt.connect();
      } catch {
        /* connect is best-effort */
      }
      let elapsed = 0;
      const iv = setInterval(() => {
        elapsed += 400;
        if (isUp()) {
          clearInterval(iv);
          resolve('ready');
        } else if (elapsed >= 12000) {
          clearInterval(iv);
          resolve('warning');
        }
      }, 400);
    } catch {
      resolve('warning');
    }
  });
}

/** The device-local checks only the browser can observe, merged with the server's. */
async function clientChecks(): Promise<SystemCheckItem[]> {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const hasBluetooth =
    typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const realtime = await checkRealtime();
  return [
    {
      key: 'internet',
      label: 'Internet Connection',
      status: online ? 'ready' : 'failed',
      detail: online ? 'Online.' : 'This device is offline.',
    },
    {
      key: 'realtime',
      label: 'MineFlow Real-time Connection',
      status: realtime,
      detail:
        realtime === 'ready'
          ? 'Live updates connected.'
          : realtime === 'warning'
            ? 'Slow to connect — retry before going live.'
            : 'Real-time socket failed.',
    },
    {
      key: 'bluetooth',
      label: 'Bluetooth Printer',
      status: hasBluetooth ? 'ready' : 'not_configured',
      detail: hasBluetooth
        ? 'Web Bluetooth available on this device.'
        : 'This browser cannot use Web Bluetooth — pair on the capture device.',
    },
    {
      key: 'floating_app',
      label: 'Floating Screenshot App',
      status: 'not_configured',
      detail: 'Confirmed on the Android capture device, not here.',
    },
    // "Printer Paper" removed (Owner) — the paper lives in the Xprinter; no separate
    // manual confirmation step is needed in the check.
  ];
}

const STATUS_META: Record<CheckStatus, { label: string; cls: string; dot: string }> = {
  ready: { label: 'Ready', cls: 'text-green-700', dot: 'bg-green-600' },
  warning: { label: 'Warning', cls: 'text-amber-700', dot: 'bg-amber-500' },
  failed: { label: 'Failed', cls: 'text-destructive', dot: 'bg-destructive' },
  not_configured: {
    label: 'Not Configured',
    cls: 'text-muted-foreground',
    dot: 'bg-muted-foreground/60',
  },
};

export function SystemCheckPanel() {
  const [items, setItems] = useState<SystemCheckItem[] | null>(null);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const [server, client] = await Promise.all([
        runSystemCheckAction(),
        clientChecks(),
      ]);
      if (!server.ok) {
        setError(server.error);
        setItems(client);
      } else {
        setItems([...server.items, ...client]);
      }
      setRanAt(new Date().toLocaleString());
    } catch {
      setError('The system check could not complete. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  const hasFailure = Boolean(items?.some((i) => i.status === 'failed'));

  return (
    <div className="space-y-3" data-testid="system-check-panel">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void run()}
          disabled={running}
          data-testid="run-system-check"
        >
          {running ? 'Checking…' : 'Run System Check'}
        </Button>
        {ranAt ? (
          <span className="text-xs text-muted-foreground">Last run {ranAt}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Run this before every live session.
          </span>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {items ? (
        <>
          {hasFailure ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              data-testid="system-check-blocker"
            >
              A critical connection failed — do not start Automatic Mode until it is
              resolved.
            </p>
          ) : null}
          <ul className="divide-y divide-border rounded-xl border border-border">
            {items.map((it) => {
              const m = STATUS_META[it.status];
              return (
                <li
                  key={it.key}
                  className="flex items-center justify-between gap-3 px-3 py-2"
                  data-testid={`system-check-${it.key}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{it.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{it.detail}</p>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${m.cls}`}>
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${m.dot}`} />
                    {m.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
