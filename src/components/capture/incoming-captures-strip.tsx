'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  claimCaptureStickerAction,
  dismissPendingCaptureAction,
  loadPendingCapturesAction,
  markCaptureStickerPrintedAction,
  releaseCaptureStickerAction,
  resolveCaptureLinkAction,
  retryCaptureAutoTextAction,
  saveCaptureEditsAction,
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
import { CaptureSendControl } from '@/components/capture/capture-send-control';
import { sanitizeCaptureName } from '@/lib/capture/name-sanitize';
import {
  NewOrderModal,
  type CapturePrefill,
} from '@/components/orders/new-order-workflow';
import { loadNewOrderDataAction, type NewOrderData } from '@/lib/orders/actions';
import { useDashboardSync } from '@/components/shell/dashboard-sync';
import { createClient } from '@/lib/supabase/client';
import { authorizeRealtime } from '@/lib/supabase/realtime-auth';
import { usePrinter } from '@/components/print/printer-context';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import {
  stickerDate,
  normalizeGrams,
  parseFixedPrice,
  classifyCaptureValue,
  formatStickerPeso,
  type OrderReceiptData,
} from '@/lib/print/order-receipt';
import { readStickerFields, readStickerPricePerGram } from '@/lib/print/sticker-fields';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/** Read one string field off the (untyped) OCR JSON, tolerating shape/casing. A client
 *  mirror of the server reader, used to map a realtime capture_records row optimistically
 *  without a refetch. */
