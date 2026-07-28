'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState } from 'react';

import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import {
  captureManualOrderAction,
  captureWalkInOrderAction,
  recordOrderPrintAction,
} from '@/lib/orders/actions';
import {
  EMPTY_MANUAL_ORDER_STATE,
  type ManualOrderState,
} from '@/lib/orders/manual-order-state';
import { EMPTY_WALKIN_STATE, type WalkInOrderState } from '@/lib/orders/walkin-state';
import {
  printOrderReceipt,
  stickerDate,
  type OrderReceiptData,
} from '@/lib/print/order-receipt';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeReceipt } from '@/lib/print/receipt-encoders';
import { usePrinter } from '@/components/print/printer-context';
import { PhotoCapture } from '@/components/attachments/photo-capture';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';
import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Orders "New Order" control + the New Order form (reference mockup).
 *
 * Only the New Order action lives here. The earlier Invoice / Confirm / Layaway
 * shortcut buttons (and the separate "New Entry → /live" header link) were
 * removed by Owner request (2026-07-18) — they duplicated the sidebar navigation
 * (Invoice, Payments & Layaway) and the capture entry. Capture now has ONE entry:
 * this New Order form.
 *
 * The New Order form is Manual Post-Live Entry. Confirm Order follows the Owner's
 * required flow: validate → SAVE the order → PRINT → land in For Invoice. It saves
 * a real OFFICIAL ORDER directly into `For Invoice` (invoiced) via the guarded
 * captureManualOrder → create_new_order, reserves the item to that order, then
 * prints the label. The order is ALWAYS saved before printing, so a print failure
 * never deletes or duplicates it — it just shows "Order saved, but printing failed.
 * You can reprint this order." with a Reprint action. Repeated clicks cannot
 * create a duplicate (the button locks after the save and the item is reserved).
 * Shop and Salesperson are the caller's real session identity. Customer and Item
 * are pick-OR-type: choose an existing record, or type a new one (created on
 * confirm). Unit Price is editable; the entered price is applied to the item.
 * Walk-In sales are a SEPARATE mode that completes instantly to Completed.
 */

type Customer = { id: string; displayName: string };

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold';

/**
 * Walk-In sale form: Name · Item · Price · Grams · Mode of Payment · Date.
 * Accepting completes the sale instantly and retires the item to Completed
 * inventory (Owner 2026-07-25). On success it shows a confirmation with the
 * order number; Done refreshes the lists and closes.
 */
