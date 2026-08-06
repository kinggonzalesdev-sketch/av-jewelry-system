'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  dismissPendingCaptureAction,
  loadPendingCapturesAction,
} from '@/lib/capture/pending-actions';
import type { PendingCaptureRow } from '@/lib/capture/pending-types';
import {
  NewOrderModal,
  type CapturePrefill,
} from '@/components/orders/new-order-workflow';
import { useDashboardSync } from '@/components/shell/dashboard-sync';
import { usePrinter } from '@/components/print/printer-context';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import { stickerDate, type OrderReceiptData } from '@/lib/print/order-receipt';
import { readStickerFields } from '@/lib/print/sticker-fields';
import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { Button } from '@/components/ui/button';

/**
 * Incoming Captures — the PC's live station. Floating-screenshot captures uploaded
 * from the phone appear here in realtime (no refresh). "Use" opens New Order
 * PRE-FILLED with the OCR'd Facebook name + mined item, with the screenshot shown for
 * reference — the operator confirms/corrects, then the normal flow creates the order
 * (prints on THIS PC, reserves the item, lands in For Invoice) and links the
 * screenshot so Send Invoice auto-attaches it. "Dismiss" discards a junk capture.
 * Self-hides when nothing is waiting.
 */
export function IncomingCapturesStrip({
  customers,
  items,
  walkInItems,
  admins,
}: {
  customers: { id: string; displayName: string }[];
  items: CaptureItem[];
  walkInItems: WalkInItem[];
  admins: AdminNameContext;
}) {
  const { lastSyncedAt } = useDashboardSync();
  const { activeChannel, printLang } = usePrinter();
  const [rows, setRows] = useState<PendingCaptureRow[]>([]);
  const [selected, setSelected] = useState<PendingCaptureRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Auto-print preference, read lazily from localStorage. Safe from hydration
  // mismatch: the strip renders null until captures load, so this control is never
  // in the SSR output. The window guard keeps the initializer server-safe.
  const [autoPrint, setAutoPrint] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('mineflow.captureAutoPrint') === '1';
    } catch {
      return false;
    }
  });

  // The capture ids already printed on THIS station, persisted so a reload/re-poll
  // never reprints. Seeded on mount (ref mutation only — no re-render).
  const printedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = localStorage.getItem('mineflow.capturePrinted');
      if (raw) printedRef.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore unavailable/blocked storage */
    }
  }, []);

  const toggleAutoPrint = (on: boolean) => {
    setAutoPrint(on);
    try {
      localStorage.setItem('mineflow.captureAutoPrint', on ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  const rememberPrinted = (id: string) => {
    printedRef.current.add(id);
    try {
      localStorage.setItem(
        'mineflow.capturePrinted',
        JSON.stringify([...printedRef.current].slice(-200)),
      );
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(() => {
    loadPendingCapturesAction()
      .then((data) => setRows(data))
      .catch(() => undefined);
  }, []);

  // Load on mount + on every realtime nudge, so a new upload from the phone appears
  // here without a manual refresh (debounced upstream by DashboardSyncProvider).
  useEffect(() => {
    load();
  }, [load, lastSyncedAt]);

  // Poll FAST (1s) so a phone capture shows up on the PC within ~1s, independent of
  // Realtime. Cheap for a single live station; the auto-appear never depends solely
  // on the socket.
  useEffect(() => {
    const iv = setInterval(load, 1000);
    return () => clearInterval(iv);
  }, [load]);

  // AUTO-PRINT (opt-in): when a NEW capture arrives and the printer is linked, print
  // its Facebook-Name + Date sticker once — the hands-off half of the one-tap flow
  // (the phone auto-sends the screenshot; the PC auto-prints the label). Skips test
  // captures and name-less reads; each capture prints at most once per station, so
  // the 1s poll never reprints. A capture is marked printed BEFORE the write, so a
  // flaky printer can't trigger a reprint storm — reprint deliberately via "Use".
  useEffect(() => {
    if (!autoPrint || !activeChannel) return;
    const pending = rows.filter(
      (r) =>
        !r.isTest &&
        (r.fbName ?? '').trim().length >= 2 &&
        !printedRef.current.has(r.captureRecordId),
    );
    if (pending.length === 0) return;
    void (async () => {
      for (const r of pending) {
        rememberPrinted(r.captureRecordId);
        const data: OrderReceiptData = {
          customerName: (r.fbName ?? '').trim(),
          itemName: '',
          grams: null,
          quantity: 1,
          unitPrice: null,
          date: stickerDate(),
        };
        try {
          await writeToChannel(activeChannel, encodeReceipt(data, printLang, readStickerFields()));
        } catch {
          /* keep it marked printed to avoid a reprint storm on a flaky link */
        }
      }
    })();
  }, [rows, autoPrint, activeChannel, printLang]);

  const dismiss = (id: string) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    dismissPendingCaptureAction(id)
      .then((res) => {
        setBusy(null);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setRows((cur) => cur.filter((r) => r.captureRecordId !== id));
      })
      .catch(() => {
        setBusy(null);
        setError('Could not dismiss the capture.');
      });
  };

  const prefillFor = (r: PendingCaptureRow): CapturePrefill => ({
    customerName: r.fbName ?? undefined,
    itemQuery: r.itemQuery ?? undefined,
    captureRecordId: r.captureRecordId,
    screenshotUrl: r.screenshotUrl,
  });

  if (rows.length === 0) return null;

  return (
    <section
      className="rounded-xl border border-gold/40 bg-gold/5 p-4"
      data-testid="incoming-captures"
      aria-labelledby="incoming-captures-h"
    >
      <h2 id="incoming-captures-h" className="text-sm font-semibold text-gold-strong">
        Incoming Captures ({rows.length})
      </h2>
      <p className="mb-2 mt-0.5 text-xs text-muted-foreground">
        Screenshots from the floating button. Tap <strong>Use</strong> to confirm the
        name + item and create the order (it prints here and lands in For Invoice), or
        Dismiss to discard.
      </p>
      <label className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <input
          type="checkbox"
          checked={autoPrint}
          onChange={(e) => toggleAutoPrint(e.target.checked)}
          data-testid="capture-auto-print"
        />
        Auto-print the sticker (Facebook Name + Date) the moment each capture arrives
        {autoPrint && !activeChannel ? (
          <span className="font-medium text-amber-600">— link the printer first (Settings ▸ Printer)</span>
        ) : null}
      </label>
      {error ? (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li
            key={r.captureRecordId}
            className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card/60 px-3 py-2 text-sm"
          >
            {r.screenshotUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={r.screenshotUrl}
                alt="Capture"
                className="h-14 w-14 shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
                no image
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="break-words font-medium">
                {r.fbName ?? <span className="text-muted-foreground">Name not read</span>}
                {r.isTest ? (
                  <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                    Test
                  </span>
                ) : null}
              </p>
              <p className="break-words text-xs text-muted-foreground">
                {r.itemQuery ?? 'Item not read — pick it below'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setSelected(r)}
                data-testid={`incoming-use-${r.captureRecordId}`}
              >
                Use
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === r.captureRecordId}
                onClick={() => dismiss(r.captureRecordId)}
              >
                {busy === r.captureRecordId ? '…' : 'Dismiss'}
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {selected ? (
        <NewOrderModal
          customers={customers}
          items={items}
          walkInItems={walkInItems}
          admins={admins}
          prefill={prefillFor(selected)}
          onClose={() => {
            setSelected(null);
            load();
          }}
        />
      ) : null}
    </section>
  );
}
