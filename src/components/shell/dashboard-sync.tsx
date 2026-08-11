'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';

/**
 * Real-time reflection across the whole system (Owner request).
 *
 * ONE source of truth: the server. Every metric on the Dashboard Profile (and
 * every list, sidebar count, and financial summary) is rendered by a Server
 * Component from official database records. This provider never keeps a duplicate
 * total in the browser and never increments a count in client state — it only asks
 * the server to re-render with `router.refresh()`, which re-runs those queries and
 * swaps the result in place WITHOUT a full reload, preserving the current page,
 * filters, search, and scroll position.
 *
 * What triggers a refresh:
 *   - A Postgres change on ANY table in `public` (same device OR another device /
 *     account / the Capture Mine app), delivered by Supabase Realtime and filtered
 *     by RLS so a user is only nudged by rows they may already read.
 *   - Reconnection / reconciliation: on (re)subscribe, on browser `online`, and
 *     when the tab becomes visible again — so a missed Realtime event self-heals.
 *
 * Safety:
 *   - Realtime is a NUDGE, never the source of truth. If the socket never connects
 *     (or RLS filters everything), the app still works: navigation and the manual
 *     Refresh button re-fetch the same official values.
 *   - Refreshes are DEBOUNCED so a burst of writes collapses into one re-render,
 *     and are skipped while the tab is hidden to avoid background churn.
 *   - Mounted ONCE (in the app shell), so there is never a duplicate subscription.
 */

type DashboardSyncValue = {
  /** epoch ms of the last completed refresh, or null before the first one. */
  lastSyncedAt: number | null;
  /** true while a server re-render is in flight. */
  isSyncing: boolean;
  /** Force an immediate reconciliation from the official server records. */
  refresh: () => void;
};

const DashboardSyncContext = createContext<DashboardSyncValue>({
  lastSyncedAt: null,
  isSyncing: false,
  refresh: () => undefined,
});

/** Read the live-sync status (safe to call without the provider — returns idle). */
export function useDashboardSync(): DashboardSyncValue {
  return useContext(DashboardSyncContext);
}

// A realtime nudge triggers router.refresh() — a full server re-render (the heaviest
// per-event Vercel CPU op). The debounce collapses a burst of DB writes into ONE
// re-render; 1000ms (was 500) collapses bursts roughly twice as hard during a live
// (many writes/sec), meaningfully cutting redundant SSR re-renders, while still
// reflecting a change within ~1s. Realtime is unchanged — only the burst-coalescing.
const DEBOUNCE_MS = 1000;

export function DashboardSyncProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Timestamp the moment a refresh actually completes (pending true → false).
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending) setLastSyncedAt(Date.now());
    wasPending.current = isPending;
  }, [isPending]);

  const doRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // Trailing debounce so a burst of DB writes collapses into a single re-render.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      doRefresh();
    }, DEBOUNCE_MS);
  }, [doRefresh]);

  // Manual refresh (Dashboard button): immediate, no debounce.
  const refresh = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    doRefresh();
  }, [doRefresh]);

  // ---- Realtime subscription + reconnection reconciliation ------------------
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      // Missing browser env — degrade gracefully to navigation/manual refresh.
      return;
    }

    const channel = supabase
      .channel('mineflow-live-sync')
      // No `table` filter → every table in `public`. RLS still decides which
      // changes this user is told about.
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        scheduleRefresh();
      })
      .subscribe((status) => {
        // Fires on first connect AND on every reconnect — reconcile each time so a
        // gap in the socket cannot leave the screen stale. Compared as a string to
        // stay decoupled from the realtime enum's exact typing.
        if (String(status) === 'SUBSCRIBED') scheduleRefresh();
      });

    const onOnline = () => scheduleRefresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [scheduleRefresh]);

  return (
    <DashboardSyncContext.Provider
      value={{ lastSyncedAt, isSyncing: isPending, refresh }}
    >
      {children}
    </DashboardSyncContext.Provider>
  );
}