function WalkInBody({
  today,
  state,
  submit,
  onDone,
  items,
  customers,
}: {
  today: string;
  state: WalkInOrderState;
  submit: (fd: FormData) => void;
  onDone: () => void;
  items: WalkInItem[];
  customers: Customer[];
}) {
  // Searchable selector over Active Inventory. Selection is by the item's
  // permanent ID (never the name); only a matched item can be sold.
  const [itemInput, setItemInput] = useState('');
  // Customer is pick-OR-type: the typed/selected text is the submitted name.
  const [customerInput, setCustomerInput] = useState('');
  // Price is manually editable; Price per Gram (optional) fills it from the item's
  // grams. Controlled so the per-gram helper can write into it.
  const [priceInput, setPriceInput] = useState('');
  const [perGramInput, setPerGramInput] = useState('');
  const label = (i: WalkInItem) =>
    `${i.itemCode}${i.facebookName ? ` — ${i.facebookName}` : ''}`;
  const matched = items.find((i) => label(i) === itemInput.trim()) ?? null;
  const typedButUnmatched = itemInput.trim().length > 0 && !matched;

  if (state.order) {
    return (
      <div className="space-y-3" data-testid="walkin-success">
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-3">
          <p className="text-sm font-semibold">Walk-in sale completed</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Order <strong>{state.order.orderNumber}</strong> · Invoice{' '}
            {state.order.invoiceNumber}. The item was retired to Completed inventory.
          </p>
        </div>
        <Button type="button" onClick={onDone} className="w-full">
          Done
        </Button>
      </div>
    );
  }

  return (
    <form id="walkin-form" action={submit} className="space-y-3">
      <label className="block">
        <L>Name</L>
        <Combobox
          name="customerName"
          required
          className={fieldClass}
          placeholder="Select a customer… or type a new name"
          value={customerInput}
          onChange={setCustomerInput}
          options={customers.map((c) => c.displayName)}
        />
      </label>
      <label className="block">
        <L>Item</L>
        <Combobox
          required
          className={fieldClass}
          placeholder="Search Active Inventory by code or Facebook name…"
          value={itemInput}
          onChange={setItemInput}
          options={items.map((i) => label(i))}
        />
        <input type="hidden" name="inventoryItemId" value={matched?.id ?? ''} />
        <p className="mt-1 text-[10px] text-muted-foreground">
          {matched
            ? 'Item selected from Active Inventory.'
            : typedButUnmatched
              ? 'Pick an item from the list — only Active Inventory items can be sold.'
              : 'Only Available items show (reserved / completed / deleted are excluded).'}
        </p>
      </label>
      <label className="block">
        <L>Price per Gram (optional)</L>
        <MoneyInput
          className={cn(fieldClass, 'text-right tabular-nums')}
          placeholder="e.g. 250"
          value={perGramInput}
          onValueChange={(v) => {
            setPerGramInput(v);
            const unit = unitPriceFromPerGram(v, matched?.grams ?? '');
            if (unit) setPriceInput(unit);
          }}
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Fills Price (item grams × price/gram). You can still edit Price manually.
        </p>
      </label>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <label className="block">
          <L>Price</L>
          <MoneyInput
            name="price"
            required
            className={cn(fieldClass, 'text-right tabular-nums')}
            placeholder="0.00"
            value={priceInput}
            onValueChange={setPriceInput}
          />
        </label>
        <label className="block">
          <L>Grams</L>
          {/* Auto-filled from the selected item and READ-ONLY (synced, not typed). */}
          <input
            className={cn(fieldClass, 'bg-muted/40 text-right tabular-nums')}
            readOnly
            value={matched ? (matched.grams ? `${matched.grams}g` : '—') : ''}
            placeholder="Auto-filled from the item"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <label className="block">
          <L>Mode of Payment</L>
          <select name="paymentMethod" defaultValue="cash" className={fieldClass}>
            <option value="cash">Cash</option>
            <option value="e_wallet">E-Wallet (GCash / Maya)</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="card">Card</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block">
          <L>Date</L>
          <input
            name="saleDate"
            type="date"
            defaultValue={today}
            className={fieldClass}
          />
        </label>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      ) : null}
      <p className="rounded-lg border border-dashed border-border p-2 text-[11px] text-muted-foreground">
        Accepting records a <strong>fully-paid, Completed</strong> sale immediately and
        moves the item from Active Inventory into <strong>Completed Items</strong>. This
        cannot be undone here.
      </p>
    </form>
  );
}

/**
 * Unit price from price-per-gram × grams, computed in EXACT integer units (never a
 * float): price/gram → centavos (×100), grams → milligrams (×1000), so unit
 * centavos = perGramCentavos × grams-milli / 1000, rounded to the nearest centavo.
 * Returns a raw "x.xx" string, or '' when either input is empty/invalid.
 */
function unitPriceFromPerGram(perGram: string, grams: string): string {
  const pg = perGram.trim();
  const g = grams.trim();
  if (!pg || !g || !/^\d*\.?\d*$/.test(pg) || !/^\d*\.?\d*$/.test(g)) return '';
  const [pw = '0', pf = ''] = pg.split('.');
  const [gw = '0', gf = ''] = g.split('.');
  const perGramCentavos = BigInt(pw || '0') * 100n + BigInt(`${pf}00`.slice(0, 2) || '0');
  const gramsMilli = BigInt(gw || '0') * 1000n + BigInt(`${gf}000`.slice(0, 3) || '0');
  if (perGramCentavos === 0n || gramsMilli === 0n) return '';
  const unitCentavos = (perGramCentavos * gramsMilli + 500n) / 1000n;
  return `${unitCentavos / 100n}.${String(unitCentavos % 100n).padStart(2, '0')}`;
}

