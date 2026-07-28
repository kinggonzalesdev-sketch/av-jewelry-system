'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import {
  captureManualOrderAction,
  captureWalkInOrderAction,
  recordOrderPrintAction,
} from '@/lib/orders/actions';
import {
  printOrderSlip,
  slipDateTime,
  type OrderSlipData,
} from '@/lib/print/order-receipt';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeSlip } from '@/lib/print/receipt-encoders';
import { usePrinter } from '@/components/print/printer-context';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';
import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Orders "New Order" control + the New Order form (multi-item).
 *
 * Two modes share one item-rows editor: New Entry (saves one parent order with many
 * order-item records into For Invoice, then prints) and Walk-In (creates one
 * fully-paid, Completed multi-item sale, then prints). Every item is picked from
 * Active Inventory by permanent id — the same item can't be added twice, and the
 * database saves the whole order + all its items atomically (no partial saves). The
 * order is ALWAYS saved before printing, so a print failure never deletes or
 * duplicates it — it shows a Reprint option instead. Grams are read-only from the
 * item; Unit Price is manually editable with live comma formatting.
 */

type Customer = { id: string; displayName: string };

/** A normalized Active-Inventory item either mode can sell. */
type PickItem = {
  id: string;
  code: string;
  name: string | null;
  grams: string | null;
  /** Catalogue unit price (New Entry prefills from it); Walk-In has none. */
  unitPrice: string | null;
  label: string;
};

/** One editable item row in the order. */
type Row = { key: string; itemInput: string; qty: string; price: string };

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold';

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

let rowSeq = 0;
function newRow(): Row {
  rowSeq += 1;
  return { key: `row-${rowSeq}-${Date.now()}`, itemInput: '', qty: '1', price: '' };
}

/** Raw price string → exact centavos (never a float). '' / invalid → 0. */
function priceCentavos(raw: string): bigint {
  const s = (raw ?? '').trim();
  if (!PRICE_RE.test(s)) return 0n;
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w || '0') * 100n + BigInt(`${f}00`.slice(0, 2) || '0');
}
function centavosToStr(c: bigint): string {
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}
function lineTotalCentavos(r: Row): bigint {
  const qty = Math.max(1, Number(r.qty) || 1);
  return priceCentavos(r.price) * BigInt(qty);
}

