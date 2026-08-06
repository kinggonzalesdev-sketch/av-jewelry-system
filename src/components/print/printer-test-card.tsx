'use client';

import { useState } from 'react';

import { usePrinter } from '@/components/print/printer-context';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import {
  printOrderReceipt,
  stickerDate,
  type OrderReceiptData,
} from '@/lib/print/order-receipt';
import { Button } from '@/components/ui/button';

/**
 * Test Print (pre-live). Prints a REAL sample sticker — the exact Customer / Item /
 * Price / Date layout the live will use — so the operator confirms the XP-236B
 * actually prints the real output before going live, not just a generic pattern.
 *
 * Prints over the shared Bluetooth connection when linked; otherwise opens the
 * browser print dialog as a fallback (the same fallback the live uses when Bluetooth
 * isn't reachable — e.g. a Classic-SPP printer that Web Bluetooth can't touch).
 */
export function PrinterTestCard() {
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
  const [result, setResult] = useState<string | null>(null);

  const sample = (): OrderReceiptData => ({
    customerName: 'KING GONZALES',
    itemName: 'K18 HK ITEM RING',
    grams: null,
    quantity: 1,
    unitPrice: '37500',
    date: stickerDate(),
  });

  const printBluetooth = async () => {
    if (!activeChannel) return;
    setResult(null);
    try {
      await writeToChannel(activeChannel, encodeReceipt(sample(), printLang));
      setResult(
        'Sent the sample sticker to the printer. Did it print correctly? If nothing came out, try another Channel or Format below, or use the browser dialog.',
      );
    } catch (err) {
      setResult(err instanceof Error ? `Write failed: ${err.message}` : 'Write failed.');
    }
  };

  const printBrowser = () => {
    setResult('Opening the browser print dialog — choose the 40×30 mm printer, then Print.');
    printOrderReceipt(sample());
  };

  const adapterOff = supported && adapterAvailable === false;

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {printer ? (
          <span className="font-medium text-gold-strong">
            {printer.deviceName} connected.
          </span>
        ) : adapterOff ? (
          'This device’s Bluetooth is off. Turn it on, then link the printer.'
        ) : supported ? (
          'No printer linked yet on this device.'
        ) : (
          'Web Bluetooth isn’t available here (use Chrome/Edge on a PC, or Chrome on Android). You can still test with the browser print dialog.'
        )}
      </div>

      {/* Link the printer (Bluetooth) — same shared connection the live uses. */}
      {supported && !printer ? (
        <Button type="button" size="sm" onClick={() => void connect()} disabled={connecting}>
          {connecting ? 'Connecting…' : 'Connect printer'}
        </Button>
      ) : null}

      {/* Once linked: format + channel + the real sample print. */}
      {printer ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>Format:</span>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="testprint-lang"
                checked={printLang === 'tspl'}
                onChange={() => setPrintLang('tspl')}
              />
              Label (TSPL)
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="testprint-lang"
                checked={printLang === 'escpos'}
                onChange={() => setPrintLang('escpos')}
              />
              Receipt (ESC/POS)
            </label>
          </div>
          {printer.channels.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>Channel:</span>
              <select
                value={channelIdx}
                onChange={(e) => setChannelIdx(Number(e.target.value))}
                className="h-7 max-w-[180px] rounded border border-input bg-background px-1 text-[11px]"
              >
                {printer.channels.map((c, i) => (
                  <option key={c.uuid} value={i}>
                    {i + 1}. {c.uuid.slice(0, 8)}…
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <Button type="button" size="sm" onClick={() => void printBluetooth()}>
            🖨 Print sample sticker
          </Button>
        </div>
      ) : null}

      {/* Browser-dialog fallback — always available (works even without Bluetooth). */}
      <div>
        <Button type="button" size="sm" variant="outline" onClick={printBrowser}>
          Print via browser dialog (fallback)
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="text-xs text-foreground">
          {result}
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        The sample prints as: <span className="font-medium">KING GONZALES · K18 HK ITEM
        RING · ₱37,500 · {stickerDate()}</span> — centered, one 40×30 mm label.
      </p>
    </div>
  );
}
