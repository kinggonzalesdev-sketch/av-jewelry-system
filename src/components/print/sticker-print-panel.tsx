'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_STICKER_FIELDS,
  printOrderReceipt,
  stickerDate,
  stickerLineItems,
  type OrderReceiptData,
  type StickerField,
  type StickerFields,
} from '@/lib/print/order-receipt';
import {
  readStickerPricePerGram,
  writeStickerFields,
  writeStickerPricePerGram,
} from '@/lib/print/sticker-fields';
import {
  loadStickerSettingsAction,
  saveStickerSettingsAction,
} from '@/lib/print/sticker-settings-actions';
import { usePrinter } from '@/components/print/printer-context';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import { Button } from '@/components/ui/button';

/**
 * Live Operations → Sticker Settings & Test Print (Owner redesign 2026-08-18).
 *
 * A compact, dark-mode admin panel that UNIFIES the old "Test Print" and "Sticker Settings"
 * cards: a header with a live connection pill, one settings row (Format · Channel · Auto Print),
 * a 55/45 Sticker Content | Sticker Preview split, ONE primary Test Print action (+ a subtle
 * browser fallback), and one Save. Presentation only — every printer/Bluetooth/save/print
 * function is REUSED unchanged (usePrinter, writeToChannel/encodeReceipt, printOrderReceipt,
 * loadStickerSettingsAction/saveStickerSettingsAction, the shared ₱/gram + auto-print flags).
 */

// The sticker layout is FIXED (Owner): Facebook Name + Price per gram + Date; no item/price.
const STICKER_FIELDS: StickerFields = {
  ...DEFAULT_STICKER_FIELDS,
  name: true,
  pricePerGram: true,
  date: true,
  item: false,
  price: false,
};

// Preview-only sample — the real sticker always uses the capture's own pinned name + grams.
const SAMPLE_NAME = 'KING GONZALES';
const SAMPLE_GRAMS = '11.5';

/** On-screen preview font per field (scaled to the 40×30 preview box). */
const PREVIEW_FONT: Record<StickerField, { size: number; weight: number }> = {
  name: { size: 22, weight: 800 },
  item: { size: 19, weight: 700 },
  price: { size: 22, weight: 800 },
  pricePerGram: { size: 22, weight: 800 },
  date: { size: 15, weight: 500 },
};

// The same shared flag the Incoming Captures strip reads to auto-print a landed capture.
const AUTO_PRINT_KEY = 'mineflow.captureAutoPrint';

