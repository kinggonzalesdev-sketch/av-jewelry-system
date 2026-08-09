'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  createLayawayAccountAction,
  previewLayawayCodeAction,
} from '@/lib/payments/actions';
import type { CaptureItem } from '@/lib/orders/service';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { hkFixedPrice, isHKItem } from '@/lib/inventory/hk-item';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { AdminNameField } from '@/components/orders/admin-name-field';
import { formatPeso } from '@/lib/payments/format';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { CustomerMatchHint } from '@/components/customers/customer-match-hint';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { cn } from '@/lib/utils';

/**
 * Layaway New Entry — full manual encoding, now MULTI-ITEM (like Orders → New
 * Order). A layaway can hold several items; their amounts and grams are summed.
 *
 * Interest = (TOTAL grams × ₱150) per month × the chosen term (1/2/3) — the whole
 * term is reflected in the Grand Total. "No Interest" pins it to ₱0. Grams come
 * from the item's stored weight, or are read from the item code when blank.
 *
 * Every figure previewed here is recomputed by the database on save; the preview
 * is a courtesy, never the source of truth.
 */

type Row = { id: string; code: string; name: string | null; grams: string | null };
type ItemRow = { key: string; input: string; pricingType: 'fixed' | 'per_gram'; price: string };

/** Monotonic key source for item rows — module scope so it is never read from a
 *  ref during render (React keys only need to be unique, not meaningful). */
let itemKeySeq = 0;
const newItemRow = (): ItemRow => ({
  key: `it-${(itemKeySeq += 1)}`,
  input: '',
  pricingType: 'fixed',
  price: '',
});

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold';

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

/** Raw money string → exact centavos. Never a float. */
function centavos(raw: string): bigint {
  const s = (raw ?? '').trim();
  if (!PRICE_RE.test(s)) return 0n;
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w || '0') * 100n + BigInt(`${f}00`.slice(0, 2) || '0');
}
function toStr(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}
/** grams × per-gram rate in exact integer units (grams → milligrams). */
function perGramCentavos(grams: string, rate: string): bigint {
  const g = (grams ?? '').trim();
  if (!/^\d*\.?\d*$/.test(g) || !PRICE_RE.test((rate ?? '').trim())) return 0n;
  const [gw = '0', gf = ''] = g.split('.');
  const milli = BigInt(gw || '0') * 1000n + BigInt(`${gf}000`.slice(0, 3) || '0');
  const r = centavos(rate);
  if (milli === 0n || r === 0n) return 0n;
  return (r * milli + 500n) / 1000n;
}

