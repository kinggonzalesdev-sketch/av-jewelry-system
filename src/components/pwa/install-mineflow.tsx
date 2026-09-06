'use client';

import { useState, useSyncExternalStore } from 'react';

import { usePwa } from '@/components/pwa/pwa-provider';
import { Button } from '@/components/ui/button';

/**
 * "Install MineFlow" (Owner 2026-09-05) — the one reusable install control.
 *
 *   Android / Chromium: when the browser has offered `beforeinstallprompt`, one tap installs.
 *   iPhone / iPad: Safari never exposes an automatic prompt, so the honest path is shown —
 *   Share → Add to Home Screen. We never promise an automatic iOS install.
 *   Already installed / running standalone: says so and offers nothing.
 *
 * `variant="menu"` is the compact row for the mobile More sheet; `variant="settings"` is the
 * full card. A dismissal is remembered in localStorage (a timestamp only — no business data) so
 * the menu row stops nagging for 14 days; Settings always offers it.
 */
const DISMISS_KEY = 'mineflow.installDismissedAt';
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;
const noopSubscribe = () => () => undefined;

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh but has touch points.
  return (
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

function readDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return raw ? Date.now() - Number(raw) < DISMISS_FOR_MS : false;
  } catch {
    return false;
  }
}

export function InstallMineFlow({
  variant = 'settings',
}: {
  variant?: 'settings' | 'menu';
}) {
  const { installPromptAvailable, installed, standalone, promptInstall } = usePwa();
  // Client-only facts via useSyncExternalStore: server snapshot = safe default (no hydration
  // mismatch), no setState-in-effect.
  const ios = useSyncExternalStore(noopSubscribe, isIos, () => false);
  const initialDismissed = useSyncExternalStore(
    noopSubscribe,
    readDismissed,
    () => false,
  );
  const [dismissedNow, setDismissedNow] = useState(false);
  const dismissed = dismissedNow || initialDismissed;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore blocked storage */
    }
    setDismissedNow(true);
  };

  const install = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === 'dismissed')
      setNote('Install cancelled — you can install any time from Settings.');
    if (outcome === 'unavailable')
      setNote('Use your browser menu → "Install app" / "Add to Home screen".');
  };

  // Installed / standalone: a quiet confirmation (never an install button).
  if (installed || standalone) {
    if (variant === 'menu') return null;
    return (
      <p className="text-sm text-muted-foreground" data-testid="pwa-install-installed">
        ✓ MineFlow is installed on this device.
      </p>
    );
  }

  if (variant === 'menu') {
    if (dismissed) return null;
    return (
      <div className="flex items-center gap-2 px-2.5 py-1" data-testid="pwa-install-menu">
        <span aria-hidden="true">📲</span>
        <button
          type="button"
          onClick={installPromptAvailable ? () => void install() : undefined}
          disabled={busy || !installPromptAvailable}
          className="flex-1 text-left text-xs font-medium text-foreground disabled:text-muted-foreground"
        >
          {installPromptAvailable
            ? 'Install MineFlow'
            : 'Install MineFlow (see Settings)'}
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide install suggestion"
          className="tap-44 px-1 text-xs text-muted-foreground"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="pwa-install-settings">
      <p className="text-sm text-muted-foreground">
        Install MineFlow on this phone or tablet to open it like an app — full screen, on
        your home screen, same live data. It still needs an internet connection.
      </p>
      {installPromptAvailable ? (
        <Button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          data-testid="pwa-install-button"
        >
          {busy ? 'Installing…' : '📲 Install MineFlow'}
        </Button>
      ) : ios ? (
        <ol
          className="list-decimal space-y-1 pl-5 text-sm text-foreground"
          data-testid="pwa-install-ios"
        >
          <li>
            Open MineFlow in <strong>Safari</strong>.
          </li>
          <li>
            Tap <strong>Share</strong> (the square with an arrow).
          </li>
          <li>
            Tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            If shown, keep <strong>Open as Web App</strong> enabled.
          </li>
          <li>
            Tap <strong>Add</strong>.
          </li>
        </ol>
      ) : (
        <ol
          className="list-decimal space-y-1 pl-5 text-sm text-foreground"
          data-testid="pwa-install-manual"
        >
          <li>Open the browser menu (⋮).</li>
          <li>
            Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
          </li>
          <li>
            Confirm <strong>Install</strong>.
          </li>
        </ol>
      )}
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
