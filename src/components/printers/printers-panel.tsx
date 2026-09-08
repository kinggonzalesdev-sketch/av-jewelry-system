'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  deletePrinterAction,
  registerPrinterAction,
  updatePrinterAction,
} from '@/lib/printers/actions';
import type { PrinterRow, PrintQueueStatus } from '@/lib/printers/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TRANSPORTS = ['bluetooth', 'escpos', 'tspl', 'browser_preview'] as const;

/**
 * Printer registry management (Owner/Admin). Register named printers and pick the
 * default; a live snapshot of the single-claim print queue (pending / in-progress /
 * failed). The actual claiming + printing happens on the capturing device via the
 * print endpoints — each label job is claimed by exactly one device.
 */
export function PrintersPanel({
  printers,
  queue,
}: {
  printers: PrinterRow[];
  queue: PrintQueueStatus;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [transport, setTransport] = useState<string>('bluetooth');
  const [labelSize, setLabelSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'That action could not be completed.');
      return;
    }
    router.refresh();
  };

  const register = () =>
    run(async () => {
      const res = await registerPrinterAction({
        name,
        target: target || null,
        transport,
        labelSize: labelSize || null,
      });
      if (res.ok) {
        setName('');
        setTarget('');
        setLabelSize('');
      }
      return res;
    });

  return (
    <div className="space-y-4" data-testid="printers-panel">
      {/* Queue snapshot. */}
      <div className="flex flex-wrap gap-2 text-xs" data-testid="print-queue-status">
        {(
          [
            ['Pending', queue.pending],
            ['In progress', queue.claimed],
            ['Failed', queue.failed],
          ] as const
        ).map(([label, n]) => (
          <span
            key={label}
            className="rounded-md border border-border bg-muted/40 px-2 py-1"
          >
            {label}: <strong className="tabular-nums">{n}</strong>
          </span>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Registered printers. */}
      {printers.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No printers registered yet. Add one below.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {printers.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
              data-testid={`printer-row-${p.id}`}
            >
              <div className="min-w-0">
                <p className="break-words font-medium">
                  {p.name}
                  {p.isDefault ? (
                    <span className="ml-1.5 rounded-full bg-gold/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-strong">
                      Default
                    </span>
                  ) : null}
                  {!p.isActive ? (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                      Off
                    </span>
                  ) : null}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {p.transport}
                  {p.target ? ` · ${p.target}` : ''}
                  {p.labelSize ? ` · ${p.labelSize}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {!p.isDefault ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(() => updatePrinterAction(p.id, { makeDefault: true }))
                    }
                    data-testid={`printer-default-${p.id}`}
                  >
                    Set default
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() => updatePrinterAction(p.id, { active: !p.isActive }))
                  }
                  data-testid={`printer-toggle-${p.id}`}
                >
                  {p.isActive ? 'Turn off' : 'Turn on'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => void run(() => deletePrinterAction(p.id))}
                  data-testid={`printer-delete-${p.id}`}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Register a new printer. */}
      <div className="rounded-md border border-border p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Register a printer
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="printer-name" className="text-xs">
              Name
            </Label>
            <Input
              id="printer-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Counter XP-236B"
              className="mt-1 h-9"
              data-testid="printer-name-input"
            />
          </div>
          <div>
            <Label htmlFor="printer-target" className="text-xs">
              Target (Bluetooth address / id) — optional
            </Label>
            <Input
              id="printer-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="e.g. 66:22:BC:..."
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="printer-transport" className="text-xs">
              Transport
            </Label>
            <select
              id="printer-transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {TRANSPORTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="printer-size" className="text-xs">
              Label size — optional
            </Label>
            <Input
              id="printer-size"
              value={labelSize}
              onChange={(e) => setLabelSize(e.target.value)}
              placeholder="e.g. 40x30"
              className="mt-1 h-9"
            />
          </div>
        </div>
        <Button
          type="button"
          className="mt-3"
          size="sm"
          disabled={busy || !name.trim()}
          onClick={() => void register()}
          data-testid="printer-register"
        >
          {busy ? 'Saving…' : 'Register printer'}
        </Button>
      </div>
    </div>
  );
}