function NewOrderModal({
  customers,
  items,
  walkInItems,
  shopName,
  salesperson,
  onClose,
}: {
  customers: Customer[];
  items: CaptureItem[];
  walkInItems: WalkInItem[];
  shopName: string;
  salesperson: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, capture, capturing] = useActionState<ManualOrderState, FormData>(
    captureManualOrderAction,
    EMPTY_MANUAL_ORDER_STATE,
  );

  // Walk-In mode: a counter sale that completes instantly (Owner 2026-07-25).
  const [mode, setMode] = useState<'order' | 'walkin'>('order');
  const [walkIn, walkInSubmit, walkInPending] = useActionState<WalkInOrderState, FormData>(
    captureWalkInOrderAction,
    EMPTY_WALKIN_STATE,
  );
  const today = new Date().toISOString().slice(0, 10);

  const [customerInput, setCustomerInput] = useState('');
  const [itemInput, setItemInput] = useState('');
  const [priceInput, setPriceInput] = useState('');
  // Tracks which item the price field was last defaulted for (render-time sync).
  const [priceItemId, setPriceItemId] = useState<string | null>(null);
  const [gramsInput, setGramsInput] = useState('');
  // Optional helper: price per gram. Entering it fills Unit Price (grams × rate);
  // Unit Price stays manually editable and can be overridden after.
  const [pricePerGramInput, setPricePerGramInput] = useState('');
  const [showReprintNote, setShowReprintNote] = useState(false);

  // The Bluetooth printer is connected ONCE from the sidebar control; here we
  // just reuse that shared connection (connect once, print many).
  const { printer, activeChannel, printLang } = usePrinter();

  // Stable per open, changes after each submit (safe double-tap dedup).
  const reactId = useId();
  const [nonce, setNonce] = useState(0);
  const idempotencyKey = `neworder-${reactId}-${nonce}`;

  // "Pick OR type": an input that EXACTLY matches an existing record uses that
  // record's id; anything else is a NEW record, created on confirm.
  const itemLabel = (i: CaptureItem) =>
    `${i.itemCode}${i.itemName ? ` — ${i.itemName}` : ''}`;
  const matchedCustomer =
    customers.find((c) => c.displayName === customerInput.trim()) ?? null;
  const matchedItem = items.find((i) => itemLabel(i) === itemInput.trim()) ?? null;
  const isNewItem = itemInput.trim().length > 0 && !matchedItem;

  // When an existing item is picked, default the Unit Price to the item's current
  // price (still fully editable — type over it to change it). This adjusts state
  // during render (React's supported alternative to a derived-state effect): it only
  // fires when the SELECTED item changes, never mid-type, so it never stomps typing.
  // A new typed item clears the field so the operator sets a fresh price.
  const currentItemId = matchedItem?.id ?? null;
  if (currentItemId !== priceItemId) {
    setPriceItemId(currentItemId);
    setPriceInput(matchedItem?.unitPrice ?? '');
  }

  // Print status for the "printed / failed → Reprint" flow. The order SAVES first
  // (into For Invoice); this tracks ONLY whether the physical label came out, so a
  // failed print can be retried without ever creating or deleting an order.
  const printedSigRef = useRef<string | null>(null);
  const saveStartRef = useRef<number>(0);
  const lastPrintDataRef = useRef<OrderReceiptData | null>(null);
  // The saved order's id — used to record the print outcome + power Reprint.
  const orderIdRef = useRef<string>('');
  const [printState, setPrintState] = useState<'idle' | 'sending' | 'printed' | 'failed'>(
    'idle',
  );
  // Derived from the server receipt — no separate state, so no setState-in-effect.
  const saved = state.receipt
    ? {
        orderRef:
          state.receipt.orderNumber ||
          state.receipt.invoiceNumber ||
          state.receipt.itemCode,
        orderId: state.receipt.officialOrderId,
      }
    : null;

  const sigOf = (d: OrderReceiptData) =>
    `${d.customerName}|${d.itemName}|${d.grams ?? ''}|${d.quantity}|${d.unitPrice ?? ''}`;

  // Send the slip to the connected Bluetooth printer (raw TSPL/ESC-POS). Returns
  // true when it transmitted (or the browser dialog was used because no BLE printer
  // is connected), false on a REAL Bluetooth write failure — which surfaces as a
  // "Print failed" state with a Reprint button, never silently swallowed.
  const printSticker = async (d: OrderReceiptData): Promise<boolean> => {
    if (!activeChannel) {
      printOrderReceipt(d); // no BLE printer connected — the browser dialog is the path
      return true;
    }
    try {
      const t = performance.now();
      console.log('[print-perf] Bluetooth transmission started');
      await writeToChannel(activeChannel, encodeReceipt(d, printLang));
      console.log(
        `[print-perf] Bluetooth transmission completed +${(performance.now() - t).toFixed(
          0,
        )}ms`,
      );
      return true;
    } catch {
      console.log('[print-perf] Bluetooth transmission FAILED');
      return false;
    }
  };

  // Run a print and record the outcome. Used by the post-save print AND the Reprint
  // button. Printing ONLY — it never creates or re-saves an order. The outcome
  // (printed / failed / reprinted) is recorded against the saved order for an
  // honest print-status/printed-by/date-time trail.
  const runPrint = async (d: OrderReceiptData, kind: 'print' | 'reprint' = 'print') => {
    lastPrintDataRef.current = d;
    setPrintState('sending');
    const ok = await printSticker(d);
    setPrintState(ok ? 'printed' : 'failed');
    const orderId = orderIdRef.current;
    if (orderId) {
      void recordOrderPrintAction(
        orderId,
        ok ? (kind === 'reprint' ? 'reprinted' : 'printed') : 'failed',
      );
    }
  };

  // SAVE-FIRST flow: the order is now saved (For Invoice). Print the label here,
  // AFTER the save resolved — so a print failure can never delete or duplicate the
  // saved order. Closing is handled by the effect below, once the label printed.
  useEffect(() => {
    if (!state.receipt) return;
    orderIdRef.current = state.receipt.officialOrderId;
    console.log(
      `[print-perf] Order saved to For Invoice +${(
        performance.now() - saveStartRef.current
      ).toFixed(0)}ms`,
    );
    const data: OrderReceiptData = {
      customerName: matchedCustomer?.displayName ?? customerInput.trim(),
      itemName: matchedItem
        ? (matchedItem.itemName ?? matchedItem.itemCode)
        : itemInput.trim(),
      grams: matchedItem ? matchedItem.gramsPerPiece : gramsInput.trim() || null,
      quantity: state.receipt.quantity,
      unitPrice: priceInput.trim() || matchedItem?.unitPrice || null,
      date: stickerDate(),
    };
    if (sigOf(data) !== printedSigRef.current) {
      printedSigRef.current = sigOf(data);
      void runPrint(data);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.receipt?.printToken]);

  // Close only once the order saved AND the sticker printed. A failed print keeps
  // the modal open so the Reprint panel shows instead of silently closing.
  useEffect(() => {
    if (state.receipt && printState === 'printed') {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printState, state.receipt?.printToken]);

  // Reprint the LAST label (same data) — printing only, never a new order.
  const handleReprint = () => {
    const d = lastPrintDataRef.current;
    if (d) void runPrint(d, 'reprint');
  };
  // Fall back to the browser print dialog for the same label.
  const handleBrowserPrint = () => {
    const d = lastPrintDataRef.current;
    if (!d) return;
    printOrderReceipt(d);
    setPrintState('printed');
    if (orderIdRef.current) void recordOrderPrintAction(orderIdRef.current, 'reprinted');
  };
  // Give up on the print; the order is already saved. Refresh lists and close.
  const handleDismissAfterSave = () => {
    router.refresh();
    onClose();
  };

  // The Confirm handler: SAVE FIRST. Native HTML validation (required Customer,
  // Item, Qty) has already passed or this handler would not fire. This only marks
  // the save start + rotates the idempotency key; the actual save runs via the
  // form action, and the label prints only AFTER the save resolves (the effect
  // above). Saving before printing is what guarantees a print failure can never
  // delete or duplicate the order.
  const handleConfirm = () => {
    setNonce((n) => n + 1); // new idempotency key per submit (existing behaviour)
    saveStartRef.current = performance.now();
    console.log('[print-perf] Confirm clicked — saving order first');
  };

  return (
    <Modal
      open
      onClose={onClose}
      critical
      size="md"
      title={
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
          {mode === 'walkin' ? 'Walk-In Sale' : 'New Order Entry'}
        </span>
      }
      footer={
        mode === 'walkin' ? (
          <Button
            type="submit"
            form="walkin-form"
            disabled={walkInPending || walkIn.order !== null}
            className="h-auto min-h-[44px] w-full text-sm font-bold uppercase tracking-wide"
          >
            {walkInPending
              ? 'Completing…'
              : walkIn.order
                ? 'Sale completed'
                : 'Accept — Complete Sale'}
          </Button>
        ) : (
          <div className="w-full">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => setShowReprintNote(true)}
                title="Reprint the last label. Printing is gated until a real-device validation."
                className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-card py-1.5 text-muted-foreground hover:bg-accent"
              >
                <span aria-hidden="true">⎙</span>
                <span className="text-[9px] font-semibold uppercase leading-tight">
                  Reprint Last
                </span>
              </button>
              <Button
                type="submit"
                form="new-order-form"
                disabled={capturing || saved !== null}
                className="h-auto min-h-[44px] flex-1 text-sm font-bold uppercase tracking-wide"
              >
                {capturing ? 'Saving…' : saved ? 'Order saved' : 'Confirm Order'}
              </Button>
            </div>
            {showReprintNote ? (
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Reprint is unavailable — the Bluetooth printer is not connected/validated
                yet (see the printer status). Nothing was printed.
              </p>
            ) : null}
          </div>
        )
      }
    >
      {/* Mode toggle: standard New Order (saved to For Invoice) vs an instant Walk-In sale. */}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-border p-1">
        <button
          type="button"
          onClick={() => setMode('order')}
          data-testid="mode-order"
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-semibold',
            mode === 'order' ? 'bg-gold text-black' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          New Order
        </button>
        <button
          type="button"
          onClick={() => setMode('walkin')}
          data-testid="mode-walkin"
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-semibold',
            mode === 'walkin' ? 'bg-gold text-black' : 'text-muted-foreground hover:bg-accent',
          )}
        >
          Walk In
        </button>
      </div>

      {mode === 'walkin' ? (
        <WalkInBody
          today={today}
          state={walkIn}
          submit={walkInSubmit}
          items={walkInItems}
          customers={customers}
          onDone={() => {
            router.refresh();
            onClose();
          }}
        />
      ) : (
        <>
      {/* Print outcome — shown once the order is SAVED (For Invoice). A failed print
          keeps the saved order safe and offers Reprint (no duplicate, no deletion). */}
      {saved && printState === 'failed' ? (
        <div
          className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3"
          role="alert"
          data-testid="print-failed"
        >
            <p className="text-sm font-semibold text-destructive">
              Order saved, but printing failed. You can reprint this order.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Order <strong>{saved.orderRef}</strong> is saved in For Invoice — only the
              print failed. Reprint below; it will not create a duplicate order.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={handleReprint}>
                ⎙ Reprint
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleBrowserPrint}
              >
                Print via browser
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleDismissAfterSave}
              >
                Close anyway
              </Button>
            </div>
          </div>
      ) : saved && printState === 'sending' ? (
        <div
          className="mb-3 rounded-lg border border-border bg-secondary/40 px-3 py-2"
          data-testid="print-sending"
        >
          <p className="text-xs text-muted-foreground">
            Order <strong>{saved.orderRef}</strong> saved to For Invoice — sending label
            to printer…
          </p>
        </div>
      ) : null}

      <form id="new-order-form" action={capture} onSubmit={handleConfirm}>
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

        <div className="space-y-3">
            {/* Shop + Salesperson — the caller's real session identity (read-only). */}
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <label className="block">
                <L>Shop Name</L>
                <input className={fieldClass} value={shopName} readOnly />
              </label>
              <label className="block">
                <L>Salesperson</L>
                <input className={fieldClass} value={salesperson} readOnly />
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              From your session. Changing either needs the matching permission.
            </p>

            <hr className="border-border" />

            <label className="block">
              <L>Customer</L>
              <Combobox
                required
                className={fieldClass}
                placeholder="Select a customer… or type a new name"
                value={customerInput}
                onChange={setCustomerInput}
                options={customers.map((c) => c.displayName)}
              />
              <input type="hidden" name="customerId" value={matchedCustomer?.id ?? ''} />
              <input
                type="hidden"
                name="customerName"
                value={matchedCustomer ? '' : customerInput.trim()}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {matchedCustomer
                  ? 'Existing customer selected.'
                  : customerInput.trim()
                    ? 'New customer — will be created on confirm.'
                    : 'Pick from the list, or type a new name.'}
              </p>
            </label>

            <label className="block">
              <L>Item / Product</L>
              <Combobox
                required
                className={fieldClass}
                placeholder="Select an item… or type a new one"
                value={itemInput}
                onChange={setItemInput}
                options={items.map((i) => itemLabel(i))}
              />
              <input type="hidden" name="inventoryItemId" value={matchedItem?.id ?? ''} />
              <input
                type="hidden"
                name="itemName"
                value={matchedItem ? '' : itemInput.trim()}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                {matchedItem
                  ? 'Existing item selected.'
                  : isNewItem
                    ? 'New item — created on confirm. Set its grams and unit price below.'
                    : 'Pick from the list, or type a new item name.'}
              </p>
            </label>

            <label className="block">
              <L>Grams (per piece)</L>
              {isNewItem ? (
                <input
                  name="grams"
                  inputMode="decimal"
                  className={cn(fieldClass, 'text-right tabular-nums')}
                  placeholder="e.g. 12.2"
                  value={gramsInput}
                  onChange={(e) => {
                    const g = e.target.value;
                    setGramsInput(g);
                    // Keep Unit Price in step with price/gram when both are set.
                    if (pricePerGramInput) {
                      const unit = unitPriceFromPerGram(pricePerGramInput, g);
                      if (unit) setPriceInput(unit);
                    }
                  }}
                  title="Weight per piece — printed on the sticker."
                />
              ) : (
                <input
                  className={cn(fieldClass, 'bg-muted/40')}
                  readOnly
                  value={
                    matchedItem?.gramsPerPiece ? `${matchedItem.gramsPerPiece}g` : '—'
                  }
                />
              )}
            </label>

            <label className="block">
              <L>Price per Gram (optional)</L>
              <MoneyInput
                className={cn(fieldClass, 'text-right tabular-nums')}
                placeholder="e.g. 250"
                value={pricePerGramInput}
                onValueChange={(v) => {
                  setPricePerGramInput(v);
                  const g = matchedItem?.gramsPerPiece ?? gramsInput;
                  const unit = unitPriceFromPerGram(v, g);
                  if (unit) setPriceInput(unit);
                }}
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Fills Unit Price (grams × price/gram). You can still edit Unit Price
                manually after.
              </p>
            </label>

            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[1fr_88px]">
              <label className="block">
                <L>Unit Price</L>
                {/* Always editable (Owner request) — for a NEW item this sets its
                    selling price; for an EXISTING item the entered price is applied
                    to the item via set_inventory_item_price. Live comma formatting;
                    the raw numeric value is submitted. Editable by anyone who can
                    create an order — no separate price permission. */}
                <MoneyInput
                  name="unitPrice"
                  className={cn(fieldClass, 'text-right tabular-nums')}
                  placeholder={matchedItem?.unitPrice ? formatPeso(matchedItem.unitPrice) : '0.00'}
                  value={priceInput}
                  onValueChange={setPriceInput}
                />
                {matchedItem ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {matchedItem.unitPrice
                      ? `Pre-filled from the item (${formatPeso(matchedItem.unitPrice)}) — editable; `
                      : 'Editable — '}
                    the entered price is applied to the item on confirm.
                  </p>
                ) : null}
              </label>
              <label className="block">
                <L>Qty</L>
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={1}
                  required
                  className={fieldClass}
                />
              </label>
            </div>

            {/* Photo attaches to an EXISTING item (it must exist before the
                claim does). A newly-typed item has no id yet, so its photo is
                added later from the item itself. */}
            {matchedItem ? (
              <PhotoCapture
                key={matchedItem.id}
                relatedEntityType="inventory_item"
                relatedEntityId={matchedItem.id}
                purpose="photo"
                label="Photo attachment"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {isNewItem
                  ? 'Photo can be attached to the new item after it is created.'
                  : 'Select an existing item to attach a photo.'}
              </div>
            )}

            {state.error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {state.error}
              </p>
            ) : null}

            {/* Printer STATUS only — the connection is made once from the sidebar
                Bluetooth control and reused here. */}
            <p className="rounded-lg border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              Confirm <strong>saves the order to For Invoice</strong> and reserves the
              item to it, then prints the label.{' '}
              {printer ? (
                <>
                  The label prints directly to <strong>{printer.deviceName}</strong>{' '}
                  over Bluetooth (connected in the sidebar).
                </>
              ) : (
                <>
                  The label opens your browser&apos;s print dialog. To print straight to
                  the XP-236B, connect it once from the{' '}
                  <strong>Bluetooth / Printer</strong> control in the sidebar (below the
                  theme toggle).
                </>
              )}{' '}
              The order is saved before printing, so a print failure never deletes or
              duplicates it — you can reprint.
            </p>
        </div>
      </form>
        </>
      )}
    </Modal>
  );
}

export function NewOrderWorkflow({
  customers,
  items,
  walkInItems,
  canCreate,
  shopName,
  salesperson,
}: {
  customers: Customer[];
  items: CaptureItem[];
  walkInItems: WalkInItem[];
  canCreate: boolean;
  shopName: string;
  salesperson: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div>
        <Button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!canCreate}
          data-testid="orders-new-order"
          className="font-semibold"
          title={
            canCreate
              ? undefined
              : 'Creating an entry needs the claim capture permission.'
          }
        >
          ＋ New Order
        </Button>
      </div>

      {open ? (
        <NewOrderModal
          customers={customers}
          items={items}
          walkInItems={walkInItems}
          shopName={shopName}
          salesperson={salesperson}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
