'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * PWA runtime state for the whole app (Owner 2026-09-05): service-worker registration + the
 * "update available" lifecycle, the Android install prompt, standalone-mode detection and
 * online/offline. ONE provider so there is exactly one registration and one set of listeners.
 *
 * Update lifecycle (never traps a user on a stale build, never force-refreshes):
 *   deploy → page registers /sw.js?v=<new commit> → browser installs it as a NEW worker →
 *   it reaches `installed` while the old one still controls the page → `updateReady`
 *   → the toast offers "Update now" → applyUpdate() posts SKIP_WAITING → controllerchange →
 *   ONE reload, and only because the operator asked. The toast itself refuses while anything is
 *   registered as unsaved (see unsaved-changes.tsx).
 *
 * Registration is production-only by default (dev/test never get a worker) and injectable for
 * tests.
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export type PwaState = {
  /** navigator.onLine, kept live. */
  online: boolean;
  /** Running as an installed app (display-mode: standalone, or iOS navigator.standalone). */
  standalone: boolean;
  /** Chrome/Android fired beforeinstallprompt — a one-tap install is possible. */
  installPromptAvailable: boolean;
  /** appinstalled fired this session (or we are already standalone). */
  installed: boolean;
  /** A newer service worker is installed and waiting to take over. */
  updateReady: boolean;
  /** Public build identifier (short commit) — never a secret. */
  version: string;
  /** 'unsupported' | 'unregistered' | 'registered' */
  serviceWorker: 'unsupported' | 'unregistered' | 'registered';
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
  /** Ask the waiting worker to take over; the page reloads once it does. */
  applyUpdate: () => void;
  checkForUpdate: () => Promise<void>;
};

const defaultState: PwaState = {
  online: true,
  standalone: false,
  installPromptAvailable: false,
  installed: false,
  updateReady: false,
  version: 'local',
  serviceWorker: 'unsupported',
  promptInstall: () => Promise.resolve('unavailable'),
  applyUpdate: () => undefined,
  checkForUpdate: () => Promise.resolve(),
};

const Ctx = createContext<PwaState>(defaultState);

const STANDALONE_QUERY = '(display-mode: standalone)';

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mq =
    typeof window.matchMedia === 'function' ? window.matchMedia(STANDALONE_QUERY) : null;
  const ios =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(mq?.matches) || ios;
}

// Client-only facts are read through useSyncExternalStore: the server snapshot is the safe
// default (no hydration mismatch), there is no setState-in-effect, and each stays live through
// its own browser event.
const noopSubscribe = () => () => undefined;
function readOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
function readSwSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
function subscribeStandalone(onChange: () => void): () => void {
  const mq =
    typeof window.matchMedia === 'function' ? window.matchMedia(STANDALONE_QUERY) : null;
  mq?.addEventListener?.('change', onChange);
  return () => mq?.removeEventListener?.('change', onChange);
}

export function PwaProvider({
  children,
  version = (process.env.APP_COMMIT ?? 'local').trim() || 'local',
  registerServiceWorker = process.env.NODE_ENV === 'production',
}: {
  children: ReactNode;
  /** Public build id used to version the worker URL. */
  version?: string;
  /** Register /sw.js — production by default; tests pass true with a mocked container. */
  registerServiceWorker?: boolean;
}) {
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const standalone = useSyncExternalStore(
    subscribeStandalone,
    detectStandalone,
    () => false,
  );
  const swSupported = useSyncExternalStore(noopSubscribe, readSwSupported, () => false);
  const [installPromptAvailable, setInstallPromptAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [registered, setRegistered] = useState(false);

  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  const waiting = useRef<ServiceWorker | null>(null);
  const reloadRequested = useRef(false);
  const reloaded = useRef(false);

  // Android/Chrome install prompt: capture it, offer it from our own button, never auto-show.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
      setInstallPromptAvailable(true);
    };
    const onInstalled = () => {
      deferredPrompt.current = null;
      setInstallPromptAvailable(false);
      setInstalled(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Service worker: register (versioned URL) + watch for a newer build.
  useEffect(() => {
    if (!swSupported || !registerServiceWorker) return;
    const container = navigator.serviceWorker;
    let cancelled = false;

    const watch = (reg: ServiceWorkerRegistration) => {
      registration.current = reg;
      // A worker already waiting (e.g. the tab was open during a deploy).
      if (reg.waiting && container.controller) {
        waiting.current = reg.waiting;
        setUpdateReady(true);
      }
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          // `installed` with an existing controller = a NEW version waiting; on the very first
          // install there is no controller and nothing to announce.
          if (next.state === 'installed' && container.controller) {
            waiting.current = next;
            setUpdateReady(true);
          }
        });
      });
    };

    container
      .register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: '/' })
      .then((reg) => {
        if (cancelled) return;
        setRegistered(true);
        watch(reg);
      })
      .catch(() => {
        if (!cancelled) setRegistered(false);
      });

    // Reload exactly once, and only because applyUpdate() asked — never on first install.
    const onControllerChange = () => {
      if (reloadRequested.current && !reloaded.current) {
        reloaded.current = true;
        window.location.reload();
      }
    };
    container.addEventListener('controllerchange', onControllerChange);

    // Periodic + on-return update checks so a station left open all day still learns of a deploy.
    const check = () => registration.current?.update().catch(() => undefined);
    const interval = window.setInterval(() => void check(), 60 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      container.removeEventListener('controllerchange', onControllerChange);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [registerServiceWorker, version, swSupported]);

  const promptInstall = useCallback(async () => {
    const ev = deferredPrompt.current;
    if (!ev) return 'unavailable' as const;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    deferredPrompt.current = null;
    setInstallPromptAvailable(false);
    if (outcome === 'accepted') setInstalled(true);
    return outcome;
  }, []);

  const applyUpdate = useCallback(() => {
    const w = waiting.current;
    if (!w) return;
    reloadRequested.current = true;
    w.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  const checkForUpdate = useCallback(async () => {
    await registration.current?.update();
  }, []);

  const serviceWorker: PwaState['serviceWorker'] = !swSupported
    ? 'unsupported'
    : registered
      ? 'registered'
      : 'unregistered';

  const value = useMemo<PwaState>(
    () => ({
      online,
      standalone,
      installPromptAvailable,
      installed: installed || standalone,
      updateReady,
      version,
      serviceWorker,
      promptInstall,
      applyUpdate,
      checkForUpdate,
    }),
    [
      online,
      standalone,
      installPromptAvailable,
      installed,
      updateReady,
      version,
      serviceWorker,
      promptInstall,
      applyUpdate,
      checkForUpdate,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePwa(): PwaState {
  return useContext(Ctx);
}
