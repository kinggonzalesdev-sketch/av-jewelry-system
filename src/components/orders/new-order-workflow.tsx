'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';

import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { hkFixedPrice, isHKItem } from '@/lib/inventory/hk-item';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { AdminNameField } from '@/components/orders/admin-name-field';
import {
  captureManualOrderAction,
  completeWalkInOrderAction,
  recordOrderPrintAction,
  saveWalkInOrderAction,
  transferWalkInToReminderAction,
  updateInventoryGramsAction,
} from '@/lib/orders/actions';
import {
  printOrderSlip,
  slipDateTime,
  type OrderSlipData,
} from '@/lib/print/order-receipt';
import { writeToChannel } from '@/lib/print/bluetooth-printer';
import { encodeSlip } from '@/lib/print/receipt-encoders';
import { usePrinter } from '@/components/print/printer-context';
import { PhotoCapture } from '@/components/attachments/photo-capture';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';
import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Orders "New Order" control + the New Order form (multi-item).
 *
 * Two modes share one item-rows editor:
 *   - New Entry saves one parent order with many order-item records into For Invoice,
 *     then prints (the order is ALWAYS saved before printing, so a print failure never
 *     deletes or duplicates it — it offers Reprint instead). Grams are read-only.
 *   - Walk-In (Owner overhaul 2026-07-30) is a manual counter sale: grams are editable
 *     (and synced back to inventory, audited), up to TWO payment methods each with an
 *     amount can be recorded, and the operator reviews everything in a confirm modal
 *     before it saves. It does NOT auto-complete or print — on Save it is transferred
 *     to Completed when fully paid, otherwise to For Reminder with its remaining
 *     balance, matching the database's own authoritative balance.
 *
 * Every item is picked from Active Inventory by permanent id — the same item can't be
 * added twice, and the database saves the whole order + all its items atomically (no
 * partial saves). Unit Price is manually editable with live comma formatting.
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

/** One editable item row in the order. Each row is ONE unique jewelry piece (no
 *  quantity). Pricing is either a Fixed Price or Price Per Gram (grams × rate). */
type Row = {
  key: string;
  itemInput: string;
  priceMode: 'fixed' | 'per_gram';
  /** Fixed-price amount (raw). */
  price: string;
  /** Price-per-gram rate (raw); the total is grams × rate. */
  perGram: string;
  /** Walk-In only: edited grams override (raw). Empty = use the item's own grams. */
  grams: string;
};

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
  return {
    key: `row-${rowSeq}-${Date.now()}`,
    itemInput: '',
    priceMode: 'fixed',
    price: '',
    perGram: '',
    grams: '',
  };
}

const GRAMS_RE = /^\d{0,6}(\.\d{0,3})?$/;

/** One Walk-In payment (up to two). Money is a raw string; the DB verifies it. */
type PayRow = { key: string; method: string; amount: string; reference: string };

let paySeq = 0;
function newPay(method: string = DEFAULT_PAYMENT_METHOD): PayRow {
  paySeq += 1;
  return { key: `pay-${paySeq}-${Date.now()}`, method, amount: '', reference: '' };
}

const PAYMENT_METHODS = PAYMENT_METHOD_OPTIONS;

