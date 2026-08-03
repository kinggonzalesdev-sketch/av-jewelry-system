'use client';

import { useState } from 'react';

import { usePrinter } from '@/components/print/printer-context';
import { cn } from '@/lib/utils';

/**
 * Bluetooth / printer control — the ONE place to connect the XP-236B (Bible §27).
 *
 * Connect once here and every print in the app reuses the SAME connection (via
 * the shared PrinterProvider). It is honest: it only says "connected" when there
 * is a REAL GATT connection to the printer (a device you can Test-print to), and
 * says so plainly where Web Bluetooth is unavailable (e.g. iOS, or non-HTTPS).
 * Owner decision (2026-07-21): now that real Bluetooth printing works, the
 * control reflects the actual connection rather than a permanently-gated status.
 */

const BADGE = 'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium';

function ConnectedControls() {
  const {
    printer,
    channelIdx,
    setChannelIdx,
    printLang,
    setPrintLang,
    testResult,
    testPrint,
  } = usePrinter();
  const [showDetails, setShowDetails] = useState(false);
  if (!printer) return null;

  return (
    <div className="mt-1.5 space-y-1.5 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Format:</span>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="side-printLang"
            checked={printLang === 'tspl'}
            onChange={() => setPrintLang('tspl')}
          />
          Label (TSPL)
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="side-printLang"
            checked={printLang === 'escpos'}
            onChange={() => setPrintLang('escpos')}
          />
          Receipt (ESC/POS)
        </label>
      </div>

      {printer.channels.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Channel:</span>
          <select
            value={channelIdx}
            onChange={(e) => setChannelIdx(Number(e.target.value))}
            className="h-6 max-w-[150px] rounded border border-input bg-background px-1 text-[10px]"
          >
            {printer.channels.map((c, i) => (
              <option key={c.uuid} value={i}>
                {i + 1}. {c.uuid.slice(0, 8)}…
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void testPrint()}
          className="rounded border border-border bg-card px-1.5 py-0.5 font-medium text-foreground hover:bg-accent"
        >
          Test print
        </button>
        <button
          type="button"
          onClick={() => setShowDetails((s) => !s)}
          className="underline"
        >
          {showDetails ? 'Hide details' : 'Details'}
        </button>
      </div>

      {testResult ? (
        <p role="status" className="text-foreground">
          {testResult}
        </p>
      ) : null}
      {showDetails ? (
        <pre className="max-h-28 overflow-auto rounded border border-border bg-muted/40 p-1 text-[9px] leading-tight">
          {printer.details}
        </pre>
      ) : null}
    </div>
  );
}

/** Full sidebar control. Sits directly above Logout in the approved footer. */
export function PrinterStatusRow() {
  const { supported, adapterAvailable, printer, connecting, error, connect, disconnect } =
    usePrinter();
  // "Ready to link" only when the API exists AND an adapter is on. When Bluetooth is
  // off / absent we say so plainly instead of showing a raw browser error later.
  const adapterOff = supported && adapterAvailable === false;

  return (
    <div
      data-testid="printer-status"
      className="w-full rounded-lg border border-border bg-card px-2.5 py-2 text-left"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-muted-foreground">
            Bluetooth / Printer
          </span>
          <span className="mt-0.5 block">
            {printer ? (
              <span className={cn(BADGE, 'bg-gold/15 text-gold-strong')}>
                {printer.deviceName} connected
              </span>
            ) : adapterOff ? (
              <span className={cn(BADGE, 'bg-muted text-muted-foreground')}>
                Bluetooth is off
              </span>
            ) : supported ? (
              <span className={cn(BADGE, 'bg-muted text-muted-foreground')}>
                No printer linked
              </span>
            ) : (
              <span className={cn(BADGE, 'bg-muted text-muted-foreground')}>
                Bluetooth printing unavailable
              </span>
            )}
          </span>
        </span>

        {/*
          Toggle-style switch that reflects the REAL connection: ON (gold, knob
          right) only when a printer is actually linked; OFF (gray, knob left) when
          none is. Tapping OFF→ON links a printer; tapping ON→OFF unlinks it.
          Disabled where Bluetooth printing is unavailable.
        */}
        <button
          type="button"
          role="switch"
          aria-checked={!!printer}
          aria-label={
            printer
              ? `Bluetooth printer: ${printer.deviceName} linked, tap to unlink`
              : supported
                ? 'Bluetooth printer: not linked, tap to link a printer'
                : 'Bluetooth printer: unavailable on this device'
          }
          disabled={!supported || connecting}
          onClick={() => {
            if (!supported) return;
            if (printer) disconnect();
            else void connect();
          }}
          className={cn(
            'inline-flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:cursor-not-allowed',
            printer ? 'justify-end bg-gold' : 'justify-start bg-muted',
            connecting && 'opacity-70',
          )}
        >
          <span className="inline-block h-4 w-4 rounded-full bg-white shadow" />
        </button>
      </div>

      {!supported ? (
        <p className="mt-1 text-[10px] text-muted-foreground">
          Use Chrome or Edge on a computer, or Chrome on Android. iPhone / Safari / Firefox
          can&apos;t print over Bluetooth — use manual print there.
        </p>
      ) : adapterOff ? (
        <p className="mt-1 text-[10px] text-amber-600">
          Turn on this device&apos;s Bluetooth (it&apos;s off or has no adapter), then tap the
          switch to link the printer.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-[10px] text-destructive">
          {error}
        </p>
      ) : null}

      <ConnectedControls />
    </div>
  );
}

/** Compact control for the mobile header. */
export function PrinterStatusBadge() {
  const { supported, printer, connecting, connect } = usePrinter();

  const label = printer
    ? `${printer.deviceName} connected`
    : connecting
      ? 'Connecting…'
      : supported
        ? 'Connect printer'
        : 'Bluetooth off';

  return (
    <button
      type="button"
      onClick={() => (printer || !supported ? undefined : void connect())}
      data-testid="printer-status"
      aria-label={`Bluetooth / Printer: ${label}`}
      title={`Bluetooth / Printer: ${label}`}
      className="rounded-md"
    >
      <span
        className={cn(
          BADGE,
          printer ? 'bg-gold/15 text-gold-strong' : 'bg-muted text-muted-foreground',
        )}
      >
        {label}
      </span>
    </button>
  );
}