export function LayawayNewEntry({
  items,
  customers,
  financers,
  admins,
  canCreate,
}: {
  items: CaptureItem[];
  customers: string[];
  financers: string[];
  admins: AdminNameContext;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canCreate}
        data-testid="layaway-new-entry"
        className="font-semibold"
        title={canCreate ? undefined : 'Creating a layaway account is Owner/Admin only.'}
      >
        ＋ New Entry
      </Button>
      {open ? (
        <EntryForm
          items={items}
          customers={customers}
          financers={financers}
          admins={admins}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function EntryForm({
  items,
  customers,
  financers,
  admins,
  onClose,
}: {
  items: CaptureItem[];
  customers: string[];
  financers: string[];
  admins: AdminNameContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);

  const rows: Row[] = useMemo(
    () =>
      items.map((i) => ({
        id: i.id,
        code: i.itemCode,
        name: i.itemName,
        // Reflect the item's declared grams; when blank, fall back to the grams
        // encoded in the item code (e.g. "SBA-P-2367 0.55g").
        grams: i.gramsPerPiece ?? parseInventoryCode(i.itemCode).grams,
      })),
    [items],
  );
  const label = (r: Row) => `${r.code}${r.name ? ` · ${r.name}` : ''}`;
  const byLabel = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) m.set(label(r), r);
    return m;
  }, [rows]);
  const itemOptions = useMemo(() => rows.map(label), [rows]);

  const adminId = admins.selfId;
  const [customer, setCustomer] = useState('');

  // ---- Multiple items ------------------------------------------------------
  const [itemRows, setItemRows] = useState<ItemRow[]>(() => [newItemRow()]);
  const patchRow = (key: string, patch: Partial<ItemRow>) =>
    setItemRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setItemRows((rs) => [...rs, newItemRow()]);
  const removeRow = (key: string) =>
    setItemRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : rs));
  // Selecting an item. An HK ITEM is always Fixed Price at the price written after
  // "HK ITEM" in its code/name (the quoted number is the size, not the price).
  const onItem = (key: string, value: string) => {
    const picked = byLabel.get(value.trim()) ?? null;
    const patch: Partial<ItemRow> = { input: value };
    if (picked && isHKItem(picked)) {
      patch.pricingType = 'fixed';
      const p = hkFixedPrice(picked);
      if (p) patch.price = p;
    }
    patchRow(key, patch);
  };

  // No Interest is sticky: it stays on until the operator turns it off.
  const [noInterest, setNoInterest] = useState(false);
  const [term, setTerm] = useState<1 | 2 | 3>(3);

  const [datePurchased, setDatePurchased] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [payment, setPayment] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [mop, setMop] = useState<string>(DEFAULT_PAYMENT_METHOD);

  // ---- Automatic Layaway Code (unchanged) ---------------------------------
  const letterOf = (name: string): string | null => {
    const m = (name ?? '').toUpperCase().match(/[A-Z]/);
    return m ? m[0] : null;
  };
  const letter = letterOf(customer.trim());
  const [fetchedCode, setFetchedCode] = useState<{ letter: string; code: string | null } | null>(
    null,
  );
  useEffect(() => {
    const name = customer.trim();
    const l = letterOf(name);
    if (!l) return;
    let cancelled = false;
    void previewLayawayCodeAction(name).then((res) => {
      if (!cancelled) setFetchedCode({ letter: l, code: res.code });
    });
    return () => {
      cancelled = true;
    };
  }, [customer]);
  const assigned = {
    letter,
    code: fetchedCode && fetchedCode.letter === letter ? fetchedCode.code : null,
  };

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | {
    accountNo: string;
    layawayCode: string | null;
    itemCode: string;
    itemAmount: string;
    monthlyInterest: string;
    interest: string;
    grandTotal: string;
    payment: string;
    balance: string;
    term: number;
    interestType: 'none' | 'per_gram';
  }>(null);

  // ---- Live preview, in exact centavos (the DB recomputes on save) ---------
  const derived = itemRows.map((r) => {
    const row = byLabel.get(r.input.trim()) ?? null;
    // HK ITEM is fixed-price — grams do not apply (no interest contribution; the
    // grams line shows —).
    const grams = row && isHKItem(row) ? null : (row?.grams ?? null);
    const amountC =
      r.pricingType === 'per_gram' ? perGramCentavos(grams ?? '', r.price) : centavos(r.price);
    return { r, row, grams, amountC };
  });
  const totalItemC = derived.reduce((s, d) => s + d.amountC, 0n);
  // Grams are summed for interest only (a preview; the DB recomputes exactly).
  const totalGrams = derived.reduce((s, d) => s + (d.grams ? Number(d.grams) : 0), 0);
  const monthlyC = noInterest || totalGrams <= 0 ? 0n : perGramCentavos(String(totalGrams), '150');
  const totalInterestC = monthlyC * BigInt(term); // full term reflected
  const grandTotalC = totalItemC + totalInterestC;
  const paidC = centavos(payment);
  const balanceC = grandTotalC - paidC;

  const validate = (): string | null => {
    if (!customer.trim()) return 'Enter the customer name.';
    if (!letterOf(customer)) {
      return 'The customer name has no letter to derive a layaway code from.';
    }
    for (const d of derived) {
      if (!d.row) return 'Select an item from Active Inventory for every row.';
      if (d.amountC <= 0n) {
        return d.r.pricingType === 'per_gram'
          ? 'Enter a price per gram greater than zero for each item.'
          : 'Enter a price greater than zero for each item.';
      }
      if (d.r.pricingType === 'per_gram' && !d.grams) {
        return `Item ${d.row.code} has no grams recorded, so it cannot be priced per gram.`;
      }
    }
    if (!noInterest && totalGrams <= 0) {
      return 'No grams recorded on these items, so per-gram interest cannot be charged. Use No Interest.';
    }
    if (paidC > grandTotalC) {
      return `Payment exceeds the remaining balance of ${formatPeso(toStr(grandTotalC))}.`;
    }
    return null;
  };

  const save = async () => {
    if (pending) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await createLayawayAccountAction({
        customerName: customer.trim(),
        items: derived.map((d) => ({
          inventoryItemId: d.row!.id,
          pricingType: d.r.pricingType,
          price: d.r.price.trim(),
        })),
        interestType: noInterest ? 'none' : 'per_gram',
        term,
        datePurchased: datePurchased || null,
        paymentDate: paymentDate || null,
        remarks: remarks.trim() || null,
        payment: payment.trim() || '0',
        modeOfPayment: mop,
        adminId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved({
        accountNo: res.accountNo,
        layawayCode: res.layawayCode,
        itemCode: res.itemCode,
        itemAmount: res.itemAmount,
        monthlyInterest: res.monthlyInterest,
        interest: res.interest,
        grandTotal: res.grandTotal,
        payment: res.payment,
        balance: res.balance,
        term,
        interestType: noInterest ? 'none' : 'per_gram',
      });
      router.refresh();
    } catch {
      setError('The layaway account could not be saved. Please try again.');
    } finally {
      setPending(false);
    }
  };

  // ---- Saved receipt: the figures the DATABASE stored, not the preview -----
  if (saved) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Layaway account created"
        size="md"
        footer={
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-3" data-testid="layaway-saved">
          <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-3 text-sm">
            <p className="font-semibold">Account {saved.accountNo}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Item <strong>{saved.itemCode}</strong> has left Active Inventory
              {saved.layawayCode ? (
                <>
                  {' '}
                  · Layaway Code <strong>{saved.layawayCode}</strong>
                </>
              ) : null}
              .
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <Fig label="Item amount" value={saved.itemAmount} />
            <Fig
              label="Monthly interest"
              value={saved.interestType === 'none' ? '0' : saved.monthlyInterest}
            />
            <div className="flex items-center justify-between gap-2 py-0.5">
              <dt className="text-xs text-muted-foreground">Term</dt>
              <dd className="font-medium tabular-nums">
                {saved.term} {saved.term === 1 ? 'month' : 'months'}
              </dd>
            </div>
            <Fig
              label={`Total interest (${saved.term} ${saved.term === 1 ? 'mo' : 'mos'})`}
              value={saved.interest}
            />
            <Fig label="Grand total" value={saved.grandTotal} strong />
            <Fig label="Payment" value={saved.payment} />
            <Fig label="Current balance" value={saved.balance} strong />
          </dl>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={pending ? () => undefined : onClose}
      ariaLabel="Layaway New Entry"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={pending}
            data-testid="layaway-save"
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Customer first — its first letter drives the automatic code below. */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Customer Name</L>
            <Combobox
              className={fieldClass}
              placeholder="Select a customer… or type a new name"
              value={customer}
              onChange={setCustomer}
              options={customers}
            />
            {/* Shared match hint — reuse an existing customer (and see its FB-linked
                state) instead of creating a duplicate. Picking one fills its exact name. */}
            <CustomerMatchHint
              name={customer}
              className="mt-1"
              onPick={(m) => setCustomer(m.displayName)}
            />
          </label>
          <label className="block">
            <L>Admin Name</L>
            <AdminNameField admins={admins} className={fieldClass} />
          </label>
        </div>

        {/* ---- Assigned Layaway Code + Term (one line) ------------------- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Assigned Layaway Code</L>
            <input
              className={fieldClass}
              value={assigned.code ?? ''}
              readOnly
              placeholder={customer.trim() ? 'Finding a code…' : 'Enter a customer name'}
              data-testid="layaway-code"
            />
            {assigned.code ? (
              <span
                className="mt-1 block text-[11px] text-muted-foreground"
                data-testid="layaway-code-note"
              >
                Code assigned automatically
              </span>
            ) : assigned.letter ? (
              <span
                className="mt-1 block text-[11px] text-destructive"
                data-testid="layaway-code-none"
              >
                No available code under letter {assigned.letter}
              </span>
            ) : null}
          </label>
          <div>
            <L>Term</L>
            <div className="flex h-10 items-center gap-1 rounded-lg border border-border px-1">
              {([1, 2, 3] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTerm(t)}
                  data-testid={`layaway-term-${t}`}
                  className={cn(
                    'flex-1 rounded-md px-2 py-1 text-[11px] font-semibold',
                    term === t ? 'bg-gold text-black' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {t} {t === 1 ? 'mo' : 'mos'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ---- Items (multi) --------------------------------------------- */}
        <div className="space-y-2" data-testid="layaway-items">
          <div className="flex items-center justify-between">
            <L>Items</L>
            <button
              type="button"
              onClick={addRow}
              data-testid="layaway-add-item"
              className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
            >
              ＋ Add item
            </button>
          </div>
          {derived.map((d, idx) => {
            const hk = d.row ? isHKItem(d.row) : false;
            const hkPrice = hk && d.row ? hkFixedPrice(d.row) : null;
            const hkLocked = hk && Boolean(hkPrice);
            return (
            <div
              key={d.r.key}
              className="space-y-2 rounded-lg border border-border p-3"
              data-testid="layaway-item-row"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Item {idx + 1}
                </span>
                {itemRows.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeRow(d.r.key)}
                    className="text-[11px] text-destructive hover:underline"
                    data-testid="layaway-remove-item"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
                <label className="block">
                  <L>Item</L>
                  <Combobox
                    className={fieldClass}
                    placeholder="Search Active Inventory by code or name"
                    value={d.r.input}
                    onChange={(v) => onItem(d.r.key, v)}
                    options={itemOptions}
                  />
                </label>
                <div>
                  <L>Pricing Type</L>
                  <div className="flex h-10 items-center gap-1 rounded-lg border border-border px-1">
                    {hk ? (
                      // HK ITEM is fixed-price only — no per-gram option.
                      <span
                        className="flex-1 rounded-md bg-gold px-2 py-1 text-center text-[11px] font-semibold text-black"
                        data-testid="layaway-item-hk"
                      >
                        Fixed Price · HK Item
                      </span>
                    ) : (
                      (
                        [
                          ['fixed', 'Fixed Price'],
                          ['per_gram', 'Price Per Gram'],
                        ] as const
                      ).map(([k, t]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => patchRow(d.r.key, { pricingType: k })}
                          className={cn(
                            'flex-1 rounded-md px-2 py-1 text-[11px] font-semibold',
                            d.r.pricingType === k
                              ? 'bg-gold text-black'
                              : 'text-muted-foreground hover:bg-accent',
                          )}
                        >
                          {t}
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <label className="block">
                  <L>{d.r.pricingType === 'per_gram' ? 'Price Per Gram' : 'Price'}</L>
                  {hkLocked ? (
                    // HK ITEM price comes from the code/name — read-only.
                    <input
                      className={cn(fieldClass, 'bg-muted/40 text-right tabular-nums')}
                      readOnly
                      value={formatPeso(d.r.price || hkPrice || '0')}
                      data-testid="layaway-item-price"
                    />
                  ) : (
                    <MoneyInput
                      className={fieldClass}
                      placeholder="0.00"
                      value={d.r.price}
                      onValueChange={(v) => patchRow(d.r.key, { price: v })}
                      data-testid="layaway-item-price"
                    />
                  )}
                </label>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground">
                <span>Grams: {d.grams ? `${d.grams}g` : '—'}</span>
                <span>
                  Item amount: <span className="tabular-nums">{formatPeso(toStr(d.amountC))}</span>
                </span>
              </div>
            </div>
            );
          })}
        </div>

        {/* ---- Monthly Interest + Date Purchased (one line) ------------- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Monthly Interest (Total Grams × ₱150)</L>
            <input
              className={cn(fieldClass, noInterest && 'opacity-60')}
              value={noInterest ? '0% Interest' : formatPeso(toStr(monthlyC))}
              readOnly
              data-testid="layaway-interest"
            />
          </label>
          <label className="block">
            <L>Date Purchased</L>
            <input
              type="date"
              className={fieldClass}
              value={datePurchased}
              onChange={(e) => setDatePurchased(e.target.value)}
              data-testid="layaway-date"
            />
          </label>
        </div>

        {/* ---- Remarks / Financer (full width) --------------------------- */}
        <label className="block">
          <L>Remarks / Financer</L>
          <Combobox
            className={fieldClass}
            placeholder="Select or type a financer"
            value={remarks}
            onChange={setRemarks}
            options={financers}
          />
        </label>

        {/* ---- Payment + Date Payment + Mode of Payment (one line) ------- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <label className="block">
            <L>Payment</L>
            <MoneyInput
              className={fieldClass}
              placeholder="0.00"
              value={payment}
              onValueChange={setPayment}
              data-testid="layaway-payment"
            />
          </label>
          <label className="block">
            <L>Date Payment</L>
            <input
              type="date"
              className={fieldClass}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              data-testid="layaway-payment-date"
            />
          </label>
          <label className="block">
            <L>Mode of Payment</L>
            <select
              className={fieldClass}
              value={mop}
              onChange={(e) => setMop(e.target.value)}
              data-testid="layaway-mop"
            >
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ---- Totals preview -------------------------------------------- */}
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm"
          data-testid="layaway-totals"
        >
          <Fig label="Item amount" value={toStr(totalItemC)} />
          <Fig label="Monthly interest" value={noInterest ? '0' : toStr(monthlyC)} />
          <Fig
            label={`Total interest (${term} ${term === 1 ? 'mo' : 'mos'})`}
            value={noInterest ? '0' : toStr(totalInterestC)}
          />
          <Fig label="Grand total" value={toStr(grandTotalC)} strong />
          <Fig label="Current balance" value={toStr(balanceC)} strong />
        </dl>

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="layaway-error">
            {error}
          </p>
        ) : null}

        {/* ---- No Interest: a sticky mode, at the bottom as specified ----- */}
        <button
          type="button"
          onClick={() => setNoInterest((v) => !v)}
          data-testid="layaway-no-interest"
          aria-pressed={noInterest}
          className={cn(
            'h-10 w-full rounded-lg border text-sm font-semibold transition-colors',
            noInterest
              ? 'border-gold bg-gold text-black'
              : 'border-border text-muted-foreground hover:bg-accent',
          )}
        >
          {noInterest ? '✓ No Interest — 0% applied' : 'No Interest'}
        </button>
      </div>
    </Modal>
  );
}

function Fig({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-bold' : 'font-medium')}>
        {formatPeso(value)}
      </dd>
    </div>
  );
}
