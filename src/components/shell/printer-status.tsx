'use client';

import {
  derivePrinterState,
  PRINTER_TONE,
  type PrinterState,
} from '@/components/shell/printer';
import { useMounted } from '@/components/shell/use-mounted';
import { cn } from '@/lib/utils';

/**
 * Honest Bluetooth / printer status. See {@link file://./printer.ts}.
 *
 * Real-device pairing and capability validation are NOT wired into the shell, so
 * this reports the true environment state and can never reach "Printer Ready"
 * here — exactly as required: no false connected/ready state.
 *
 * The initial (pre-detection) render is the honest neutral "Browser Preview
 * Available"; the real state is resolved on mount, avoiding hydration mismatch.
 */
const TONE_CLASS: Record<'gold' | 'muted' | 'destructive', string> = {
  gold: 'bg-gold/15 text-gold-strong',
  muted: 'bg-muted text-muted-foreground',
  destructive: 'bg-destructive/10 text-destructive',
};

function useHonestPrinterState(): PrinterState {
  const mounted = useMounted();

  // Before mount the honest neutral is "Browser Preview Available"; the real
  // environment state is resolved on the client, avoiding hydration mismatch.
  if (!mounted) return 'Browser Preview Available';

  return derivePrinterState({
    secureContext: window.isSecureContext,
    hasBluetooth: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    // The shell never pairs a device or records a validation, so these stay
    // false — the honest ceiling here is support / "Bluetooth Not Connected".
    deviceConnected: false,
    validated: false,
  });
}

function StateBadge({ state }: { state: PrinterState }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        TONE_CLASS[PRINTER_TONE[state]],
      )}
    >
      {state}
    </span>
  );
}

/** Compact badge for the mobile header. */
export function PrinterStatusBadge() {
  const state = useHonestPrinterState();
  return (
    <span data-testid="printer-status" title={`Bluetooth / Printer: ${state}`}>
      <StateBadge state={state} />
    </span>
  );
}

/** Full sidebar row. Sits directly above Logout in the approved footer order. */
export function PrinterStatusRow() {
  const state = useHonestPrinterState();
  return (
    <div
      data-testid="printer-status"
      title={`Bluetooth / Printer: ${state}`}
      className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left"
    >
      <span aria-hidden="true" className="text-sm text-muted-foreground">
        ⎙
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-muted-foreground">
          Bluetooth / Printer
        </span>
        <span className="mt-0.5 block">
          <StateBadge state={state} />
        </span>
      </span>
    </div>
  );
}
