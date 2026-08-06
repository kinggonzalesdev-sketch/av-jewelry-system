'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_STICKER_FIELDS,
  stickerDate,
  stickerLineItems,
  type OrderReceiptData,
  type StickerField,
  type StickerFields,
} from '@/lib/print/order-receipt';
import { readStickerFields, writeStickerFields } from '@/lib/print/sticker-fields';

/**
 * Sticker Settings + live preview. The operator picks which lines print (Facebook
 * name, item, price, price per gram, date) and sees a live preview of the exact
 * sticker. The choice is stored per device and read by every print path (New Order,
 * Test Print, and the future auto-print), so what you see here is what prints.
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

  const sample: OrderReceiptData = {
    customerName: 'KING GONZALES',
    itemName: 'K18 HK ITEM RING',
    grams: '1.40',
    quantity: 1,
    unitPrice: '37500',
    pricePerGram: '26785',
    date: stickerDate(),
  };
  const lines = stickerLineItems(sample, fields);

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
      </div>
    </div>
  );
}
