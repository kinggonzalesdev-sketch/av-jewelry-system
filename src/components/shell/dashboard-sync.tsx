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
import { authorizeRealtime } from '@/lib/supabase/realtime-auth';

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
 *   - A Postgres change on any table in `public` EXCEPT a small deny-list of high-churn
 *     infrastructure tables with no server-rendered surface (see SYNC_IGNORE_TABLES),
 *     delivered by Supabase Realtime and filtered by RLS so a user is only nudged by rows
 *     they may already read.
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

// A realtime nudge triggers router.refresh() — a full server re-render that re-runs ALL of
// the Dashboard's loaders (7 parallel reads incl. the ~157ms metrics aggregate). The
// debounce collapses a burst of DB writes into ONE re-render; 2000ms (was 1000, was 500)
// coalesces harder during a live (many writes/sec), cutting the redundant SSR re-renders
// that made the Dashboard feel laggy, while still reflecting a change within ~2s. Realtime
// itself is unchanged — only the burst-coalescing window widened.
const DEBOUNCE_MS = 2000;

/**
 * Realtime writes on these tables must NOT force a global `router.refresh()`: they are
 * high-churn infrastructure/telemetry with NO server-rendered surface that this provider
 * drives — the printer job queue and printer registry (owned by the printer poller / Web
 * Bluetooth, not SSR), the Pancake message log (the Incoming Captures strip has its own
 * channel), device heartbeats, and the internal layaway code-allocation pool. Every OTHER
 * published table still refreshes, so no data surface can silently stop updating; and a change
 * on a denied table still reflects on the next navigation or manual Refresh. This trims the
 * redundant SSR re-renders that dominate Fluid CPU during a live (Owner cost audit 2026-09-07).
 * Widen it only for a table proven to have no visible SSR surface.
 */
export const SYNC_IGNORE_TABLES: ReadonlySet<string> = new Set([
  'label_jobs',
  'printers',
  'customer_messages',
  'capture_device_heartbeats',
  'layaway_code_pool',
]);

/** Whether a Realtime change on `table` should trigger a global refresh (default: yes). */
export function shouldSyncForTable(table: string | undefined): boolean {
  return !table || !SYNC_IGNORE_TABLES.has(table);
}

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

    // Authorize the socket with the signed-in user's JWT (postgres_changes is
    // RLS-filtered, so it needs the user token, not just the anon key) and keep it
    // fresh. Without this the websocket handshake is rejected (401) and no live events
    // arrive — the app then updates only on manual refresh / navigation.
    const stopRealtimeAuth = authorizeRealtime(supabase);

    const channel = supabase
      .channel('mineflow-live-sync')
      // No `table` filter → every table in `public`; RLS still decides which changes this
      // user is told about. The callback then skips a refresh for the deny-listed
      // infrastructure tables (SYNC_IGNORE_TABLES) so their churn does not re-render the page.
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        if (shouldSyncForTable((payload as { table?: string }).table)) scheduleRefresh();
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
      stopRealtimeAuth();
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