function methodLabel(value: string): string {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
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
/** Total from Price Per Gram × grams, in EXACT integer units: grams → milligrams
 *  (×1000), rate → centavos (×100), total centavos = rateCentavos × gramsMilli /
 *  1000, rounded to the nearest centavo. */
function perGramTotalCentavos(grams: string, perGram: string): bigint {
  const g = (grams ?? '').trim();
  const pg = (perGram ?? '').trim();
  if (!/^\d*\.?\d*$/.test(g) || !PRICE_RE.test(pg)) return 0n;
  const [gw = '0', gf = ''] = g.split('.');
  const gramsMilli = BigInt(gw || '0') * 1000n + BigInt(`${gf}000`.slice(0, 3) || '0');
  const rateCentavos = priceCentavos(pg);
  if (gramsMilli === 0n || rateCentavos === 0n) return 0n;
  return (rateCentavos * gramsMilli + 500n) / 1000n;
}
/** The grams actually used for a row: the Walk-In override when set, else the item's
 *  own grams. Fixed-price rows ignore grams entirely. */
function effectiveGrams(r: Row, item: PickItem | null): string {
  const override = (r.grams ?? '').trim();
  return override || item?.grams || '';
}

/** A row's total price (one unique item — no quantity). */
function rowTotalCentavos(r: Row, item: PickItem | null): bigint {
  return r.priceMode === 'per_gram'
    ? perGramTotalCentavos(effectiveGrams(r, item), r.perGram)
    : priceCentavos(r.price);
}

/** The shared item-rows editor + order summary. Used by both modes. */
function ItemRows({
  items,
  rows,
  setRows,
  catalogPrefill,
  editableGrams = false,
}: {
  items: PickItem[];
  rows: Row[];
  setRows: React.Dispatch<React.SetStateAction<Row[]>>;
  catalogPrefill: boolean;
  /** Walk-In: the Grams field is editable and its change is later synced to the
   *  inventory item (audited). New Entry leaves grams read-only. */
  editableGrams?: boolean;
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
    if (picked && isHKItem(picked)) {
      // HK ITEM is ALWAYS Fixed Price. The price is the number written after
      // "HK ITEM" in the code/name (the quoted number is the size, not the price);
      // if none is written, fall back to the inventory catalogue price.
      next.priceMode = 'fixed';
      next.price = hkFixedPrice(picked) ?? picked.unitPrice ?? '';
    } else if (picked && catalogPrefill && r.priceMode === 'fixed' && !r.price) {
      // Non-HK: prefill the FIXED price from the catalogue (New Entry), editable.
      next.price = picked.unitPrice ?? '';
    }
    // Reflect the item's declared grams into the field. In New Entry the grams box
    // is read-only (shows the inventory weight); in Walk-In it stays editable but
    // starts pre-filled with that same weight so the operator sees it automatically.
    if (picked && !r.grams.trim() && picked.grams) {
      next.grams = picked.grams;
    }
    patch(r.key, next);
  };

  const modeBtn = (r: Row, m: 'fixed' | 'per_gram', label: string) => (
    <button
      type="button"
      onClick={() => patch(r.key, { priceMode: m })}
      className={cn(
        'rounded-md px-2 py-1 text-[11px] font-semibold',
        r.priceMode === m ? 'bg-gold text-black' : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-2">
      {rows.map((r, idx) => {
        const matched = matchOf(r);
        // HK ITEM → fixed catalogue price only (no per-gram, price locked to the
        // inventory record). `hkLocked` is true only when a catalogue price exists,
        // so an HK item missing a saved price stays manually enterable.
        const hk = matched ? isHKItem(matched) : false;
        const hkPrice = hk && matched ? (hkFixedPrice(matched) ?? matched.unitPrice) : null;
        const hkLocked = hk && Boolean(hkPrice);
        const taken = chosenElsewhere(r.key);
        const options = items
          .filter((i) => !taken.has(i.label))
          .map((i) => i.label);
        const perGram = r.priceMode === 'per_gram' && !hk;
        const gramsText = matched ? (matched.grams ? `${matched.grams}g` : '—') : '';
        // Walk-In: has the operator typed grams that differ from the item's own?
        const gramsChanged =
          Boolean(r.grams.trim()) &&
          matched !== null &&
          r.grams.trim() !== (matched.grams ?? '').trim();
        const lineTotal = centavosToStr(rowTotalCentavos(r, matched));
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
            {/* Item selector + Pricing toggle on one line (Fixed Price / Per Gram). */}
            <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
              <div className="min-[480px]:flex-1">
                <Combobox
                  className={fieldClass}
                  placeholder="Search Active Inventory by code or name…"
                  value={r.itemInput}
                  onChange={(v) => onItem(r, v)}
                  options={options}
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pricing
                </span>
                <div
                  className="inline-flex items-center gap-1 rounded-md border border-border p-0.5"
                  data-testid={`order-item-pricing-${idx}`}
                >
                  {hk ? (
                    // HK ITEM is fixed-price only — no per-gram option is offered.
                    <span
                      className="rounded-md bg-gold px-2 py-1 text-[11px] font-semibold text-black"
                      data-testid={`order-item-hk-${idx}`}
                    >
                      Fixed Price · HK Item
                    </span>
                  ) : (
                    <>
                      {modeBtn(r, 'fixed', 'Fixed Price')}
                      {modeBtn(r, 'per_gram', 'Price Per Gram')}
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <L>Grams</L>
                {editableGrams && matched ? (
                  <input
                    className={cn(fieldClass, 'h-9 text-right tabular-nums')}
                    inputMode="decimal"
                    value={r.grams}
                    placeholder={matched.grams ?? '0'}
                    data-testid={`order-item-grams-${idx}`}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (GRAMS_RE.test(v)) patch(r.key, { grams: v });
                    }}
                  />
                ) : (
                  <input
                    className={cn(fieldClass, 'h-9 bg-muted/40 text-right tabular-nums')}
                    readOnly
                    value={gramsText}
                    placeholder="—"
                  />
                )}
                {editableGrams && matched && gramsChanged ? (
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    Original: {matched.grams ? `${matched.grams}g` : '—'} · inventory will
                    be updated
                  </span>
                ) : null}
              </label>
              {perGram ? (
                <label className="block">
                  <L>Price / Gram</L>
                  <MoneyInput
                    className={cn(fieldClass, 'h-9 text-right tabular-nums')}
                    placeholder="0.00"
                    value={r.perGram}
                    onValueChange={(v) => patch(r.key, { perGram: v })}
                  />
                </label>
              ) : (
                <label className="block">
                  <L>Price</L>
                  {hkLocked ? (
                    // Official catalogue price from the inventory record — read-only.
                    <input
                      className={cn(fieldClass, 'h-9 bg-muted/40 text-right tabular-nums')}
                      readOnly
                      value={formatPeso(r.price || hkPrice || '0')}
                      data-testid={`order-item-price-${idx}`}
                    />
                  ) : (
                    <MoneyInput
                      className={cn(fieldClass, 'h-9 text-right tabular-nums')}
                      placeholder={matched?.unitPrice ? formatPeso(matched.unitPrice) : '0.00'}
                      value={r.price}
                      onValueChange={(v) => patch(r.key, { price: v })}
                    />
                  )}
                  {hkLocked ? (
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      Catalogue price (HK Item) — from Inventory
                    </span>
                  ) : null}
                </label>
              )}
            </div>

            {perGram ? (
              <div className="mt-2">
                <L>Total Price</L>
                <input
                  className={cn(fieldClass, 'h-9 bg-muted/40 text-right tabular-nums')}
                  readOnly
                  value={formatPeso(lineTotal)}
                  data-testid={`order-item-pergram-total-${idx}`}
                />
              </div>
            ) : null}

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

/**
 * Item photos — ONE optional reference photo per selected item, shown BELOW the
 * order total (Owner request) rather than inside each item card, so the pricing
 * fields stay compact and the photos sit together at the end of the form.
 *
 * Each control is the shared PhotoCapture, so the upload path, storage, and
 * permissions are the existing ones, and it attaches to the PERMANENT inventory id
 * — which is why an item's current photo appears automatically and stays visible in
 * the Order View modal afterwards. A photo never blocks Confirm Order.
 */
function ItemPhotos({ items }: { items: PickItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-item-photos">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Item Photos (optional)
      </p>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={item.id} data-testid={`order-item-photo-${idx}`}>
            <PhotoCapture
              relatedEntityType="inventory_item"
              relatedEntityId={item.id}
              purpose="photo"
              label={item.code}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Order summary (items count, subtotal, total) computed from the rows. */
function OrderSummary({ total: totalCentavos, count }: { total: bigint; count: number }) {
  const totalStr = centavosToStr(totalCentavos);
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Number of Items</span>
        <span className="font-semibold tabular-nums" data-testid="order-summary-count">
          {count}
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
  admins,
  onClose,
}: {
  customers: Customer[];
  items: CaptureItem[];
  walkInItems: WalkInItem[];
  admins: AdminNameContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const { activeChannel, printLang } = usePrinter();

  const [mode, setMode] = useState<'order' | 'walkin'>('order');
  const today = new Date().toISOString().slice(0, 10);

  // Customer (shared, pick-OR-type).
  // Admin Name is ALWAYS the signed-in account — read-only, no picker, no
  // impersonation (Owner request). The server re-derives it regardless.
  const adminId = admins.selfId;
  const adminName = admins.selfName;

  const [customerInput, setCustomerInput] = useState('');
  const matchedCustomer =
    customers.find((c) => c.displayName === customerInput.trim()) ?? null;

  // Item rows per mode (kept separate so switching modes doesn't mix item lists).
  const [orderRows, setOrderRows] = useState<Row[]>([newRow()]);
  const [walkRows, setWalkRows] = useState<Row[]>([newRow()]);
  const rows = mode === 'walkin' ? walkRows : orderRows;
  const setRows = mode === 'walkin' ? setWalkRows : setOrderRows;

  // Walk-In extras: up to two payment methods (each with its own amount) + a sale
  // date. A review overlay confirms everything before the sale is saved.
  const [pays, setPays] = useState<PayRow[]>([newPay()]);
  const [saleDate, setSaleDate] = useState(today);
  const [reviewing, setReviewing] = useState(false);

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
          // Grams reflect the inventory item; when the stored weight is blank, fall
          // back to the grams encoded in the item code (e.g. "SBA-P-2367 0.55g").
          grams: i.gramsPerPiece ?? parseInventoryCode(i.itemCode).grams,
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
    /** Walk-In only: where the saved sale was transferred. */
    destination?: 'reminder' | 'completed';
    /** Walk-In only: the DB-authoritative remaining balance. */
    balance?: string;
  } | null>(null);
  const [printState, setPrintState] = useState<'idle' | 'sending' | 'printed' | 'failed'>(
    'idle',
  );
  const submittingRef = useRef(false);

  const resolvedRows = () =>
    rows.map((r) => ({ row: r, item: byLabel.get(r.itemInput.trim()) ?? null }));

  // Each row is ONE unique piece; its total is the Fixed Price or grams × per-gram.
  const totalCentavos = resolvedRows().reduce(
    (c, { row, item }) => c + rowTotalCentavos(row, item),
    0n,
  );

  // Walk-In money: sum of the entered payments, and the resulting balance. These
  // mirror what the database will compute — the DB stays the authority on save.
  const paidCentavos =
    mode === 'walkin' ? pays.reduce((c, p) => c + priceCentavos(p.amount), 0n) : 0n;
  const balanceCentavos = totalCentavos - paidCentavos;

  const patchPay = (key: string, next: Partial<PayRow>) =>
    setPays((ps) => ps.map((p) => (p.key === key ? { ...p, ...next } : p)));

  const validate = (): string | null => {
    const resolved = resolvedRows();
    if (resolved.length === 0) return 'Add at least one item.';
    const ids = new Set<string>();
    for (const { row, item } of resolved) {
      if (!item) return 'Pick an item from Active Inventory for every row.';
      if (ids.has(item.id)) return 'The same item was added more than once. Remove the duplicate.';
      ids.add(item.id);
      // Walk-In grams override, when typed, must be a positive number.
      if (mode === 'walkin' && row.grams.trim() && Number(row.grams) <= 0) {
        return `${item.code}: grams must be greater than zero.`;
      }
      if (row.priceMode === 'per_gram') {
        const g = effectiveGrams(row, item);
        if (!g || Number(g) <= 0) {
          return `${item.code} has no grams — enter grams or use Fixed Price for it.`;
        }
        if (!PRICE_RE.test(row.perGram.trim()) || Number(row.perGram) <= 0) {
          return `Enter a price per gram greater than zero for ${item.code}.`;
        }
      } else if (!PRICE_RE.test(row.price.trim()) || Number(row.price) <= 0) {
        return `Enter a price greater than zero for ${item.code}.`;
      }
      if (rowTotalCentavos(row, item) <= 0n) {
        return `${item.code} needs a total price greater than zero.`;
      }
    }
    if (mode === 'walkin') {
      if (!customerInput.trim()) return 'Enter the customer name.';
      const active = pays.filter((p) => p.amount.trim() !== '');
      for (const p of active) {
        if (!PRICE_RE.test(p.amount.trim()) || Number(p.amount) <= 0) {
          return 'Enter a valid payment amount, or clear the payment row.';
        }
      }
      if (paidCentavos > totalCentavos) {
        return 'Total payments cannot exceed the order total.';
      }
    } else if (!matchedCustomer && !customerInput.trim()) {
      return 'Choose a customer, or type a new name.';
    }
    return null;
  };

  const buildSlip = (orderNumber: string): OrderSlipData => ({
    orderNumber,
    customerName: matchedCustomer?.displayName ?? customerInput.trim(),
    // The slip still carries one name; it is now the Admin Name.
    salesperson: adminName,
    dateTime: slipDateTime(),
    items: resolvedRows().map(({ row, item }) => {
      const total = centavosToStr(rowTotalCentavos(row, item));
      return {
        code: item?.code ?? '—',
        name: item?.name ?? '',
        grams: item?.grams ?? null,
        unitPrice: total,
        quantity: 1,
        lineTotal: total,
      };
    }),
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

  // New Entry: SAVE FIRST, then print. A single guarded DB call saves the parent
  // order + all its items atomically into For Invoice; printing follows.
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

    // One unique piece per row (quantity 1); the unit price IS the row's total,
    // whether entered as a Fixed Price or computed as grams × price-per-gram.
    const payloadItems = resolvedRows().map(({ row, item }) => ({
      inventoryItemId: item!.id,
      unitPrice: centavosToStr(rowTotalCentavos(row, item)),
      quantity: 1,
    }));

    try {
      const res = await captureManualOrderAction({
        customerId: matchedCustomer?.id ?? null,
        customerName: matchedCustomer ? null : customerInput.trim(),
        items: payloadItems,
        adminId,
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
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  // Walk-In: the "Save" button validates then opens the review overlay — nothing is
  // written until the operator confirms there.
  const openReview = () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setReviewing(true);
  };

  // Walk-In confirm: sync any edited grams back to inventory (audited), save the sale
  // WITHOUT completing it, then transfer it — to Completed when fully paid, otherwise
  // to For Reminder with its balance. No printing. The DB balance is the authority.
  const confirmWalkIn = async () => {
    if (pending || saved || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);

    const resolved = resolvedRows();
    try {
      // 1) Push edited grams to the inventory item first, so the sale (and every
      //    later view) reflects the corrected weight. Refused grams abort the save.
      for (const { row, item } of resolved) {
        if (!item) continue;
        const override = row.grams.trim();
        if (override && override !== (item.grams ?? '').trim()) {
          const g = await updateInventoryGramsAction(item.id, override);
          if (!g.ok) {
            setError(`Could not update grams for ${item.code}: ${g.error}`);
            return;
          }
        }
      }

      // 2) Save the Walk-In into its hold state with up to two verified payments.
      const res = await saveWalkInOrderAction({
        customerName: customerInput.trim(),
        items: resolved.map(({ row, item }) => ({
          inventoryItemId: item!.id,
          price: centavosToStr(rowTotalCentavos(row, item)),
          quantity: 1,
        })),
        payments: pays
          .filter((p) => p.amount.trim() !== '')
          .map((p) => ({
            method: p.method,
            amount: p.amount.trim(),
            reference: p.reference.trim() || null,
            date: saleDate || null,
          })),
        saleDate: saleDate || null,
        adminId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }

      // 3) Transfer per the DB-authoritative balance: fully paid → Completed, else
      //    For Reminder. A failed transfer leaves the saved order in For Invoice,
      //    which the operator can still move by hand — so it is reported, not hidden.
      const fullyPaid = priceCentavos(res.balance) <= 0n;
      let destination: 'reminder' | 'completed' = fullyPaid ? 'completed' : 'reminder';
      const transfer = fullyPaid
        ? await completeWalkInOrderAction(res.officialOrderId)
        : await transferWalkInToReminderAction(res.officialOrderId);
      if (!transfer.ok) {
        setError(
          `Saved as ${res.orderNumber}, but moving it to ${
            fullyPaid ? 'Completed' : 'For Reminder'
          } failed: ${transfer.error}. You can move it from the Orders list.`,
        );
        destination = fullyPaid ? 'completed' : 'reminder';
      }

      setReviewing(false);
      setSaved({
        officialOrderId: res.officialOrderId,
        orderNumber: res.orderNumber,
        itemCount: res.itemCount,
        total: res.total,
        slip: buildSlip(res.orderNumber),
        walkIn: true,
        destination,
        balance: res.balance,
      });
      router.refresh();
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
        maxWidthClass="sm:max-w-[680px]"
        title={
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
            {saved.walkIn ? 'New Entry Walk-In' : 'New Order Entry'}
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
              {saved.walkIn
                ? saved.destination === 'completed'
                  ? 'Walk-in saved and completed'
                  : 'Walk-in saved and moved to For Reminder'
                : 'Order saved to For Invoice'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Order <strong>{saved.orderNumber}</strong> · {saved.itemCount} item
              {saved.itemCount === 1 ? '' : 's'} · Total{' '}
              <strong>{formatPeso(saved.total)}</strong>
              {saved.walkIn ? (
                saved.destination === 'completed' ? (
                  <> · fully paid. All items were retired to Completed inventory.</>
                ) : (
                  <>
                    {' '}
                    · remaining balance{' '}
                    <strong>{formatPeso(saved.balance ?? '0')}</strong>.
                  </>
                )
              ) : (
                <>. The items are reserved to this order.</>
              )}
            </p>
          </div>

          {/* Walk-In never prints, so the print status block only applies to New
              Entry. */}
          {saved.walkIn ? null : printState === 'failed' ? (
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

  // Review-before-save overlay (Walk-In). Shows exactly what will be written — items
  // with their (possibly edited) grams, the total, each payment, and where the sale
  // will land — and is the confirmation step for any grams change. Nothing is saved
  // until "Confirm & Save".
  if (reviewing) {
    const reviewRows = resolvedRows();
    const activePays = pays.filter((p) => p.amount.trim() !== '');
    const fullyPaid = balanceCentavos <= 0n && totalCentavos > 0n;
    return (
      <Modal
        open
        onClose={() => (pending ? undefined : setReviewing(false))}
        critical
        size="md"
        maxWidthClass="sm:max-w-[680px]"
        title={
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
            Review Walk-In
          </span>
        }
        footer={
          <div className="flex w-full gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReviewing(false)}
              disabled={pending}
              className="flex-1"
            >
              Back
            </Button>
            <Button
              type="button"
              onClick={() => void confirmWalkIn()}
              disabled={pending}
              data-testid="walkin-confirm-save"
              className="flex-1 font-bold"
            >
              {pending ? 'Saving…' : 'Confirm & Save'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3" data-testid="walkin-review">
          <div className="rounded-lg border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Customer</span>
              <span className="font-medium">{customerInput.trim()}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Admin</span>
              <span className="font-medium">{adminName}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{saleDate || '—'}</span>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Items
            </p>
            <div className="space-y-1.5">
              {reviewRows.map(({ row, item }, i) => {
                const g = effectiveGrams(row, item);
                const changed =
                  row.grams.trim() && row.grams.trim() !== (item?.grams ?? '').trim();
                return (
                  <div
                    key={row.key}
                    className="flex items-center justify-between text-sm"
                    data-testid={`walkin-review-item-${i}`}
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-mono">{item?.code ?? '—'}</span>
                      {g ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {g}g
                          {changed ? (
                            <span className="text-gold-strong"> (was {item?.grams ?? '—'}g)</span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {formatPeso(centavosToStr(rowTotalCentavos(row, item)))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-base">
              <span className="font-semibold">Total</span>
              <span className="font-bold tabular-nums">
                {formatPeso(centavosToStr(totalCentavos))}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Payments
            </p>
            {activePays.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payment recorded yet.</p>
            ) : (
              <div className="space-y-1">
                {activePays.map((p, i) => (
                  <div
                    key={p.key}
                    className="flex justify-between text-sm"
                    data-testid={`walkin-review-payment-${i}`}
                  >
                    <span className="text-muted-foreground">
                      {methodLabel(p.method)}
                      {p.reference.trim() ? ` · ${p.reference.trim()}` : ''}
                    </span>
                    <span className="tabular-nums">{formatPeso(p.amount.trim())}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 flex justify-between border-t border-border pt-2 text-sm">
              <span className="text-muted-foreground">Total Paid</span>
              <span className="tabular-nums">
                {formatPeso(centavosToStr(paidCentavos < 0n ? 0n : paidCentavos))}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-sm">
              <span className="font-semibold">Remaining Balance</span>
              <span className="font-bold tabular-nums">
                {formatPeso(centavosToStr(balanceCentavos < 0n ? 0n : balanceCentavos))}
              </span>
            </div>
          </div>

          <p
            className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs"
            data-testid="walkin-review-destination"
          >
            On save, this Walk-In will be moved to{' '}
            <strong>{fullyPaid ? 'Completed' : 'For Reminder'}</strong>
            {fullyPaid ? ' (fully paid).' : ' with its remaining balance.'}
          </p>

          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    );
  }

  const submitLabel =
    mode === 'walkin' ? 'Save' : pending ? 'Saving…' : 'Confirm Order';

  return (
    <Modal
      open
      onClose={onClose}
      critical
      size="md"
      maxWidthClass="sm:max-w-[680px]"
      title={
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
          {mode === 'walkin' ? 'New Entry Walk-In' : 'New Order Entry'}
        </span>
      }
      footer={
        <Button
          type="button"
          onClick={() => (mode === 'walkin' ? openReview() : void handleSubmit())}
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
        {/* Customer Name + Admin Name side by side (one line on desktop). Admin Name
            is the signed-in account, read-only. The Walk-In tab keeps its own "Name"
            label — untouched. */}
        <div className="grid gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>{mode === 'walkin' ? 'Name' : 'Customer Name'}</L>
            <Combobox
              className={fieldClass}
              placeholder="Select a customer… or type a new name"
              value={customerInput}
              onChange={setCustomerInput}
              options={customers.map((c) => c.displayName)}
            />
          </label>
          <label className="block">
            <L>Admin Name</L>
            <AdminNameField admins={admins} className={fieldClass} />
          </label>
        </div>

        <hr className="border-border" />

        <ItemRows
          items={pickItems}
          rows={rows}
          setRows={setRows}
          catalogPrefill={mode === 'order'}
          editableGrams={mode === 'walkin'}
        />

        <OrderSummary total={totalCentavos} count={rows.length} />

        {/* Photos sit AFTER the total (Owner request), one per selected item. */}
        <ItemPhotos
          items={resolvedRows()
            .map(({ item }) => item)
            .filter((i): i is PickItem => i !== null)}
        />

        {mode === 'walkin' ? (
          <div className="space-y-2" data-testid="walkin-payments">
            <div className="flex items-center justify-between">
              <L>Payment (optional — up to three methods)</L>
              {pays.length < 3 ? (
                <button
                  type="button"
                  onClick={() => setPays((ps) => [...ps, newPay('e_wallet')])}
                  data-testid="walkin-add-payment"
                  className="rounded-md border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground hover:bg-accent"
                >
                  ＋ Add method
                </button>
              ) : null}
            </div>

            {pays.map((p, i) => (
              <div
                key={p.key}
                className="rounded-lg border border-border p-2.5"
                data-testid={`walkin-payment-${i}`}
              >
                <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
                  <label className="block">
                    <L>Mode of Payment</L>
                    <select
                      value={p.method}
                      onChange={(e) => patchPay(p.key, { method: e.target.value })}
                      className={fieldClass}
                    >
                      {PAYMENT_METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <L>Amount Paid</L>
                    <MoneyInput
                      className={cn(fieldClass, 'text-right tabular-nums')}
                      placeholder="0.00"
                      value={p.amount}
                      onValueChange={(v) => patchPay(p.key, { amount: v })}
                    />
                  </label>
                </div>
                {/* Reference + Date share one line (Date is the shared sale date,
                    shown once beside the last payment's reference). */}
                <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                  <div className="flex items-end gap-2">
                    <label className="block flex-1">
                      <L>Reference (optional)</L>
                      <input
                        className={fieldClass}
                        placeholder="e.g. GCash ref no."
                        value={p.reference}
                        onChange={(e) => patchPay(p.key, { reference: e.target.value })}
                      />
                    </label>
                    {pays.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setPays((ps) => ps.filter((x) => x.key !== p.key))}
                        data-testid={`walkin-payment-remove-${i}`}
                        className="mb-0.5 rounded-md border border-border px-2 py-2 text-[11px] text-destructive hover:bg-destructive/10"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  {i === pays.length - 1 ? (
                    <label className="block">
                      <L>Date</L>
                      <input
                        type="date"
                        value={saleDate}
                        onChange={(e) => setSaleDate(e.target.value)}
                        className={fieldClass}
                      />
                    </label>
                  ) : null}
                </div>
              </div>
            ))}

            {/* Live paid / balance read-out (the DB stays the authority on save). */}
            <div className="rounded-lg border border-border bg-secondary/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total Paid</span>
                <span className="tabular-nums" data-testid="walkin-total-paid">
                  {formatPeso(centavosToStr(paidCentavos < 0n ? 0n : paidCentavos))}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
                <span className="font-semibold">Remaining Balance</span>
                <span className="font-bold tabular-nums" data-testid="walkin-balance">
                  {formatPeso(centavosToStr(balanceCentavos < 0n ? 0n : balanceCentavos))}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {balanceCentavos <= 0n && totalCentavos > 0n
                  ? 'Fully paid — this will be saved and moved to Completed.'
                  : 'With a balance, this will be saved and moved to For Reminder.'}
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

      </div>
    </Modal>
  );
}

export function NewOrderWorkflow({
  customers,
  items,
  walkInItems,
  canCreate,
  admins,
}: {
  customers: Customer[];
  items: CaptureItem[];
  walkInItems: WalkInItem[];
  canCreate: boolean;
  admins: AdminNameContext;
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
          admins={admins}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