/** The shared item-rows editor + order summary. Used by both modes. */
function ItemRows({
  items,
  rows,
  setRows,
  catalogPrefill,
}: {
  items: PickItem[];
  rows: Row[];
  setRows: React.Dispatch<React.SetStateAction<Row[]>>;
  catalogPrefill: boolean;
}) {
  const byLabel = useMemo(() => {
    const m = new Map<string, PickItem>();
    for (const i of items) m.set(i.label, i);
    return m;
  }, [items]);

  const matchOf = (r: Row) => byLabel.get(r.itemInput.trim()) ?? null;

  // Labels already chosen in OTHER rows — excluded so an item can't be added twice.
  const chosenElsewhere = (key: string) =>
    new Set(
      rows
        .filter((r) => r.key !== key)
        .map((r) => matchOf(r)?.label)
        .filter((v): v is string => Boolean(v)),
    );

  const patch = (key: string, next: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const onItem = (r: Row, value: string) => {
    const picked = byLabel.get(value.trim()) ?? null;
    const next: Partial<Row> = { itemInput: value };
    // Prefill the row's price from the item's catalogue price (New Entry), editable.
    if (picked && catalogPrefill && !r.price) next.price = picked.unitPrice ?? '';
    patch(r.key, next);
  };

  return (
    <div className="space-y-2">
      {rows.map((r, idx) => {
        const matched = matchOf(r);
        const taken = chosenElsewhere(r.key);
        const options = items
          .filter((i) => !taken.has(i.label))
          .map((i) => i.label);
        const lineTotal = centavosToStr(lineTotalCentavos(r));
        return (
          <div
            key={r.key}
            className="rounded-lg border border-border p-2.5"
            data-testid={`order-item-row-${idx}`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Item {idx + 1}
              </span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  data-testid={`order-item-remove-${idx}`}
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
                >
                  Remove
                </button>
              ) : null}
            </div>
            <Combobox
              className={fieldClass}
              placeholder="Search Active Inventory by code or name…"
              value={r.itemInput}
              onChange={(v) => onItem(r, v)}
              options={options}
            />
            <div className="mt-2 grid grid-cols-[1fr_64px] gap-2 min-[420px]:grid-cols-[1fr_1fr_64px]">
              <label className="block">
                <L>Unit Price</L>
                <MoneyInput
                  className={cn(fieldClass, 'h-9 text-right tabular-nums')}
                  placeholder={matched?.unitPrice ? formatPeso(matched.unitPrice) : '0.00'}
                  value={r.price}
                  onValueChange={(v) => patch(r.key, { price: v })}
                />
              </label>
              <label className="block">
                <L>Grams</L>
                <input
                  className={cn(fieldClass, 'h-9 bg-muted/40 text-right tabular-nums')}
                  readOnly
                  value={matched ? (matched.grams ? `${matched.grams}g` : '—') : ''}
                  placeholder="—"
                />
              </label>
              <label className="block">
                <L>Qty</L>
                <input
                  type="number"
                  min={1}
                  value={r.qty}
                  onChange={(e) => patch(r.key, { qty: e.target.value })}
                  className={cn(fieldClass, 'h-9')}
                />
              </label>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {matched ? (
                  <>
                    <span className="font-mono">{matched.code}</span> selected
                  </>
                ) : r.itemInput.trim() ? (
                  'Pick an item from Active Inventory.'
                ) : (
                  'Select an item.'
                )}
              </span>
              <span className="font-semibold tabular-nums" data-testid={`order-item-line-${idx}`}>
                {formatPeso(lineTotal)}
              </span>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, newRow()])}
        data-testid="order-add-item"
        className="w-full rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-muted-foreground hover:bg-accent"
      >
        ＋ Add Item
      </button>
    </div>
  );
}

/** Order summary (items count, subtotal, total) computed from the rows. */
function OrderSummary({ rows }: { rows: Row[] }) {
  const total = rows.reduce((c, r) => c + lineTotalCentavos(r), 0n);
  const totalStr = centavosToStr(total);
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Number of Items</span>
        <span className="font-semibold tabular-nums" data-testid="order-summary-count">
          {rows.length}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span className="tabular-nums">{formatPeso(totalStr)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-1 text-base">
        <span className="font-semibold">Total Amount</span>
        <span className="font-bold tabular-nums" data-testid="order-summary-total">
          {formatPeso(totalStr)}
        </span>
      </div>
    </div>
  );
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
  const { printer, activeChannel, printLang } = usePrinter();

  const [mode, setMode] = useState<'order' | 'walkin'>('order');
  const today = new Date().toISOString().slice(0, 10);

  // Customer (shared, pick-OR-type).
  const [customerInput, setCustomerInput] = useState('');
  const matchedCustomer =
    customers.find((c) => c.displayName === customerInput.trim()) ?? null;

  // Item rows per mode (kept separate so switching modes doesn't mix item lists).
  const [orderRows, setOrderRows] = useState<Row[]>([newRow()]);
  const [walkRows, setWalkRows] = useState<Row[]>([newRow()]);
  const rows = mode === 'walkin' ? walkRows : orderRows;
  const setRows = mode === 'walkin' ? setWalkRows : setOrderRows;

  // Walk-In extras.
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [saleDate, setSaleDate] = useState(today);

  // Normalized pick-lists. New Entry offers AVAILABLE catalogue items; Walk-In uses
  // the pre-filtered sellable list.
  const orderPickItems: PickItem[] = useMemo(
    () =>
      items
        .filter(
          (i) =>
            i.availabilityStatus === 'available' ||
            i.availabilityStatus === 'returned_to_available',
        )
        .map((i) => ({
          id: i.id,
          code: i.itemCode,
          name: i.itemName,
          grams: i.gramsPerPiece,
          unitPrice: i.unitPrice,
          label: `${i.itemCode}${i.itemName ? ` — ${i.itemName}` : ''}`,
        })),
    [items],
  );
  const walkPickItems: PickItem[] = useMemo(
    () =>
      walkInItems.map((i) => ({
        id: i.id,
        code: i.itemCode,
        name: i.facebookName,
        grams: i.grams,
        unitPrice: null,
        label: `${i.itemCode}${i.facebookName ? ` — ${i.facebookName}` : ''}`,
      })),
    [walkInItems],
  );
  const pickItems = mode === 'walkin' ? walkPickItems : orderPickItems;
  const byLabel = useMemo(() => {
    const m = new Map<string, PickItem>();
    for (const i of pickItems) m.set(i.label, i);
    return m;
  }, [pickItems]);

  // Submit + print state (client-managed — the item rows are structured, not a form).
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    officialOrderId: string;
    orderNumber: string;
    itemCount: number;
    total: string;
    slip: OrderSlipData;
    walkIn: boolean;
  } | null>(null);
  const [printState, setPrintState] = useState<'idle' | 'sending' | 'printed' | 'failed'>(
    'idle',
  );
  const submittingRef = useRef(false);

  const resolvedRows = () =>
    rows.map((r) => ({ row: r, item: byLabel.get(r.itemInput.trim()) ?? null }));

  const totalCentavos = rows.reduce((c, r) => c + lineTotalCentavos(r), 0n);

  const validate = (): string | null => {
    const resolved = resolvedRows();
    if (resolved.length === 0) return 'Add at least one item.';
    const ids = new Set<string>();
    for (const { row, item } of resolved) {
      if (!item) return 'Pick an item from Active Inventory for every row.';
      if (ids.has(item.id)) return 'The same item was added more than once. Remove the duplicate.';
      ids.add(item.id);
      if (!PRICE_RE.test(row.price.trim()) || Number(row.price) <= 0) {
        return `Enter a unit price greater than zero for ${item.code}.`;
      }
    }
    if (mode === 'walkin') {
      if (!customerInput.trim()) return 'Enter the customer name.';
    } else if (!matchedCustomer && !customerInput.trim()) {
      return 'Choose a customer, or type a new name.';
    }
    return null;
  };

  const buildSlip = (orderNumber: string): OrderSlipData => ({
    orderNumber,
    customerName: matchedCustomer?.displayName ?? customerInput.trim(),
    salesperson,
    dateTime: slipDateTime(),
    items: resolvedRows().map(({ row, item }) => ({
      code: item?.code ?? '—',
      name: item?.name ?? '',
      grams: item?.grams ?? null,
      unitPrice: row.price.trim(),
      quantity: Math.max(1, Number(row.qty) || 1),
      lineTotal: centavosToStr(lineTotalCentavos(row)),
    })),
    grandTotal: centavosToStr(totalCentavos),
  });

  // Print the combined slip. Returns true when transmitted (or the browser dialog
  // was used because no BLE printer is connected), false on a real write failure.
  const printSlip = async (slip: OrderSlipData): Promise<boolean> => {
    if (!activeChannel) {
      printOrderSlip(slip);
      return true;
    }
    try {
      await writeToChannel(activeChannel, encodeSlip(slip, printLang));
      return true;
    } catch {
      return false;
    }
  };

  const runPrint = async (
    slip: OrderSlipData,
    orderId: string,
    kind: 'print' | 'reprint',
  ) => {
    setPrintState('sending');
    const ok = await printSlip(slip);
    setPrintState(ok ? 'printed' : 'failed');
    if (orderId) {
      void recordOrderPrintAction(
        orderId,
        ok ? (kind === 'reprint' ? 'reprinted' : 'printed') : 'failed',
      );
    }
  };

  // Confirm (New Entry) / Accept (Walk-In): SAVE FIRST, then print. A single guarded
  // DB call saves the parent order + all items atomically; printing follows.
  const handleSubmit = async () => {
    if (pending || saved || submittingRef.current) return;
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    submittingRef.current = true;
    setPending(true);
    setError(null);

    const payloadItems = resolvedRows().map(({ row, item }) => ({
      inventoryItemId: item!.id,
      unitPrice: row.price.trim(),
      quantity: Math.max(1, Number(row.qty) || 1),
    }));

    try {
      if (mode === 'walkin') {
        const res = await captureWalkInOrderAction({
          customerName: customerInput.trim(),
          items: payloadItems.map((i) => ({
            inventoryItemId: i.inventoryItemId,
            price: i.unitPrice,
            quantity: i.quantity,
          })),
          paymentMethod,
          saleDate: saleDate || null,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const slip = buildSlip(res.orderNumber);
        setSaved({
          officialOrderId: res.officialOrderId,
          orderNumber: res.orderNumber,
          itemCount: res.itemCount,
          total: centavosToStr(totalCentavos),
          slip,
          walkIn: true,
        });
        router.refresh();
        void runPrint(slip, res.officialOrderId, 'print');
      } else {
        const res = await captureManualOrderAction({
          customerId: matchedCustomer?.id ?? null,
          customerName: matchedCustomer ? null : customerInput.trim(),
          items: payloadItems,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const slip = buildSlip(res.orderNumber);
        setSaved({
          officialOrderId: res.officialOrderId,
          orderNumber: res.orderNumber,
          itemCount: res.itemCount,
          total: centavosToStr(totalCentavos),
          slip,
          walkIn: false,
        });
        router.refresh();
        void runPrint(slip, res.officialOrderId, 'print');
      }
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  const handleReprint = () => {
    if (saved) void runPrint(saved.slip, saved.officialOrderId, 'reprint');
  };
  const handleDone = () => {
    router.refresh();
    onClose();
  };

  // Post-save confirmation panel (both modes). The order is saved; this only reports
  // the print outcome + offers Reprint.
  if (saved) {
    return (
      <Modal
        open
        onClose={handleDone}
        critical
        size="md"
        title={
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
            {saved.walkIn ? 'Walk-In Sale' : 'New Order Entry'}
          </span>
        }
        footer={
          <Button type="button" onClick={handleDone} className="w-full">
            Done
          </Button>
        }
      >
        <div className="space-y-3" data-testid="order-saved">
          <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-3">
            <p className="text-sm font-semibold">
              {saved.walkIn ? 'Walk-in sale completed' : 'Order saved to For Invoice'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Order <strong>{saved.orderNumber}</strong> · {saved.itemCount} item
              {saved.itemCount === 1 ? '' : 's'} · Total{' '}
              <strong>{formatPeso(saved.total)}</strong>.
              {saved.walkIn
                ? ' All items were retired to Completed inventory.'
                : ' The items are reserved to this order.'}
            </p>
          </div>

          {printState === 'failed' ? (
            <div
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3"
              role="alert"
              data-testid="print-failed"
            >
              <p className="text-sm font-semibold text-destructive">
                Order saved, but printing failed. You can reprint this order.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleReprint}>
                  ⎙ Reprint
                </Button>
              </div>
            </div>
          ) : printState === 'sending' ? (
            <p className="text-xs text-muted-foreground" data-testid="print-sending">
              Sending the combined slip to the printer…
            </p>
          ) : printState === 'printed' ? (
            <p className="text-xs text-muted-foreground">
              Combined slip printed.{' '}
              <button
                type="button"
                onClick={handleReprint}
                className="underline hover:text-foreground"
              >
                Reprint
              </button>
            </p>
          ) : null}
        </div>
      </Modal>
    );
  }

  const submitLabel =
    mode === 'walkin'
      ? pending
        ? 'Completing…'
        : 'Accept — Complete Sale'
      : pending
        ? 'Saving…'
        : 'Confirm Order';

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
        <Button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={pending}
          className="h-auto min-h-[44px] w-full text-sm font-bold uppercase tracking-wide"
        >
          {submitLabel}
        </Button>
      }
    >
      {/* Mode toggle: New Entry (saved to For Invoice) vs instant Walk-In sale. */}
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
          New Entry
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

        <label className="block">
          <L>{mode === 'walkin' ? 'Name' : 'Customer'}</L>
          <Combobox
            className={fieldClass}
            placeholder="Select a customer… or type a new name"
            value={customerInput}
            onChange={setCustomerInput}
            options={customers.map((c) => c.displayName)}
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {matchedCustomer
              ? 'Existing customer selected.'
              : customerInput.trim()
                ? 'New customer — will be created on confirm.'
                : 'Pick from the list, or type a new name.'}
          </p>
        </label>

        <hr className="border-border" />

        <ItemRows
          items={pickItems}
          rows={rows}
          setRows={setRows}
          catalogPrefill={mode === 'order'}
        />

        <OrderSummary rows={rows} />

        {mode === 'walkin' ? (
          <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
            <label className="block">
              <L>Mode of Payment</L>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className={fieldClass}
              >
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
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <p className="rounded-lg border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          {mode === 'walkin' ? (
            <>
              Accepting records a <strong>fully-paid, Completed</strong> sale for all
              items and moves them into <strong>Completed Items</strong>.
            </>
          ) : (
            <>
              Confirm <strong>saves the order to For Invoice</strong> with all items and
              reserves them, then prints one combined slip.
            </>
          )}{' '}
          {printer ? (
            <>The slip prints to <strong>{printer.deviceName}</strong> over Bluetooth.</>
          ) : (
            <>The slip opens your browser&apos;s print dialog.</>
          )}{' '}
          Saved before printing, so a print failure never deletes or duplicates it —
          you can reprint.
        </p>
      </div>
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
