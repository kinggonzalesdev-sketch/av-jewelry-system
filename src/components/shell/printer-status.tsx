'use client';

import { useState } from 'react';

import {
  derivePrinterState,
  PRINTER_TONE,
  type PrinterState,
} from '@/components/shell/printer';
import { useMounted } from '@/components/shell/use-mounted';
import { cn } from '@/lib/utils';

/**
 * Bluetooth / printer status — now a CLICKABLE connect control (like the theme
 * toggle), while staying HONEST. See {@link file://./printer.ts}.
 *
 * Clicking it opens the browser's Bluetooth device chooser (the "search"). What
 * it can and cannot claim:
 *   - Selecting a device moves the state to "Bluetooth Validation Required", NOT
 *     "Printer Ready" / "Connected". A chosen device is not a validated printer:
 *     real-device print validation (recorded at /admin/capabilities) is still
 *     required before printing is enabled (Bible §27.18; the audit doc).
 *   - Where Web Bluetooth is unavailable (no secure context, no API — e.g. every
 *     iOS browser), it says so and does not pretend to search.
 * It therefore never shows a false connected/ready state.
 */

const TONE_CLASS: Record<'gold' | 'muted' | 'destructive', string> = {
  gold: 'bg-gold/15 text-gold-strong',
  muted: 'bg-muted text-muted-foreground',
  destructive: 'bg-destructive/10 text-destructive',
};

/** Minimal Web Bluetooth typing (not in the standard DOM lib). */
type BluetoothLike = {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    optionalServices?: unknown[];
  }): Promise<{ name?: string | null }>;
};

function getBluetooth(): BluetoothLike | null {
  if (typeof navigator === 'undefined') return null;
  const b = (navigator as unknown as { bluetooth?: BluetoothLike }).bluetooth;
  return b ?? null;
}

type Phase = 'idle' | 'searching' | 'selected' | 'error';

type Connect = {
  state: PrinterState;
  phase: Phase;
  deviceName: string | null;
  hint: string;
  clickable: boolean;
  onClick: () => void | Promise<void>;
};

function usePrinterConnect(): Connect {
  const mounted = useMounted();
  const [phase, setPhase] = useState<Phase>('idle');
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);

  // Pre-mount: the honest neutral, avoiding hydration mismatch.
  if (!mounted) {
    return {
      state: 'Browser Preview Available',
      phase: 'idle',
      deviceName: null,
      hint: '',
      clickable: false,
      onClick: () => {},
    };
  }

  const secureContext = window.isSecureContext;
  const bluetooth = getBluetooth();
  const hasBluetooth = bluetooth !== null;

  const state = derivePrinterState({
    secureContext,
    hasBluetooth,
    // A chosen device raises the ceiling to "Validation Required" — never higher.
    deviceConnected: phase === 'selected',
    validated: false,
  });

  const clickable = secureContext && hasBluetooth && phase !== 'searching';

  async function onClick() {
    if (!secureContext) {
      setErrorHint('Open the app over HTTPS to use Bluetooth printing.');
      return;
    }
    if (!bluetooth) {
      // Web Bluetooth is unavailable — notably on every iOS browser.
      setErrorHint('This browser has no Web Bluetooth (e.g. iOS). Use manual print.');
      return;
    }
    setErrorHint(null);
    setPhase('searching');
    try {
      const device = await bluetooth.requestDevice({
        // We do not yet know the XP-236B's service UUIDs (see the hardware audit),
        // so we accept all devices to let the operator pick the printer.
        acceptAllDevices: true,
      });
      setDeviceName(device.name ?? 'Selected device');
      setPhase('selected');
    } catch (err) {
      // The chooser being dismissed is a cancel, not an error.
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotFoundError') {
        setPhase('idle');
      } else {
        setErrorHint('Could not open the Bluetooth chooser.');
        setPhase('error');
      }
    }
  }

  let hint: string;
  if (phase === 'searching') hint = 'Searching for devices…';
  else if (phase === 'selected')
    hint = `${deviceName ?? 'Device'} selected · print not yet validated`;
  else if (errorHint) hint = errorHint;
  else if (clickable) hint = 'Tap to search for a printer';
  else hint = '';

  return { state, phase, deviceName, hint, clickable, onClick };
}

function StateBadge({ state, phase }: { state: PrinterState; phase: Phase }) {
  const label = phase === 'searching' ? 'Searching…' : state;
  const tone = phase === 'searching' ? 'gold' : PRINTER_TONE[state];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        TONE_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}

/** Compact clickable badge for the mobile header. */
export function PrinterStatusBadge() {
  const c = usePrinterConnect();
  return (
    <button
      type="button"
      onClick={() => void c.onClick()}
      data-testid="printer-status"
      aria-label={`Bluetooth / Printer: ${c.state}. ${c.hint}`}
      title={`Bluetooth / Printer: ${c.state}${c.hint ? ` — ${c.hint}` : ''}`}
      className="rounded-md"
    >
      <StateBadge state={c.state} phase={c.phase} />
    </button>
  );
}

/** Full clickable sidebar row. Sits directly above Logout in the approved footer. */
export function PrinterStatusRow() {
  const c = usePrinterConnect();
  return (
    <button
      type="button"
      onClick={() => void c.onClick()}
      data-testid="printer-status"
      aria-label={`Bluetooth / Printer: ${c.state}. ${c.hint}`}
      title={`Bluetooth / Printer: ${c.state}`}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left transition-colors',
        c.clickable && 'hover:border-gold/40 hover:bg-accent',
      )}
    >
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        ⎙
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-muted-foreground">
          Bluetooth / Printer
        </span>
        <span className="mt-0.5 block">
          <StateBadge state={c.state} phase={c.phase} />
        </span>
        {c.hint ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {c.hint}
          </span>
        ) : null}
      </span>
    </button>
  );
}
