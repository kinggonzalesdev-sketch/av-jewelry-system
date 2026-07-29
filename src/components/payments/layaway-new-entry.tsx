'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  createLayawayAccountAction,
  previewLayawayCodeAction,
} from '@/lib/payments/actions';
import type { CaptureItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { AdminNameField } from '@/components/orders/admin-name-field';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { cn } from '@/lib/utils';

/**
 * Layaway New Entry (§1) — full manual encoding.
 *
 * Laid out like Orders → New Order Entry, deliberately WITHOUT Take Photo,
 * Choose File, or any item-photo control: a layaway is encoded from the ledger,
 * not photographed at the counter.
 *
 * The layaway code is AUTOMATIC: it comes from the customer's first letter and is
 * shown read-only as "Assigned Layaway Code". Nothing is reserved while typing —
 * the code is only claimed when the record saves, and the server re-derives a free
 * one if another save took it first.
 *
 * Interest is Grams × ₱150 per ACTIVE month. The Grand Total shown here charges
 * MONTH 1 ONLY; later months are posted one at a time on their due dates, and only
 * while the account is still unpaid — so the total never implies money the customer
 * does not yet owe. "No Interest" pins the monthly interest to ₱0.
 *
 * Every figure previewed here is recomputed by the database on save, and what the
 * receipt shows afterwards is what SQL actually stored — the preview is a
 * courtesy, never the source of truth.
 */

type Row = { id: string; code: string; name: string | null; grams: string | null };

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
        grams: i.gramsPerPiece,
      })),
    [items],
  );
  const label = (r: Row) => `${r.code}${r.name ? ` · ${r.name}` : ''}`;
  const byLabel = useMemo(() => {
    const m = new Map<string, Row>();
    for (const r of rows) m.set(label(r), r);
    return m;
  }, [rows]);

  // Admin Name is always the signed-in account (read-only, no picker).
  const adminId = admins.selfId;
  const [customer, setCustomer] = useState('');
  const [itemInput, setItemInput] = useState('');
  const item = byLabel.get(itemInput.trim()) ?? null;

  const [pricingType, setPricingType] = useState<'fixed' | 'per_gram'>('fixed');
  const [price, setPrice] = useState('');
  const [perGram, setPerGram] = useState('');

  // No Interest is sticky: it stays on until the operator turns it off.
  const [noInterest, setNoInterest] = useState(false);
  const [term, setTerm] = useState<1 | 2 | 3>(3);

  const [datePurchased, setDatePurchased] = useState(today);
  const [remarks, setRemarks] = useState('');
  const [payment, setPayment] = useState('');
  const [mop, setMop] = useState('cash');

  // ---- Automatic Layaway Code ---------------------------------------------
  // The LETTER is derived synchronously from the name (no state needed). The free
  // CODE for that letter is fetched from the server; it reserves nothing, and is
  // only claimed when the record actually saves. Keying the code by the letter it
  // was fetched for means a name change to a different letter drops the stale one.
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

  // The code to show: only when it was fetched for the CURRENT letter, so a stale
  // fetch for a previous name never leaks through.
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
    grams: string;
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
  const itemCentavos =
    pricingType === 'per_gram'
      ? perGramCentavos(item?.grams ?? '', perGram)
      : centavos(price);

  // Monthly interest = Grams × ₱150. The GRAND TOTAL charges MONTH 1 ONLY — the
  // later months are posted month by month, and only while still unpaid, so an
  // early payoff never owes them.
  // Grams × ₱150, in exact centavos. perGramCentavos(grams, rate) is grams × rate
  // to the centavo — here the "rate" is the ₱150 interest per gram.
  const monthlyInterest =
    noInterest || !item?.grams ? 0n : perGramCentavos(item.grams, '150');
  const grandTotal = itemCentavos + monthlyInterest; // item + month 1 only
  const paidCentavos = centavos(payment);
  const balance = grandTotal - paidCentavos;
  const remainingMonths = noInterest ? 0 : term - 1;

  const validate = (): string | null => {
    if (!customer.trim()) return 'Enter the customer name.';
    if (!letterOf(customer)) {
      return 'The customer name has no letter to derive a layaway code from.';
    }
    if (!item) return 'Select an item from Active Inventory.';
    if (itemCentavos <= 0n) {
      return pricingType === 'per_gram'
        ? 'Enter a price per gram greater than zero.'
        : 'Enter a price greater than zero.';
    }
    if (pricingType === 'per_gram' && !item.grams) {
      return 'That item has no grams recorded, so it cannot be priced per gram.';
    }
    if (!noInterest && !item.grams) {
      return 'That item has no grams recorded, so per-gram interest cannot be charged. Use No Interest.';
    }
    if (paidCentavos > grandTotal) {
      return `Payment exceeds the remaining balance of ${formatPeso(toStr(grandTotal))}.`;
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
        inventoryItemId: item!.id,
        pricingType,
        price: pricingType === 'per_gram' ? perGram.trim() : price.trim(),
        interestType: noInterest ? 'none' : 'per_gram',
        term,
        datePurchased: datePurchased || null,
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
        grams: res.grams,
        itemAmount: res.itemAmount,
        monthlyInterest: res.monthlyInterest,
        interest: res.interest,
        grandTotal: res.grandTotal,
        payment: res.payment,
        balance: res.balance,
        term,
        interestType: noInterest ? 'none' : 'per_gram',
      });
      // Layaway, Inventory, Orders and Dashboard all refresh in place.
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
            <Fig label="Interest charged (Month 1)" value={saved.interest} />
            <div className="flex items-center justify-between gap-2 py-0.5">
              <dt className="text-xs text-muted-foreground">Term</dt>
              <dd className="font-medium tabular-nums">
                {saved.term} {saved.term === 1 ? 'month' : 'months'}
              </dd>
            </div>
            <Fig label="Grand total (now)" value={saved.grandTotal} strong />
            <Fig label="Payment" value={saved.payment} />
            <Fig label="Current balance" value={saved.balance} strong />
          </dl>
          {saved.interestType === 'per_gram' && saved.term > 1 ? (
            <p className="text-[11px] text-muted-foreground">
              Later months ({saved.term - 1} more) are charged one at a time on each
              due date, and only while the account is still unpaid.
            </p>
          ) : null}
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
          </label>
          <label className="block">
            <L>Admin Name</L>
            <AdminNameField admins={admins} className={fieldClass} />
          </label>
        </div>

        {/* ---- Assigned Layaway Code: automatic, read-only ---------------- */}
        <label className="block">
          <L>Assigned Layaway Code</L>
          <input
            className={fieldClass}
            value={assigned.code ?? ''}
            readOnly
            placeholder={
              customer.trim()
                ? assigned.letter
                  ? 'Finding a code…'
                  : 'Enter a customer name'
                : 'Enter a customer name'
            }
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

        <label className="block">
          <L>Item</L>
          <Combobox
            className={fieldClass}
            placeholder="Search Active Inventory by code or name"
            value={itemInput}
            onChange={setItemInput}
            options={rows.map(label)}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Grams</L>
            <input
              className={fieldClass}
              value={item?.grams ? `${item.grams}g` : ''}
              readOnly
              data-testid="layaway-grams"
            />
          </label>
          <div>
            <L>Pricing Type</L>
            <div className="flex h-10 items-center gap-1 rounded-lg border border-border px-1">
              {(
                [
                  ['fixed', 'Fixed Price'],
                  ['per_gram', 'Price Per Gram'],
                ] as const
              ).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPricingType(k)}
                  data-testid={`layaway-pricing-${k}`}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-semibold',
                    pricingType === k
                      ? 'bg-gold text-black'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        <label className="block">
          <L>{pricingType === 'per_gram' ? 'Price Per Gram' : 'Price'}</L>
          <MoneyInput
            className={fieldClass}
            placeholder="0.00"
            value={pricingType === 'per_gram' ? perGram : price}
            onValueChange={pricingType === 'per_gram' ? setPerGram : setPrice}
            data-testid="layaway-price"
          />
        </label>

        {/* ---- Interest + Term ------------------------------------------- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Monthly Interest (Grams × ₱150)</L>
            <input
              className={cn(fieldClass, noInterest && 'opacity-60')}
              value={noInterest ? '0% Interest' : formatPeso(toStr(monthlyInterest))}
              readOnly
              data-testid="layaway-interest"
            />
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
                  {t} {t === 1 ? 'month' : 'months'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
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
        </div>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
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
            <L>Mode of Payment</L>
            <select
              className={fieldClass}
              value={mop}
              onChange={(e) => setMop(e.target.value)}
              data-testid="layaway-mop"
            >
              <option value="cash">Cash</option>
              <option value="e_wallet">E-Wallet (GCash / Maya)</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="card">Card</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        {/* ---- Totals preview --------------------------------------------
            Grand Total includes MONTH 1 interest only. Future months are not
            shown here — they are charged month by month, so the total never
            implies money the customer does not yet owe. */}
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm"
          data-testid="layaway-totals"
        >
          <Fig label="Item amount" value={toStr(itemCentavos)} />
          <Fig
            label="Monthly interest"
            value={noInterest ? '0' : toStr(monthlyInterest)}
          />
          <Fig
            label="Interest charged now (Month 1)"
            value={noInterest ? '0' : toStr(monthlyInterest)}
          />
          <div className="flex items-center justify-between gap-2 py-0.5">
            <dt className="text-xs text-muted-foreground">Remaining possible months</dt>
            <dd className="font-medium tabular-nums">{remainingMonths}</dd>
          </div>
          <Fig label="Grand total (now)" value={toStr(grandTotal)} strong />
          <Fig label="Current balance" value={toStr(balance)} strong />
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