function ocrStr(ocr: unknown, ...keys: string[]): string | null {
  if (!ocr || typeof ocr !== 'object') return null;
  const o = ocr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

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
  initialData,
}: {
  // The New Order data (~4,500 inventory rows) is loaded ON DEMAND when a capture is
  // "Used" — the Orders page no longer ships it eagerly for a strip that is usually
  // empty. Injectable for tests / eager callers.
  initialData?: NewOrderData;
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
  // New Order form data — loaded on demand the first time a capture is "Used", then
  // cached. `preparingUse` is the capture whose data is currently loading.
  const [orderData, setOrderData] = useState<NewOrderData | null>(initialData ?? null);
  const [preparingUse, setPreparingUse] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The capture whose screenshot is mid-send to Messenger (per-row spinner).
  const [sendingId, setSendingId] = useState<string | null>(null);
  // The capture whose operator edits (grams/note) are mid-save (per-row "Save" spinner).
  const [savingId, setSavingId] = useState<string | null>(null);
  // The capture whose AUTO TEXT is being retried (per-row "Retry Auto Text" spinner).
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Operator's grams correction per capture (for the review case + manual reprint),
  // and a short per-row status note ("Printed ✓").
  const [gramsEdits, setGramsEdits] = useState<Record<string, string>>({});
  // Grams (default) vs Fixed Price per capture. The phone/printer already printed the Grams
  // sticker; Fixed Price is a PC-side choice that reprints "FIXED • ₱X".
  const [priceMode, setPriceMode] = useState<Record<string, 'grams' | 'fixed'>>({});
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
      .then((data) => setRows(data))
      .catch(() => undefined);
  }, []);

  // Tell the "Capture Pending" pill the exact live count whenever the list changes.
  // Driven by local state, so it updates the INSTANT a realtime insert/removal lands
  // (Capture Pending 4 → 5) — not only after a server refetch. One source of truth.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(CAPTURE_COUNT_EVENT, { detail: rows.length }));
  }, [rows.length]);

  // Map a raw capture_records realtime row → the strip's row shape so a new capture
  // appears the INSTANT the event arrives — no server round-trip on the appearance path
  // (the spec's "INSERT → prepend row", not "INSERT → refetch all"). The signed
  // screenshot URL + customer join are filled by the debounced reconcile load() that
  // follows; meanwhile the row already shows with its name/grams. Idempotent on id.
  const applyRealtimeRow = useCallback(
    (raw: Record<string, unknown> | null | undefined) => {
      if (!raw) return;
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) return;
      // Mirror listPendingCaptures' filter EXACTLY: a pending floating capture has
      // source 'floating', no linked order, and confirmed still null (jsonb).
      const isPending =
        raw.source === 'floating' &&
        raw.official_order_id === null &&
        raw.confirmed === null;
      if (!isPending) {
        // Used / dismissed / confirmed → it leaves the pending list.
        setRows((cur) => cur.filter((r) => r.captureRecordId !== id));
        return;
      }
      const ocr = raw.ocr;
      setRows((cur) => {
        const prev = cur.find((r) => r.captureRecordId === id);
        const row: PendingCaptureRow = {
          captureRecordId: id,
          capturedAt:
            (typeof raw.captured_at === 'string' ? raw.captured_at : prev?.capturedAt) ??
            new Date().toISOString(),
          // Keep any already-signed thumbnail; a newly-attached screenshot is picked up
          // by the reconcile load() (a signed URL can't be minted on the client).
          screenshotUrl: prev?.screenshotUrl ?? null,
          fbName:
            (sanitizeCaptureName(
              ocrStr(ocr, 'fbName', 'fb_name', 'name'),
              (ocr as { rawLines?: unknown } | null)?.rawLines,
            ) || null) ??
            prev?.fbName ??
            null,
          itemQuery:
            ocrStr(ocr, 'itemQuery', 'item_query', 'item') ?? prev?.itemQuery ?? null,
          grams:
            normalizeGrams(
              ocrStr(ocr, 'grams', 'weight') ??
                ocrStr(ocr, 'itemQuery', 'item_query', 'item'),
            ) ??
            prev?.grams ??
            null,
          // Canonical grams is computed server-side after the exact-comment match; the optimistic
          // realtime row keeps any prior value (the reconcile load() picks up a new one).
          canonicalGrams:
            (typeof raw.canonical_grams === 'string' && raw.canonical_grams.trim()
              ? normalizeGrams(raw.canonical_grams)
              : null) ??
            prev?.canonicalGrams ??
            null,
          isTest: raw.is_test === true,
          linkStatus:
            (raw.link_status as PendingCaptureRow['linkStatus']) ??
            prev?.linkStatus ??
            null,
          linkedCustomerName: prev?.linkedCustomerName ?? null,
          linkedCustomerId:
            (typeof raw.customer_id === 'string'
              ? raw.customer_id
              : prev?.linkedCustomerId) ?? null,
          conversationAvailable:
            (typeof raw.pancake_conversation_id === 'string' &&
              raw.pancake_conversation_id.trim() !== '') ||
            prev?.conversationAvailable ||
            false,
          // A realtime webhook row can't compute media eligibility (that needs a DB lookup) —
          // keep any known value; the reconcile load() fills the accurate one. Fail-safe false.
          photoEligible: prev?.photoEligible ?? false,
          fbUrl: prev?.fbUrl ?? null,
          messageStatus:
            (typeof raw.message_status === 'string'
              ? raw.message_status
              : prev?.messageStatus) ?? null,
          routeReason:
            (typeof raw.route_reason === 'string' && raw.route_reason.trim()
              ? raw.route_reason
              : prev?.routeReason) ?? null,
        };
        return prev
          ? cur.map((r) => (r.captureRecordId === id ? row : r))
          : [row, ...cur];
      });
    },
    [],
  );

  // Load on mount + on every realtime nudge, so a new upload from the phone appears
  // here without a manual refresh (debounced upstream by DashboardSyncProvider).
  useEffect(() => {
    load();
  }, [load, lastSyncedAt]);

  // Realtime (below) is the FAST path — a phone capture appears near-instantly. This
  // interval is only a RECOVERY fallback for when the socket SILENTLY misses an event.
  // It was 30s, so a missed event took up to half a minute to show on the PC ("bumagal"
  // vs the old 2.5s). 5s restores a fast recovery — only ~12 lightweight strip-loads/min
  // from the ~1 open station — while realtime + the reconnect/visibility reconcile below
  // carry the normal case in ~1s, so this timer rarely decides appearance at all.
  useEffect(() => {
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  // FAST PATH (~0.5–1s): a DEDICATED realtime subscription on capture_records fires the
  // instant a phone capture is inserted — independent of the debounced, heavier
  // whole-page router.refresh(). It immediately reloads the strip (the capture appears)
  // AND kicks the auto-print drain (its sticker prints), giving ~1s end-to-end. The 5s
  // poll above stays only as a recovery fallback; realtime carries the normal case.
  // Its own channel (separate from the app-wide DashboardSync one), cleaned up on unmount.
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return; // no browser env — the 5s fallback + DashboardSync still surface captures
    }
    // Authorize the socket with the user's JWT so RLS-filtered capture_records events
    // actually arrive (an unauthorized socket is rejected with 401) — this is what makes
    // a new capture appear + auto-print in ~1s instead of waiting for the 30s fallback.
    const stopRealtimeAuth = authorizeRealtime(supabase);
    // Reconcile = a real server load() to fetch the signed screenshot URL + customer
    // join. Debounced so the insert → OCR → screenshot burst for one capture collapses
    // into a single refetch; the row is already on screen optimistically, so this never
    // sits on the appearance path.
    let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReconcile = () => {
      if (reconcileTimer) clearTimeout(reconcileTimer);
      reconcileTimer = setTimeout(() => {
        reconcileTimer = null;
        load();
      }, 600);
    };
    const channel = supabase
      .channel('incoming-captures-fast')
      // INSERT/UPDATE: update ONLY the affected row from the event payload (no full
      // reload), then kick the auto-print drain and a debounced reconcile.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'capture_records' },
        (payload) => {
          applyRealtimeRow(payload.new);
          drainRef.current?.();
          scheduleReconcile();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'capture_records' },
        (payload) => {
          applyRealtimeRow(payload.new);
          drainRef.current?.();
          scheduleReconcile();
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'capture_records' },
        (payload) => {
          const deletedId = (payload.old as { id?: string } | null)?.id;
          if (deletedId)
            setRows((cur) => cur.filter((r) => r.captureRecordId !== deletedId));
        },
      )
      .subscribe((status) => {
        // Reconcile on first connect AND every reconnect: a socket that dropped and came
        // back would otherwise miss the captures inserted during the gap until the 5s
        // poll. Compared as a string to stay decoupled from the realtime enum typing.
        if (String(status) === 'SUBSCRIBED') load();
      });
    // Self-heal the instant the tab regains focus or the network returns (the common
    // causes of a silently-missed event) so a capture never waits on the timer.
    const onOnline = () => load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (reconcileTimer) clearTimeout(reconcileTimer);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      stopRealtimeAuth();
      void supabase.removeChannel(channel);
    };
  }, [load, applyRealtimeRow]);

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

  // Messaging is fully AUTOMATIC + SERVER-SIDE now (Owner 2026-08-22): the durable Vercel-cron
  // router (/api/cron/capture-autosend) sends Route A (photo) / Route B (secure-link TEXT) with
  // bounded retries and finite states, independent of this tab. The old client retry loop is gone —
  // the strip only DISPLAYS the router's result (message_status + route_reason). No send-on-render.

  // Build the sticker for a capture: Facebook Name / grams • ₱rate/g / Date. The rate
  // ALWAYS comes from Sticker Settings (the pinned comment never carries a price); the
  // grams comes from the OCR (or the operator's correction). Pure — no side effects.
  // Grams vs Fixed Price. The operator's explicit toggle (priceMode) wins; otherwise the mode is
  // AUTO-DETECTED from the OCR'd claim value (".45"/"1.5" → Grams; "15k"/"15000"/"₱15,000" → Fixed).
  // The operator can always flip it — this only sets the initial/default selection.
  const modeOf = (r: PendingCaptureRow): 'grams' | 'fixed' =>
    priceMode[r.captureRecordId] ??
    // A canonical (leading-decimal) correction is always Grams; otherwise auto-detect from the OCR value.
    (r.canonicalGrams ? 'grams' : classifyCaptureValue(r.itemQuery ?? r.grams)) ??
    'grams';

  const stickerFor = (
    r: PendingCaptureRow,
    valueOverride?: string,
    mode: 'grams' | 'fixed' = 'grams',
  ): OrderReceiptData => {
    // A manual reprint uses effectiveGrams: an explicit reprint value wins, else the canonical
    // (comment-proven) grams, else the raw OCR grams. The raw OCR is never mutated.
    const raw = valueOverride ?? r.canonicalGrams ?? r.grams ?? '';
    const base = {
      customerName: (r.fbName ?? '').trim() || '—',
      itemName: '',
      quantity: 1,
      unitPrice: null,
      date: stickerDate(),
    };
    // Fixed Price → "FIXED • ₱X" (no grams × rate); Grams → the usual grams + rate sticker.
    return mode === 'fixed'
      ? { ...base, grams: null, pricePerGram: null, fixedPrice: parseFixedPrice(raw) }
      : {
          ...base,
          grams: normalizeGrams(raw),
          pricePerGram: readStickerPricePerGram() || null,
        };
  };

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
          // Classify the RAW claim value (same rule as the strip + the phone): a Fixed Price
          // ("15k"/"15000"/"₱15,000") prints "FIXED • ₱X"; a real weight prints "Xg • ₱rate/g".
          // (Before, the RPC digit-extracted "15" from "15k" and this always printed grams.)
          const rawValue = claim.value ?? claim.grams;
          const data: OrderReceiptData =
            (classifyCaptureValue(rawValue) ?? 'grams') === 'fixed'
              ? {
                  customerName: claim.fbName || '—',
                  itemName: '',
                  grams: null,
                  quantity: 1,
                  unitPrice: null,
                  pricePerGram: null,
                  fixedPrice: parseFixedPrice(rawValue),
                  date: stickerDate(),
                }
              : {
                  customerName: claim.fbName || '—',
                  itemName: '',
                  grams: normalizeGrams(rawValue),
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
    const mode = modeOf(r);
    const raw = gramsEdits[r.captureRecordId] ?? r.canonicalGrams ?? r.grams ?? '';
    if (mode === 'grams' && normalizeGrams(raw) === null) {
      setError('Enter the weight in grams before printing.');
      return;
    }
    if (mode === 'fixed' && parseFixedPrice(raw) === null) {
      setError('Enter the fixed price before printing.');
      return;
    }
    setError(null);
    try {
      await writeToChannel(
        activeChannel,
        encodeReceipt(stickerFor(r, raw, mode), printLang, readStickerFields()),
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
        // A known-ineligible customer ("Photo waiting") is parked, not failed — show a neutral
        // per-row note pointing to Open FB Chat, never a red "Pancake rejected" error. (Send
        // normally only renders when Photo ready; this guards a race where eligibility flipped.)
        if (res.code === 'awaiting_inbox') {
          setNotes((cur) => ({
            ...cur,
            [r.captureRecordId]: 'Waiting for the customer to message — use Open FB Chat.',
          }));
          return;
        }
        setError(res.error);
        return;
      }
      // HONEST feedback (Owner 2026-08-24): do NOT force a photo-'sent' status. The server set the
      // TRUE message_status (a real photo → 'sent'; a Private Reply TEXT / already-sent → 'link_sent'),
      // and the capture_records realtime UPDATE + reconcile reflect it. Optimistically forcing 'sent'
      // here would fake an "AUTO SS Sent ✓" for a customer whose photo never actually went out. Show
      // the action's own message as a transient note; the status line follows the DB.
      setNotes((cur) => ({ ...cur, [r.captureRecordId]: res.message || 'Sent ✓' }));
    } catch {
      setError('Could not send to Messenger.');
    } finally {
      setSendingId(null);
    }
  };

  // "Retry Auto Text" (Owner 2026-08-24, Issue 1) — re-attempt a FAILED AUTO TEXT, server-side and
  // immediate. Idempotent: a real 'sent'/'link_sent' success is never reopened, so retry can't
  // duplicate. Realtime + the reconcile reload reflect the true outcome.
  const retryAutoText = async (r: PendingCaptureRow) => {
    if (retryingId) return;
    setRetryingId(r.captureRecordId);
    setError(null);
    try {
      const res = await retryCaptureAutoTextAction(r.captureRecordId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRows((cur) =>
        cur.map((x) =>
          x.captureRecordId === r.captureRecordId ? { ...x, messageStatus: 'awaiting_inbox' } : x,
        ),
      );
      setNotes((cur) => ({ ...cur, [r.captureRecordId]: res.message }));
    } catch {
      setError('Could not retry the AUTO TEXT.');
    } finally {
      setRetryingId(null);
    }
  };

  // "Save" — persist the operator's row edits (corrected grams + note) ONLY. Messaging is fully
  // automatic + server-side now, so this NEVER sends anything to Messenger. The saved grams then
  // flows to the sticker and the durable auto-router.
  const saveEdits = async (r: PendingCaptureRow) => {
    if (savingId) return;
    setSavingId(r.captureRecordId);
    setError(null);
    try {
      const grams = gramsEdits[r.captureRecordId] ?? r.canonicalGrams ?? r.grams ?? '';
      const note = notes[r.captureRecordId] ?? '';
      const res = await saveCaptureEditsAction(r.captureRecordId, grams, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Persisted → make the saved grams the row's baseline so the row is no longer "dirty" and the
      // action area returns to the correct state (Send if Photo ready, the sent status, or waiting).
      setRows((cur) =>
        cur.map((x) =>
          x.captureRecordId === r.captureRecordId ? { ...x, grams: grams.trim() } : x,
        ),
      );
      setNotes((cur) => ({ ...cur, [r.captureRecordId]: 'Saved ✓' }));
    } catch {
      setError('Could not save the edits.');
    } finally {
      setSavingId(null);
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

  // "Use" a capture → convert it to a New Order. The form's data is loaded lazily on
  // the first Use (then cached), so the Orders page never ships it eagerly. The New
  // Order modal only opens once the data is present — never on partial data.
  const handleUse = async (r: PendingCaptureRow) => {
    setError(null);
    if (!orderData) {
      setPreparingUse(r.captureRecordId);
      const res = await loadNewOrderDataAction();
      setPreparingUse(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOrderData(res.data);
    }
    setSelected(r);
    setOpen(false);
  };

  const prefillFor = (r: PendingCaptureRow): CapturePrefill => {
    // A REAL claim is a pinned "<Facebook Name> / Mine <grams>" comment — its
    // signal is a confident weight (the "Mine 10.5" number). Without it (a
    // screenshot with no pinned claim, e.g. the app's own screen), we do NOT guess
    // a customer name — the operator types it (Owner request 2026-08-09). The item
    // is ALWAYS chosen by hand: the pinned comment never names one, so it is never
    // pre-filled.
    const hasClaim =
      normalizeGrams(gramsEdits[r.captureRecordId] ?? r.canonicalGrams ?? r.grams ?? '') !== null;
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
          photoEligible: o.photoEligible,
          fbUrl: o.fbUrl,
          matchCount: o.matchCount,
        }
      : {
          linkStatus: r.linkStatus,
          linkedCustomerName: r.linkedCustomerName,
          conversationAvailable: r.conversationAvailable,
          photoEligible: r.photoEligible,
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
                      {/* Grams (default) | Fixed Price. The phone already printed the Grams
                          sticker; switching to Fixed reprints "FIXED • ₱X". */}
                      <div
                        className="inline-flex overflow-hidden rounded-md border border-border"
                        data-testid={`incoming-mode-${r.captureRecordId}`}
                      >
                        {(['grams', 'fixed'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() =>
                              setPriceMode((cur) => ({ ...cur, [r.captureRecordId]: m }))
                            }
                            className={`px-1.5 py-0.5 text-[10px] font-semibold ${
                              modeOf(r) === m
                                ? 'bg-gold text-black'
                                : 'text-muted-foreground hover:bg-accent'
                            }`}
                            data-testid={`incoming-mode-${m}-${r.captureRecordId}`}
                          >
                            {m === 'grams' ? 'Grams' : 'Fixed Price'}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center gap-1 text-muted-foreground">
                        {modeOf(r) === 'fixed' ? 'Price' : 'Grams'}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={gramsEdits[r.captureRecordId] ?? r.canonicalGrams ?? r.grams ?? ''}
                          placeholder={
                            modeOf(r) === 'fixed'
                              ? 'e.g. 12.5 → ₱12,500'
                              : 'e.g. 11.5'
                          }
                          onChange={(e) =>
                            setGramsEdits((cur) => ({
                              ...cur,
                              [r.captureRecordId]: e.target.value,
                            }))
                          }
                          className="h-7 w-24 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-gold"
                          data-testid={`incoming-grams-${r.captureRecordId}`}
                        />
                      </label>
                      {/* Leading-decimal value proven by the EXACT Pancake comment (the raw OCR is
                          preserved). Subtle badge; no auto-reprint. Hidden once the operator edits. */}
                      {r.canonicalGrams &&
                      r.canonicalGrams.trim() !== (r.grams ?? '').trim() &&
                      gramsEdits[r.captureRecordId] === undefined ? (
                        <span
                          className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-600"
                          title={`OCR read "${r.grams ?? '—'}"; the exact Facebook comment proved "${r.canonicalGrams}"`}
                          data-testid={`incoming-corrected-${r.captureRecordId}`}
                        >
                          Corrected ✓
                        </span>
                      ) : null}
                      {modeOf(r) === 'fixed'
                        ? (() => {
                            const fp = parseFixedPrice(
                              gramsEdits[r.captureRecordId] ?? r.canonicalGrams ?? r.grams ?? '',
                            );
                            return fp ? (
                              <span
                                className="font-semibold text-foreground"
                                data-testid={`incoming-fixed-${r.captureRecordId}`}
                              >
                                {formatStickerPeso(fp)}
                              </span>
                            ) : (
                              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                                Needs review
                              </span>
                            );
                          })()
                        : normalizeGrams(
                              gramsEdits[r.captureRecordId] ?? r.canonicalGrams ?? r.grams ?? '',
                            ) === null
                          ? (
                              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-700">
                                Needs review
                              </span>
                            )
                          : null}
                    </div>
                    {/* DEDICATED messaging-status area (Owner 2026-08-22) — the AUTO TEXT/SS delivery
                        status lives HERE, directly UNDER Grams/Price. Statuses ONLY: they NEVER
                        occupy or replace the Send action. Internal router terms (pending / awaiting
                        comment context / sending / backoff) are never shown — only the finite success
                        states, plus transient operator notes (Saved ✓ / Printed ✓). */}
                    {(() => {
                      const autoStatus =
                        r.messageStatus === 'sent'
                          ? 'AUTO SS Sent to Messenger ✓'
                          : r.messageStatus === 'link_sent'
                            ? 'AUTO TEXT Sent to Messenger ✓'
                            : null;
                      // A FINITE failure shows a clear ⚠ state + a Retry action (Owner 2026-08-24,
                      // Issue 1) — never a silent stall. Not for a Test capture (never messages).
                      const autoFailed = r.messageStatus === 'failed' && !r.isTest;
                      const note = notes[r.captureRecordId] ?? null;
                      if (!autoStatus && !note && !autoFailed) return null;
                      return (
                        <div
                          className="mt-1 flex flex-col gap-0.5"
                          data-testid={`incoming-msgstatus-${r.captureRecordId}`}
                        >
                          {autoStatus ? (
                            <span className="text-[11px] font-semibold text-emerald-600">
                              {autoStatus}
                            </span>
                          ) : null}
                          {autoFailed ? (
                            <span className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                              ⚠ AUTO TEXT not sent
                              <button
                                type="button"
                                onClick={() => void retryAutoText(r)}
                                disabled={retryingId === r.captureRecordId}
                                data-testid={`incoming-retry-${r.captureRecordId}`}
                                className="rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground hover:bg-accent"
                              >
                                {retryingId === r.captureRecordId ? 'Retrying…' : '🔄 Retry Auto Text'}
                              </button>
                            </span>
                          ) : null}
                          {note ? (
                            <span className="text-[10px] font-medium text-emerald-600">{note}</span>
                          ) : null}
                        </div>
                      );
                    })()}
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
                    {/* Messaging is AUTOMATIC + server-side. This control only offers 💾 Save (edits
                        only, never sends), a MANUAL 📨 Send Photo when Photo-ready, the finite
                        AUTO SS/TEXT Sent ✓ / Failed status, and the 💬 Open FB Chat fallback. */}
                    <CaptureSendControl
                      captureRecordId={r.captureRecordId}
                      photoEligible={effectiveLink(r).photoEligible}
                      // Manual Send is enabled by a LINKED, messageable chat — independent of the
                      // photo-eligibility (reply) wait (Owner 2026-08-24, Issue 3).
                      chatLinked={
                        effectiveLink(r).linkStatus === 'linked' &&
                        effectiveLink(r).conversationAvailable
                      }
                      hasScreenshot={!!r.screenshotUrl}
                      isTest={r.isTest}
                      sending={sendingId === r.captureRecordId}
                      saving={savingId === r.captureRecordId}
                      messageStatus={r.messageStatus}
                      // Save shows ONLY when the operator has actually changed the grams / Fixed
                      // Price value from what's stored (never a permanent button).
                      dirty={
                        gramsEdits[r.captureRecordId] !== undefined &&
                        (gramsEdits[r.captureRecordId] ?? '').trim() !== (r.grams ?? '').trim()
                      }
                      onSend={() => void sendToMessenger(r)}
                      onSave={() => void saveEdits(r)}
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={preparingUse === r.captureRecordId}
                      onClick={() => void handleUse(r)}
                      data-testid={`incoming-use-${r.captureRecordId}`}
                    >
                      {preparingUse === r.captureRecordId ? 'Loading…' : 'Use'}
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
                        messageStatus={r.messageStatus}
                        onChanged={(res) =>
                          setLinkOverrides((cur) => ({
                            ...cur,
                            [r.captureRecordId]: res,
                          }))
                        }
                        onRecheck={async (id) => {
                          // Re-run the full resolver — it pulls the live post's comments
                          // from Pancake and retries, catching a commenter the realtime
                          // webhook was slow to deliver. Surface an auto-send if it fires.
                          const res = await resolveCaptureLinkAction(id);
                          if (res.ok && res.sent) {
                            setNotes((cur) => ({
                              ...cur,
                              [id]: 'Sent to Messenger ✓',
                            }));
                          }
                          return res;
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      {selected && orderData ? (
        <NewOrderModal
          customers={orderData.customers}
          items={orderData.items}
          walkInItems={orderData.walkInItems}
          admins={orderData.admins}
          prefill={prefillFor(selected)}
          newEntryOnly
          onClose={() => {
            setSelected(null);
            load();
          }}
        />
      ) : null}
    </>
  );
}