export function StickerPrintPanel() {
  const {
    supported,
    adapterAvailable,
    printer,
    activeChannel,
    channelIdx,
    setChannelIdx,
    printLang,
    setPrintLang,
    connecting,
    error,
    connect,
  } = usePrinter();

  const [pricePerGram, setPricePerGram] = useState('7500');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [printMsg, setPrintMsg] = useState<string | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);

  // Seed the rate from the local cache, then apply the ONE shared server rate. Auto Print
  // defaults ON (seed the flag if unset) — its toggle now reflects/persists the shared flag.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPricePerGram(readStickerPricePerGram());
    try {
      if (localStorage.getItem(AUTO_PRINT_KEY) == null) {
        localStorage.setItem(AUTO_PRINT_KEY, '1');
      }
      setAutoPrint(localStorage.getItem(AUTO_PRINT_KEY) !== '0');
    } catch {
      /* storage unavailable — non-fatal */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    let alive = true;
    void loadStickerSettingsAction()
      .then((s) => {
        if (alive) setPricePerGram(s.pricePerGram);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const toggleAutoPrint = () => {
    setAutoPrint((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_PRINT_KEY, next ? '1' : '0');
      } catch {
        /* non-fatal */
      }
      return next;
    });
  };

  const changePricePerGram = (v: string) => {
    setPricePerGram(v);
    setSaveMsg(null);
  };

  // Save the ₱/gram rate (+ the fixed fields) to this device's cache AND the shared server
  // config, so the SAME rate applies on every account/device. (Unchanged save logic.)
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg(null);
    writeStickerFields(STICKER_FIELDS);
    writeStickerPricePerGram(pricePerGram);
    const res = await saveStickerSettingsAction({
      showName: true,
      showPricePerGram: true,
      showDate: true,
      pricePerGram,
    });
    setSaving(false);
    setSaveMsg(res.ok ? 'Sticker settings saved.' : res.error);
  };

  const sample: OrderReceiptData = {
    customerName: SAMPLE_NAME,
    itemName: '',
    grams: SAMPLE_GRAMS,
    quantity: 1,
    unitPrice: null,
    pricePerGram: pricePerGram.trim() || null,
    date: stickerDate(),
  };
  const lines = stickerLineItems(sample, STICKER_FIELDS);

  // ONE Test Print — prints EXACTLY the previewed sticker over Bluetooth when linked, else the
  // browser dialog. (Consolidates the old "Print sample sticker" + "Print this preview".)
  const printTest = async () => {
    setPrintMsg(null);
    if (activeChannel) {
      try {
        await writeToChannel(activeChannel, encodeReceipt(sample, printLang, STICKER_FIELDS));
        setPrintMsg(`Test sticker sent${printer ? ` to ${printer.deviceName}` : ''}.`);
      } catch (err) {
        setPrintMsg(
          err instanceof Error
            ? `Printer unavailable: ${err.message}. Try Browser Print Fallback.`
            : 'Printer unavailable. Try Browser Print Fallback.',
        );
      }
    } else {
      printOrderReceipt(sample, STICKER_FIELDS);
      setPrintMsg('Opened the browser print dialog.');
    }
  };

  // Subtle secondary — always the browser dialog (works even without Bluetooth).
  const printBrowser = () => {
    printOrderReceipt(sample, STICKER_FIELDS);
    setPrintMsg('Opened the browser print dialog.');
  };

  const adapterOff = supported && adapterAvailable === false;
  const disconnectedNote = adapterOff
    ? "This device's Bluetooth is off."
    : supported
      ? 'No printer linked on this device.'
      : 'Web Bluetooth unavailable here — use the browser fallback.';

  return (
    <div className="space-y-4">
      {/* 1 — HEADER with the live connection pill */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-lg">
            🖨
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Sticker Settings &amp; Test Print
            </h2>
            <p className="text-xs text-muted-foreground">Live Operations</p>
          </div>
        </div>
        {printer ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {printer.deviceName} Connected
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void connect()}
            disabled={connecting}
          >
            {connecting ? 'Connecting…' : 'Connect printer'}
          </Button>
        )}
      </div>

      {/* 2 — PRINTER CONTROLS: Format · Channel · Auto Print */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Format</p>
            <div className="flex gap-2">
              <FormatOption
                label="Label (TSPL)"
                active={printLang === 'tspl'}
                onClick={() => setPrintLang('tspl')}
              />
              <FormatOption
                label="Receipt (ESC/POS)"
                active={printLang === 'escpos'}
                onClick={() => setPrintLang('escpos')}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Channel</p>
            <select
              value={channelIdx}
              onChange={(e) => setChannelIdx(Number(e.target.value))}
              disabled={!printer || printer.channels.length === 0}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-gold disabled:opacity-50"
            >
              {printer && printer.channels.length > 0 ? (
                printer.channels.map((c, i) => (
                  <option key={c.uuid} value={i}>
                    {i + 1}. {c.uuid.slice(0, 8)}…
                  </option>
                ))
              ) : (
                <option value={0}>—</option>
              )}
            </select>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Auto Print</p>
            <button
              type="button"
              role="switch"
              aria-checked={autoPrint}
              onClick={toggleAutoPrint}
              data-testid="sticker-auto-print"
              className="inline-flex items-center gap-2"
            >
              <span
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  autoPrint ? 'bg-emerald-500' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    autoPrint ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </span>
              <span className="text-sm font-medium text-foreground">
                {autoPrint ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* 3 — TWO-COLUMN CONTENT: Sticker Content (55%) | Sticker Preview (45%) */}
      <div className="grid gap-4 lg:grid-cols-[11fr_9fr]">
        {/* LEFT — Sticker Content */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <span aria-hidden>📄</span> Sticker Content
            </h3>
            <p className="text-xs text-muted-foreground">
              These fields are used on every sticker.
            </p>
          </div>

          <div className="space-y-2">
            <FieldRow icon="f" label="Facebook Name" note="From the pinned comment." badge="FIXED" />

            <FieldRow icon="₱" label="Price per gram" note="Applied to all accounts." badge="EDITABLE">
              <label className="block">
                <span className="mb-1 block text-[11px] text-muted-foreground">₱ / gram</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={pricePerGram}
                  onChange={(e) => changePricePerGram(e.target.value)}
                  data-testid="sticker-price-per-gram"
                  className="h-9 w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-gold"
                />
              </label>
            </FieldRow>

            <FieldRow icon="📅" label="Date" note="Print date." badge="FIXED" />
          </div>
        </div>

        {/* RIGHT — Sticker Preview + the single Test Print action */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-4">
          <div className="mb-3">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <span aria-hidden>👁</span> Sticker Preview
            </h3>
            <p className="text-xs text-muted-foreground">40 × 30 mm</p>
          </div>

          <div
            className="mx-auto flex flex-col items-center justify-center gap-1 rounded-md border border-border bg-white px-3 text-center text-black"
            style={{ width: 230, height: 172 }}
            data-testid="sticker-preview"
          >
            {lines.length === 0 ? (
              <span className="text-xs text-neutral-400">No fields</span>
            ) : (
              lines.map((l, i) => (
                <div
                  key={`${l.kind}-${i}`}
                  style={{
                    fontSize: PREVIEW_FONT[l.kind].size,
                    fontWeight: PREVIEW_FONT[l.kind].weight,
                    lineHeight: 1.15,
                    maxWidth: '100%',
                    overflowWrap: 'break-word',
                  }}
                >
                  {l.text}
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex flex-col items-center gap-1.5">
            <Button
              type="button"
              onClick={() => void printTest()}
              data-testid="sticker-print-preview"
              className="w-full max-w-[230px]"
            >
              🖨 Print Test Sticker
            </Button>
            <button
              type="button"
              onClick={printBrowser}
              className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Browser Print Fallback
            </button>
          </div>

          {printMsg ? (
            <p className="mt-2 text-center text-[11px] text-foreground">{printMsg}</p>
          ) : !printer ? (
            <p className="mt-2 text-center text-[11px] text-muted-foreground">{disconnectedNote}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-1 text-center text-[11px] text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      {/* 4 — SAVE action bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          data-testid="sticker-save"
        >
          {saving ? 'Saving…' : '💾 Save for all accounts'}
        </Button>
        {saveMsg ? (
          <span
            className="text-xs font-medium text-emerald-600"
            data-testid="sticker-save-msg"
          >
            {saveMsg}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Applies to all accounts and devices.</span>
        )}
      </div>
    </div>
  );
}

/** A selectable Format pill (radio-card look). */
function FormatOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? 'border-emerald-500/60 bg-emerald-500/10 text-foreground'
          : 'border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      <span
        className={`h-3.5 w-3.5 rounded-full border ${
          active ? 'border-emerald-500 bg-emerald-500' : 'border-muted-foreground'
        }`}
      />
      {label}
    </button>
  );
}

/** A Sticker Content row: icon chip · label + note · badge, with an optional editable control. */
function FieldRow({
  icon,
  label,
  note,
  badge,
  children,
}: {
  icon: string;
  label: string;
  note: string;
  badge: 'FIXED' | 'EDITABLE';
  children?: React.ReactNode;
}) {
  const editable = badge === 'EDITABLE';
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-background/50 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
              editable
                ? 'bg-emerald-500/15 text-emerald-500'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {badge}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">{note}</p>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}
