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
import { readStickerFields, writeStickerFields } from '@/lib/print/sticker-fields';
import { usePrinter } from '@/components/print/printer-context';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import { Button } from '@/components/ui/button';

/**
 * Sticker Settings + editable live preview. The operator picks which lines print
 * (Facebook name, item, price, price per gram, date) AND can type their own sample
 * text to see exactly how it looks (e.g. a long name). The field choice is stored per
 * device and read by every print path (New Order, Test Print, auto-print), so what
 * you see is what prints. The sample text is only for the preview — the real print
 * uses the order's own values.
 */

const FIELD_LABELS: { key: StickerField; label: string }[] = [
  { key: 'name', label: 'Facebook Name' },
  { key: 'item', label: 'Item Name' },
  { key: 'price', label: 'Price' },
  { key: 'pricePerGram', label: 'Price per gram' },
  { key: 'date', label: 'Date' },
];

/** On-screen preview font per field (scaled to the small preview box). */
const PREVIEW_FONT: Record<StickerField, { size: number; weight: number }> = {
  name: { size: 21, weight: 800 },
  item: { size: 19, weight: 700 },
  price: { size: 21, weight: 800 },
  pricePerGram: { size: 21, weight: 800 },
  date: { size: 16, weight: 500 },
};

export function StickerSettingsCard() {
  const [fields, setFields] = useState<StickerFields>(DEFAULT_STICKER_FIELDS);

  // Read the stored preference on the client (avoids an SSR/hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFields(readStickerFields());
  }, []);

  const toggle = (k: StickerField) => {
    setFields((cur) => {
      const next = { ...cur, [k]: !cur[k] };
      writeStickerFields(next);
      return next;
    });
  };

  // Editable sample values (preview only — not stored, not what really prints).
  const [name, setName] = useState('KING GONZALES');
  const [item, setItem] = useState('K18 HK ITEM RING');
  const [grams, setGrams] = useState('1.40');
  const [price, setPrice] = useState('37500');
  const [perGram, setPerGram] = useState('26785');

  const { activeChannel, printLang } = usePrinter();
  const [printMsg, setPrintMsg] = useState<string | null>(null);

  const sample: OrderReceiptData = {
    customerName: name.trim() || '—',
    itemName: item.trim() || '—',
    grams: grams.trim() || null,
    quantity: 1,
    unitPrice: price.trim() || null,
    pricePerGram: perGram.trim() || null,
    date: stickerDate(),
  };
  const lines = stickerLineItems(sample, fields);

  // Print EXACTLY the previewed sample (same sample + fields), so what you see prints.
  const printPreview = async () => {
    setPrintMsg(null);
    if (activeChannel) {
      try {
        await writeToChannel(activeChannel, encodeReceipt(sample, printLang, fields));
        setPrintMsg('Sent this exact preview to the printer.');
      } catch (err) {
        setPrintMsg(err instanceof Error ? `Write failed: ${err.message}` : 'Write failed.');
      }
    } else {
      printOrderReceipt(sample, fields);
      setPrintMsg('Opened the browser print dialog for this preview.');
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">Show on the sticker:</p>
        {FIELD_LABELS.map(({ key, label }) => (
          <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fields[key]}
              onChange={() => toggle(key)}
              data-testid={`sticker-field-${key}`}
            />
            {label}
          </label>
        ))}
        <p className="max-w-[15rem] pt-1 text-[11px] text-muted-foreground">
          Saved on this device. Every print (New Order, Test Print, auto-print) uses
          exactly these fields.
        </p>
      </div>

      {/* Editable sample — type your own text to see how it looks (preview only). */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Sample text (preview only):</p>
        <SampleInput label="Facebook Name" value={name} onChange={setName} />
        <SampleInput label="Item Name" value={item} onChange={setItem} />
        <SampleInput label="Grams" value={grams} onChange={setGrams} />
        <SampleInput label="Price" value={price} onChange={setPrice} />
        <SampleInput label="Price / gram" value={perGram} onChange={setPerGram} />
        <p className="max-w-[14rem] pt-0.5 text-[11px] text-muted-foreground">
          This is just for the preview — the real sticker uses the order’s own values.
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
