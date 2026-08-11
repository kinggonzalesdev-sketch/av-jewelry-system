'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  claimCaptureStickerAction,
  dismissPendingCaptureAction,
  loadPendingCapturesAction,
  markCaptureStickerPrintedAction,
  releaseCaptureStickerAction,
  resolveCaptureLinkAction,
  sendCaptureToMessengerAction,
} from '@/lib/capture/pending-actions';
import {
  CAPTURE_COUNT_EVENT,
  TOGGLE_INCOMING_CAPTURES_EVENT,
  type CaptureLinkResult,
  type PendingCaptureRow,
} from '@/lib/capture/pending-types';
import {
  CaptureLinkPanel,
  type EffectiveCaptureLink,
} from '@/components/capture/capture-link-panel';
import {
  NewOrderModal,
  type CapturePrefill,
} from '@/components/orders/new-order-workflow';
import { useDashboardSync } from '@/components/shell/dashboard-sync';
import { createClient } from '@/lib/supabase/client';
import { authorizeRealtime } from '@/lib/supabase/realtime-auth';
import { usePrinter } from '@/components/print/printer-context';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import {
  stickerDate,
  normalizeGrams,
  type OrderReceiptData,
} from '@/lib/print/order-receipt';
import { readStickerFields, readStickerPricePerGram } from '@/lib/print/sticker-fields';
import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

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
  // Hidden until the operator clicks the "Capture Pending" pill (Owner request
  // 2026-08-09) — the strip must not appear on its own. The component stays
  // mounted regardless (all effects below keep running, so background auto-print
  // is unaffected); only the visible panel is gated on `open`.
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PendingCaptureRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The capture whose screenshot is mid-send to Messenger (per-row spinner).
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Operator's grams correction per capture (for the review case + manual reprint),
  // and a short per-row status note ("Printed ✓").
  const [gramsEdits, setGramsEdits] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Client cache of the resolved Facebook link per capture (overrides the row until
  // the next server load reflects the persisted status).
  const [linkOverrides, setLinkOverrides] = useState<Record<string, CaptureLinkResult>>(
    {},
  );
  // Captures we've already kicked a resolution for, so each resolves exactly once.
  const resolvedRef = useRef<Set<string>>(new Set());

  // Set by the auto-print effect below; lets the realtime handler kick an INSTANT drain
  // the moment a capture arrives (null while no printer is connected / auto-print off).
  const drainRef = useRef<(() => void) | null>(null);

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
      .then((data) => {
        setRows(data);
        // Tell the "Capture Pending" pill the exact live count so its badge always
        // matches this popup's "(N)" — same query, one source of truth.
        window.dispatchEvent(
          new CustomEvent(CAPTURE_COUNT_EVENT, { detail: data.length }),
        );
      })
      .catch(() => undefined);
  }, []);

  // Load on mount + on every realtime nudge, so a new upload from the phone appears
  // here without a manual refresh (debounced upstream by DashboardSyncProvider).
  useEffect(() => {
    load();
  }, [load, lastSyncedAt]);

  // Realtime (lastSyncedAt above) is the FAST path — a phone capture triggers a load
  // near-instantly. This interval is ONLY a fallback for when the socket drops. It ran
  // every 2.5s, which meant a steady ~24 server-action calls/min from every open station
  // for the whole live (a large share of Vercel invocations + CPU on the Hobby plan). At
  // 30s it still self-heals a dropped socket within half a minute while cutting that
  // steady load ~12×; realtime keeps normal appearance instant.
  useEffect(() => {
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  // FAST PATH (~0.5–1s): a DEDICATED realtime subscription on capture_records fires the
  // instant a phone capture is inserted — independent of the debounced, heavier
  // whole-page router.refresh(). It immediately reloads the strip (the capture appears)
  // AND kicks the auto-print drain (its sticker prints), giving ~1s end-to-end. The 30s
  // poll above stays only as a socket-drop fallback; realtime carries the normal case.
  // Its own channel (separate from the app-wide DashboardSync one), cleaned up on unmount.
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // no browser env — the 30s fallback + DashboardSync still surface captures
    }
    // Authorize the socket with the user's JWT so RLS-filtered capture_records events
    // actually arrive (an unauthorized socket is rejected with 401) — this is what makes
    // a new capture appear + auto-print in ~1s instead of waiting for the 30s fallback.
    const stopRealtimeAuth = authorizeRealtime(supabase);
    const channel = supabase
      .channel('incoming-captures-fast')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'capture_records' },
        () => {
          load();
          drainRef.current?.();
        },
      )
      .subscribe();
    return () => {
      stopRealtimeAuth();
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Open/close when the "Capture Pending" pill (in OrdersView) is clicked. The
  // pill dispatches a window event so the two siblings stay decoupled; clicking it
  // toggles the panel, and a fresh load makes sure the latest captures show.
  useEffect(() => {
    const onToggle = () => {
      setOpen((v) => !v);
      load();
    };
    window.addEventListener(TOGGLE_INCOMING_CAPTURES_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_INCOMING_CAPTURES_EVENT, onToggle);
  }, [load]);

  // Capture-time linking: the first time we see an UNRESOLVED capture (link_status
  // null), resolve WHO it is (customer + Pancake conversation) and — when it uniquely
  // resolves — auto-send the screenshot. Runs exactly once per capture (resolvedRef),
  // never guesses an ambiguous name (the server returns needs_confirmation instead).
  useEffect(() => {
    for (const r of rows) {
      const id = r.captureRecordId;
      if (r.linkStatus !== null || linkOverrides[id] || resolvedRef.current.has(id))
        continue;
      resolvedRef.current.add(id);
      resolveCaptureLinkAction(id)
        .then((res) => {
          if (!res.ok) return;
          setLinkOverrides((cur) => ({ ...cur, [id]: res }));
          if (res.sent) setNotes((cur) => ({ ...cur, [id]: 'Sent to Messenger ✓' }));
        })
        .catch(() => undefined);
    }
  }, [rows, linkOverrides]);

  // Build the sticker for a capture: Facebook Name / grams • ₱rate/g / Date. The rate
  // ALWAYS comes from Sticker Settings (the pinned comment never carries a price); the
  // grams comes from the OCR (or the operator's correction). Pure — no side effects.
  const stickerFor = (
    r: PendingCaptureRow,
    gramsOverride?: string,
  ): OrderReceiptData => ({
    customerName: (r.fbName ?? '').trim() || '—',
    itemName: '',
    grams: normalizeGrams(gramsOverride ?? r.grams ?? ''),
    quantity: 1,
    unitPrice: null,
    pricePerGram: readStickerPricePerGram() || null,
    date: stickerDate(),
  });

  // AUTO-PRINT (opt-in): when a NEW capture arrives and the printer is linked, print
  // its "Name / grams • ₱rate/g / Date" sticker once — the hands-off half of the
  // one-tap flow (the phone auto-sends the screenshot; the PC auto-prints the label).
  // NEEDS-REVIEW GATE: only auto-prints when a CONFIDENT weight was read; a name-only
  // or uncertain capture waits for the operator to confirm the grams and print. Skips
  // test captures; each capture prints at most once per station (the poll never
  // reprints). Marked printed BEFORE the write so a flaky printer can't reprint-storm.
  // SHARED PC+phone auto-print (Owner 2026-08-10 "both PC and phone pwedi"): instead of
  // a per-device localStorage dedup, we CLAIM the next capture sticker from the server
  // queue and print it. The DB hands each capture to ONE device (FOR UPDATE SKIP LOCKED),
  // so a PC and a phone can both be set up and each sticker prints EXACTLY ONCE —
  // whoever is active takes it. Runs on an interval while a printer is connected +
  // auto-print is enabled; a print failure releases the claim for the other device.
  useEffect(() => {
    if (!activeChannel) return;
    let alive = true;
    let draining = false;
    const tick = async () => {
      if (!alive || draining) return;
      let autoPrint = false;
      try {
        autoPrint = localStorage.getItem('mineflow.captureAutoPrint') === '1';
      } catch {
        /* storage unavailable — treat as off */
      }
      if (!autoPrint) return;
      draining = true;
      try {
        // Drain up to a few per tick so a burst prints promptly without hogging.
        for (let i = 0; i < 5 && alive; i += 1) {
          const claim = await claimCaptureStickerAction();
          if (!claim.claimed) break;
          const data: OrderReceiptData = {
            customerName: claim.fbName || '—',
            itemName: '',
            grams: normalizeGrams(claim.grams),
            quantity: 1,
            unitPrice: null,
            pricePerGram: readStickerPricePerGram() || null,
            date: stickerDate(),
          };
          try {
            await writeToChannel(
              activeChannel,
              encodeReceipt(data, printLang, readStickerFields()),
            );
            await markCaptureStickerPrintedAction(claim.captureRecordId);
            setNotes((cur) => ({ ...cur, [claim.captureRecordId]: 'Auto-printed ✓' }));
          } catch {
            // Printer trouble — hand the claim back so the phone (or a retry) can take it.
            await releaseCaptureStickerAction(claim.captureRecordId).catch(
              () => undefined,
            );
            break;
          }
        }
      } catch {
        /* ignore a transient claim error */
      } finally {
        draining = false;
      }
    };
    // Realtime is the FAST path now: the dedicated capture_records channel above calls
    // this drain the instant a capture arrives, so a sticker prints within ~1s. Expose
    // it via drainRef for that handler; the 15s interval is only a socket-drop fallback
    // (the drain is idempotent + guarded by the server's exactly-once claim, so an extra
    // realtime-triggered call can never double-print). Runs only with a printer connected.
    drainRef.current = () => void tick();
    const iv = setInterval(() => void tick(), 15000);
    void tick();
    return () => {
      alive = false;
      drainRef.current = null;
      clearInterval(iv);
    };
  }, [activeChannel, printLang]);

  // Manual print (review / reprint): print THIS capture's label with the operator's
  // confirmed grams. Used when the weight needed review, or to reprint deliberately.
  const printLabel = async (r: PendingCaptureRow) => {
    if (!activeChannel) {
      setError('Connect the printer first (Sticker Settings → Test Print).');
      return;
    }
    const g = normalizeGrams(gramsEdits[r.captureRecordId] ?? r.grams ?? '');
    if (g === null) {
      setError('Enter the weight in grams before printing.');
      return;
    }
    setError(null);
    try {
      await writeToChannel(
        activeChannel,
        encodeReceipt(stickerFor(r, g), printLang, readStickerFields()),
      );
      rememberPrinted(r.captureRecordId);
      // Claim it in the shared queue so no other device (phone/auto) reprints it.
      await markCaptureStickerPrintedAction(r.captureRecordId).catch(() => undefined);
      setNotes((cur) => ({ ...cur, [r.captureRecordId]: 'Printed ✓' }));
    } catch {
      setError('Print failed — check the printer link.');
    }
  };

  // Manual "Send to Messenger": push THIS capture's screenshot to the customer's
  // Pancake chat. The backend resolves the conversation from the OCR'd name (never a
  // guess) and holds the token; the operator's click authorizes this one send. A
  // clear inline note reports sent / already-sent, and a failure explains why (no
  // token, unlinked customer, ambiguous name) so it can be fixed and retried.
  const sendToMessenger = async (r: PendingCaptureRow) => {
    if (sendingId) return;
    setSendingId(r.captureRecordId);
    setError(null);
    try {
      const res = await sendCaptureToMessengerAction(r.captureRecordId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotes((cur) => ({ ...cur, [r.captureRecordId]: res.message }));
    } catch {
      setError('Could not send to Messenger.');
    } finally {
      setSendingId(null);
    }
  };

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

  const prefillFor = (r: PendingCaptureRow): CapturePrefill => {
    // A REAL claim is a pinned "<Facebook Name> / Mine <grams>" comment — its
    // signal is a confident weight (the "Mine 10.5" number). Without it (a
    // screenshot with no pinned claim, e.g. the app's own screen), we do NOT guess
    // a customer name — the operator types it (Owner request 2026-08-09). The item
    // is ALWAYS chosen by hand: the pinned comment never names one, so it is never
    // pre-filled.
    const hasClaim =
      normalizeGrams(gramsEdits[r.captureRecordId] ?? r.grams ?? '') !== null;
    return {
      customerName: hasClaim ? (r.fbName ?? undefined) : undefined,
      captureRecordId: r.captureRecordId,
      screenshotUrl: r.screenshotUrl,
    };
  };

  // The link to show for a row: the client override (a fresh resolve/change) wins,
  // else the persisted values from the server load.
  const effectiveLink = (r: PendingCaptureRow): EffectiveCaptureLink => {
    const o = linkOverrides[r.captureRecordId];
    return o
      ? {
          linkStatus: o.linkStatus,
          linkedCustomerName: o.linkedCustomerName,
          conversationAvailable: o.conversationAvailable,
          fbUrl: o.fbUrl,
          matchCount: o.matchCount,
        }
      : {
          linkStatus: r.linkStatus,
          linkedCustomerName: r.linkedCustomerName,
          conversationAvailable: r.conversationAvailable,
          fbUrl: r.fbUrl,
          matchCount: 0,
        };
  };

  // The strip is a POPUP: it renders nothing until the operator opens it from the
  // "Capture Pending" pill (Owner request 2026-08-09 — it must never appear on its
  // own). The component stays mounted the whole time (every hook above keeps
  // running), so background auto-print is unaffected; a CLOSED Modal renders
  // nothing at all (it portals only when open), so it cannot show on page load.
  return (
    <>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Incoming Captures${rows.length ? ` (${rows.length})` : ''}`}
        size="lg"
      >
        <div data-testid="incoming-captures" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Screenshots from the floating button. The label prints{' '}
            <strong>Name / grams • ₱rate/g / date</strong> — the rate comes from{' '}
            <strong>Sticker Settings</strong>. Confirm the grams and tap{' '}
            <strong>Print</strong> for the label, <strong>Send</strong> to push the
            screenshot to the customer&apos;s Messenger, <strong>Use</strong> to create
            the order, or Dismiss to discard. Auto-print (set in Sticker Settings) prints
            on its own only when the weight was read confidently.
          </p>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="rounded-md border border-border bg-card/60 px-3 py-6 text-center text-sm text-muted-foreground">
              No incoming captures right now.
            </p>
          ) : (
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
                      {r.fbName ?? (
                        <span className="text-muted-foreground">Name not read</span>
                      )}
                      {r.isTest ? (
                        <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                          Test
                        </span>
                      ) : null}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <label className="flex items-center gap-1 text-muted-foreground">
                        Grams
                        <input
                          type="text"
                          inputMode="decimal"
                          value={gramsEdits[r.captureRecordId] ?? r.grams ?? ''}
                          placeholder="e.g. 11.5"
                          onChange={(e) =>
                            setGramsEdits((cur) => ({
                              ...cur,
                              [r.captureRecordId]: e.target.value,
                            }))
                          }
                          className="h-7 w-20 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-gold"
                          data-testid={`incoming-grams-${r.captureRecordId}`}
                        />
                      </label>
                      {normalizeGrams(gramsEdits[r.captureRecordId] ?? r.grams ?? '') ===
                      null ? (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                          Needs review
                        </span>
                      ) : null}
                      {notes[r.captureRecordId] ? (
                        <span className="text-[10px] font-medium text-emerald-600">
                          {notes[r.captureRecordId]}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void printLabel(r)}
                      data-testid={`incoming-print-${r.captureRecordId}`}
                    >
                      🖨 Print
                    </Button>
                    {/* Send the screenshot to the pinned customer's Messenger. Disabled for a
                  Test capture — a test must never message a real customer. */}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={sendingId === r.captureRecordId || r.isTest}
                      onClick={() => void sendToMessenger(r)}
                      data-testid={`incoming-send-${r.captureRecordId}`}
                    >
                      {sendingId === r.captureRecordId ? 'Sending…' : '📨 Send'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setSelected(r);
                        setOpen(false);
                      }}
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
                  {/* Linked Facebook Customer — resolved from the detected name. Full width
                on its own line (the li is flex-wrap). Not shown for a Test capture. */}
                  {!r.isTest ? (
                    <div className="w-full">
                      <CaptureLinkPanel
                        captureRecordId={r.captureRecordId}
                        link={effectiveLink(r)}
                        onChanged={(res) =>
                          setLinkOverrides((cur) => ({
                            ...cur,
                            [r.captureRecordId]: res,
                          }))
                        }
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

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
    </>
  );
}
