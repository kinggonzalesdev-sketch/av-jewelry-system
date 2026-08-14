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
  writeStickerFields,
  readStickerPricePerGram,
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
 * Sticker Settings — deliberately minimal (Owner request 2026-08-13). Every sticker ALWAYS
 * prints exactly three lines: Facebook Name + Price per gram + Date. Those are FIXED (not
 * toggles) because the pinned comment supplies the real name + grams at print time. The
 * ONLY thing anyone ever edits here is the ₱/gram RATE. Auto-print is ON by default. The
 * fixed fields + rate are read by every print path (New Order, Test Print, auto-print), so
 * what you see is what prints.
 */

// The sticker layout is FIXED: name + price-per-gram + date on; item + price off.
const STICKER_FIELDS: StickerFields = {
  ...DEFAULT_STICKER_FIELDS,
  name: true,
  pricePerGram: true,
  date: true,
  item: false,
  price: false,
};

// The three fixed lines, shown as locked "Always on" rows.
const FIXED_LINES: { key: StickerField; label: string; note: string }[] = [
  { key: 'name', label: 'Facebook Name', note: 'From the pinned comment — auto.' },
  { key: 'pricePerGram', label: 'Price per gram', note: 'Uses the ₱/gram rate on the right.' },
  { key: 'date', label: 'Date', note: 'Print date — auto.' },
];

// Preview-only sample values — the real sticker always uses the capture's own name + grams.
const SAMPLE_NAME = 'KING GONZALES';
const SAMPLE_GRAMS = '11.5';

/** On-screen preview font per field (scaled to the small preview box). */
const PREVIEW_FONT: Record<StickerField, { size: number; weight: number }> = {
  name: { size: 21, weight: 800 },
  item: { size: 19, weight: 700 },
  price: { size: 21, weight: 800 },
  pricePerGram: { size: 21, weight: 800 },
  date: { size: 16, weight: 500 },
};

export function StickerSettingsCard() {
  // THE ONE editable value: the saved ₱/gram rate used by every print (incl. the
  // screenshot-to-print auto-print — the pinned comment never carries a price).
  const [pricePerGram, setPricePerGram] = useState('7500');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Seed the rate instantly from the local cache, then apply the ONE shared server rate.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setPricePerGram(readStickerPricePerGram());
    /* eslint-enable react-hooks/set-state-in-effect */
    try {
      // Auto-print is FIXED on — force-enable the shared flag the Incoming Captures strip
      // reads, so every station auto-prints without anyone toggling it.
      localStorage.setItem('mineflow.captureAutoPrint', '1');
    } catch {
      /* storage unavailable — non-fatal */
    }
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

  const changePricePerGram = (v: string) => {
    setPricePerGram(v);
    setSaveMsg(null);
  };

  // Save the ₱/gram rate (the fixed fields go along) to this device's cache AND the shared
  // server config, so the SAME rate applies on every account/device.
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
    setSaveMsg(res.ok ? 'Saved — applies to all accounts.' : res.error);
  };

  const { activeChannel, printLang } = usePrinter();
  const [printMsg, setPrintMsg] = useState<string | null>(null);

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

  // Print EXACTLY the previewed sample (same sample + fixed fields), so what you see prints.
  const printPreview = async () => {
    setPrintMsg(null);
    if (activeChannel) {
      try {
        await writeToChannel(
          activeChannel,
          encodeReceipt(sample, printLang, STICKER_FIELDS),
        );
        setPrintMsg('Sent this exact preview to the printer.');
      } catch (err) {
        setPrintMsg(
          err instanceof Error ? `Write failed: ${err.message}` : 'Write failed.',
        );
      }
    } else {
      printOrderReceipt(sample, STICKER_FIELDS);
      setPrintMsg('Opened the browser print dialog for this preview.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-6">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Always on the sticker:</p>
          {/* All three lines are FIXED on — they can't be turned off. The real name + grams
              come from the pinned comment at print time; you never edit them here. */}
          {FIXED_LINES.map((f) => (
            <div key={f.key}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked
                  disabled
                  data-testid={`sticker-field-${f.key}`}
                />
                <span className="flex items-center gap-1.5">
                  {f.label}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Always on
                  </span>
                </span>
              </label>
              <p className="max-w-[15rem] pl-6 text-[10px] text-muted-foreground">{f.note}</p>
            </div>
          ))}
          <p className="max-w-[15rem] pt-1 text-[11px] text-muted-foreground">
            These are fixed. The <strong>only</strong> thing you ever change is the ₱/gram
            rate → then press <strong>Save</strong> to apply it to ALL accounts.
          </p>
        </div>

        <div className="space-y-2.5">
          {/* THE ONE editable value — the ₱/gram rate used by every print. */}
          <div className="space-y-1.5 rounded-md border border-gold/40 bg-gold/5 px-3 py-2">
            <p className="text-xs font-semibold text-gold-strong">
              Price per gram — the only value you edit
            </p>
            <SampleInput label="₱ / gram" value={pricePerGram} onChange={changePricePerGram} />
            <p className="max-w-[15rem] text-[11px] text-muted-foreground">
              Printed as{' '}
              <strong>
                {SAMPLE_GRAMS}g • {pricePerGram.trim() ? `₱${pricePerGram.trim()}` : '₱—'}/g
              </strong>
              . Used even when the captured comment has no price.
            </p>
          </div>

          <p className="max-w-[15rem] text-[11px] text-muted-foreground">
            The preview uses a sample name + grams just to show the layout — the real sticker
            always uses the capture’s own Facebook name and grams.
          </p>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Preview (40×30 mm)</p>
          <div
            className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-border bg-white px-2 text-center text-black"
            style={{ width: 210, height: 158 }}
            data-testid="sticker-preview"
          >
            {lines.length === 0 ? (
              <span className="text-xs text-neutral-400">No fields selected</span>
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
          <Button
            type="button"
            size="sm"
            onClick={() => void printPreview()}
            className="mt-2"
            data-testid="sticker-print-preview"
          >
            🖨 Print this preview
          </Button>
          {printMsg ? (
            <p className="mt-1 max-w-[210px] text-[11px] text-foreground">{printMsg}</p>
          ) : null}
        </div>
      </div>

      {/* Save the ₱/gram rate — applies to EVERY account/device, not just this one. */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={saving}
          data-testid="sticker-save"
        >
          {saving ? 'Saving…' : '💾 Save for all accounts'}
        </Button>
        {saveMsg ? (
          <span
            className="text-[11px] font-medium text-emerald-600"
            data-testid="sticker-save-msg"
          >
            {saveMsg}
          </span>
        ) : null}
      </div>

      {/* Auto Print is FIXED on (Owner request 2026-08-13) — locked, no toggle, no text. A
          capture's sticker prints automatically on this PC's connected printer the moment it
          lands. Forced enabled in storage on mount. */}
      <label className="flex flex-wrap items-center gap-2 rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-sm">
        <input type="checkbox" checked disabled data-testid="sticker-auto-print" />
        <span className="flex items-center gap-1.5 font-medium">
          Auto Print
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Always on
          </span>
        </span>
      </label>
    </div>
  );
}

function SampleInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-40 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-gold"
      />
    </label>
  );
}
