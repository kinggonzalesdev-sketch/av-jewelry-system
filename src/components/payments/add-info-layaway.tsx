'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  addLayawayInfoAction,
  listLayawaySourcesAction,
  previewLayawayCodeAction,
} from '@/lib/payments/actions';
import type { LayawaySourceRow } from '@/lib/payments/layaway-entry';
import type { AdminNameContext } from '@/lib/authz/admin-name';
import { AdminNameField } from '@/components/orders/admin-name-field';
import { formatPeso } from '@/lib/payments/format';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { cn } from '@/lib/utils';

/**
 * Layaway "Add Info" (Owner request 2026-07-30).
 *
 * Creates an ADDITIONAL layaway record from an existing source record, reusing the
 * SAME customer + item + stored item amount (all read-only), and editing only the
 * financial details — interest, term, remarks/financer, payment. It mirrors the New
 * Entry Layaway popup's design, spacing and validation; the customer, item, grams,
 * pricing and item total are fixed from the source and cannot be replaced here.
 *
 * The layaway code is AUTOMATIC (customer's first letter, read-only). Nothing is
 * reserved while the popup is open — the server re-checks and claims a free code
 * only when the record saves, and re-derives another if the previewed one was taken.
 * Interest is Grams × ₱150 for MONTH 1 ONLY (later months post one at a time); No
 * Interest pins it to ₱0. Every figure is recomputed by the database on save — the
 * preview is a courtesy, never the source of truth. It never re-consumes inventory.
 */

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold';
const readonlyClass = cn(fieldClass, 'bg-muted/40');

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;

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

export function AddInfoLayaway({
  financers,
  admins,
  canCreate,
}: {
  financers: string[];
  admins: AdminNameContext;
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={!canCreate}
        data-testid="layaway-add-info"
        className="font-semibold"
        title={canCreate ? undefined : 'Creating a layaway record is Owner/Admin only.'}
      >
        ＋ Add Info
      </Button>
      {open ? (
        <AddInfoForm
          financers={financers}
          admins={admins}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function AddInfoForm({
  financers,
  admins,
  onClose,
}: {
  financers: string[];
  admins: AdminNameContext;
  onClose: () => void;
}) {
  const router = useRouter();
  const adminId = admins.selfId;

  const [sources, setSources] = useState<LayawaySourceRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceInput, setSourceInput] = useState('');

  // Fetch the selectable source records once, when the popup opens.
  useEffect(() => {
    let cancelled = false;
    void listLayawaySourcesAction().then((list) => {
      if (cancelled) return;
      setSources(list);
      setSourcesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const sourceLabel = (s: LayawaySourceRow) =>
    `${s.accountNo} · ${s.customerName}${s.itemCode ? ` · ${s.itemCode}` : ''} · ${formatPeso(
      s.itemAmount,
    )}`;
  const byLabel = useMemo(() => {
    const m = new Map<string, LayawaySourceRow>();
    for (const s of sources) m.set(sourceLabel(s), s);
    return m;
  }, [sources]);
  const source = byLabel.get(sourceInput.trim()) ?? null;

  // ---- Editable financial fields ------------------------------------------
  const [noInterest, setNoInterest] = useState(false);
  const [term, setTerm] = useState<1 | 2 | 3>(3);
  const [remarks, setRemarks] = useState('');
  const [payment, setPayment] = useState('');
  const [mop, setMop] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [reference, setReference] = useState('');

  // ---- Assigned Layaway Code (automatic, read-only) -----------------------
  const [assignedCode, setAssignedCode] = useState<{ letter: string | null; code: string | null }>(
    { letter: null, code: null },
  );
  useEffect(() => {
    const name = source?.customerName?.trim();
    let cancelled = false;
    if (!name) {
      // Async reset avoids a synchronous setState in the effect body.
      void Promise.resolve().then(() => {
        if (!cancelled) setAssignedCode({ letter: null, code: null });
      });
      return () => {
        cancelled = true;
      };
    }
    void previewLayawayCodeAction(name).then((res) => {
      if (!cancelled) setAssignedCode({ letter: res.letter, code: res.code });
    });
    return () => {
      cancelled = true;
    };
  }, [source?.customerName]);

  // ---- Live preview, exact centavos (the DB recomputes on save) -----------
  const itemCentavos = source ? centavos(source.itemAmount) : 0n;
  const monthlyInterest =
    noInterest || !source?.grams ? 0n : perGramCentavos(source.grams, '150');
  const grandTotal = itemCentavos + monthlyInterest; // item + month 1 only
  const paidCentavos = centavos(payment);
  const balance = grandTotal - paidCentavos;

  const derivedPerGram =
    source && source.grams && Number(source.grams) > 0
      ? toStr((itemCentavos * 1000n + BigInt(Math.round(Number(source.grams) * 1000)) / 2n) /
          BigInt(Math.round(Number(source.grams) * 1000)))
      : null;

  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | {
    accountNo: string;
    layawayCode: string | null;
    itemCode: string;
    itemAmount: string;
    monthlyInterest: string;
    grandTotal: string;
    payment: string;
    balance: string;
    term: number;
    interestType: 'none' | 'per_gram';
  }>(null);

  const validate = (): string | null => {
    if (!source) return 'Select a source layaway record.';
    if (itemCentavos <= 0n) return 'The source record has no item amount to reuse.';
    if (!noInterest && (!source.grams || Number(source.grams) <= 0)) {
      return 'The source item has no grams, so per-gram interest cannot be charged. Use No Interest.';
    }
    if (paidCentavos > grandTotal) {
      return `Payment exceeds the remaining balance of ${formatPeso(toStr(grandTotal))}.`;
    }
    return null;
  };

  const openConfirm = () => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const save = async () => {
    if (pending || !source) return;
    setPending(true);
    setError(null);
    try {
      const res = await addLayawayInfoAction({
        sourceLedgerId: source.ledgerId,
        interestType: noInterest ? 'none' : 'per_gram',
        term,
        remarks: remarks.trim() || null,
        payment: payment.trim() || '0',
        modeOfPayment: mop,
        reference: reference.trim() || null,
        adminId,
      });
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setSaved({
        accountNo: res.accountNo,
        layawayCode: res.layawayCode,
        itemCode: res.itemCode,
        itemAmount: res.itemAmount,
        monthlyInterest: res.monthlyInterest,
        grandTotal: res.grandTotal,
        payment: res.payment,
        balance: res.balance,
        term,
        interestType: noInterest ? 'none' : 'per_gram',
      });
      setConfirming(false);
      // Layaway, Inventory, Orders and Dashboard all refresh in place.
      router.refresh();
    } catch {
      setError('The layaway record could not be saved. Please try again.');
      setConfirming(false);
    } finally {
      setPending(false);
    }
  };

  // ---- Saved receipt: the figures the DATABASE stored ----------------------
  if (saved) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Layaway record created"
        size="md"
        footer={
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div className="space-y-3" data-testid="add-info-saved">
          <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-3 text-sm">
            <p className="font-semibold">Account {saved.accountNo}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Added from existing information
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
            <Fig label="Item total" value={saved.itemAmount} />
            <Fig
              label="Monthly interest"
              value={saved.interestType === 'none' ? '0' : saved.monthlyInterest}
            />
            <Fig label="Grand total (now)" value={saved.grandTotal} strong />
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
      ariaLabel="Add Info Layaway"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={openConfirm}
            disabled={pending || !source}
            data-testid="add-info-save"
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Source record — the only free choice; it fixes the customer + item. */}
        <label className="block">
          <L>Source Layaway Record</L>
          <Combobox
            className={fieldClass}
            placeholder={sourcesLoading ? 'Loading records…' : 'Search by account, customer or item'}
            value={sourceInput}
            onChange={setSourceInput}
            options={sources.map(sourceLabel)}
          />
        </label>

        {/* Customer + Admin, both read-only. */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Customer Name</L>
            <input
              className={readonlyClass}
              value={source?.customerName ?? ''}
              readOnly
              placeholder="Select a source record"
              data-testid="add-info-customer"
            />
          </label>
          <label className="block">
            <L>Admin Name</L>
            <AdminNameField admins={admins} className={fieldClass} />
          </label>
        </div>

        {/* Assigned Layaway Code — automatic, read-only. A short code, so it only
            takes a narrow slot rather than a full row. */}
        <label className="block sm:max-w-[280px]">
          <L>Assigned Layaway Code</L>
          <input
            className={readonlyClass}
            value={assignedCode.code ?? ''}
            readOnly
            placeholder={
              !source ? 'Select a source record' : assignedCode.letter ? 'Finding a code…' : '—'
            }
            data-testid="add-info-code"
          />
          {source && assignedCode.code ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Code assigned automatically
            </span>
          ) : source && assignedCode.letter ? (
            <span className="mt-1 block text-[11px] text-destructive" data-testid="add-info-code-none">
              No available layaway code remains under letter {assignedCode.letter}.
            </span>
          ) : null}
        </label>

        {/* Item + Grams + Date Purchased — read-only, from the source (one line). */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <label className="block">
            <L>Item</L>
            <input
              className={readonlyClass}
              value={
                source
                  ? `${source.itemCode ?? '—'}${source.itemName ? ` · ${source.itemName}` : ''}`
                  : ''
              }
              readOnly
              placeholder="Select a source record"
              data-testid="add-info-item"
            />
          </label>
          <label className="block">
            <L>Grams</L>
            <input
              className={readonlyClass}
              value={source?.grams ? `${source.grams}g` : ''}
              readOnly
              data-testid="add-info-grams"
            />
          </label>
          <label className="block">
            <L>Date Purchased</L>
            <input
              className={readonlyClass}
              value={source?.datePurchased ?? ''}
              readOnly
              data-testid="add-info-date"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Price per Gram (from source)</L>
            <input
              className={readonlyClass}
              value={derivedPerGram ? formatPeso(derivedPerGram) : '—'}
              readOnly
            />
          </label>
          <label className="block">
            <L>Item Total</L>
            <input
              className={readonlyClass}
              value={source ? formatPeso(source.itemAmount) : ''}
              readOnly
              data-testid="add-info-item-total"
            />
          </label>
        </div>

        {/* ---- Editable: Interest + Term --------------------------------- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Monthly Interest (Grams × ₱150)</L>
            <input
              className={cn(fieldClass, 'bg-muted/40', noInterest && 'opacity-60')}
              value={noInterest ? '0% Interest' : formatPeso(toStr(monthlyInterest))}
              readOnly
              data-testid="add-info-interest"
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
                  data-testid={`add-info-term-${t}`}
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

        {/* ---- Editable: Remarks / Financer + Payment + Mode (one line) --- */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
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
          <label className="block">
            <L>Payment</L>
            <MoneyInput
              className={fieldClass}
              placeholder="0.00"
              value={payment}
              onValueChange={setPayment}
              data-testid="add-info-payment"
            />
          </label>
          <label className="block">
            <L>Mode of Payment</L>
            <select
              className={fieldClass}
              value={mop}
              onChange={(e) => setMop(e.target.value)}
              data-testid="add-info-mop"
            >
              {PAYMENT_METHOD_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <L>Payment Reference (when applicable)</L>
          <input
            className={fieldClass}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. GCash ref no."
            data-testid="add-info-reference"
          />
        </label>

        {/* ---- Review summary -------------------------------------------- */}
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm"
          data-testid="add-info-totals"
        >
          <Fig label="Item total" value={toStr(itemCentavos)} />
          <Fig label="Monthly interest" value={noInterest ? '0' : toStr(monthlyInterest)} />
          <div className="flex items-center justify-between gap-2 py-0.5">
            <dt className="text-xs text-muted-foreground">Term</dt>
            <dd className="font-medium tabular-nums">
              {term} {term === 1 ? 'month' : 'months'}
            </dd>
          </div>
          <Fig label="Payment" value={toStr(paidCentavos)} />
          <Fig label="Grand total (now)" value={toStr(grandTotal)} strong />
          <Fig label="Remaining balance" value={toStr(balance)} strong />
        </dl>

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="add-info-error">
            {error}
          </p>
        ) : null}

        {/* No Interest — a sticky mode, mirroring New Entry. */}
        <button
          type="button"
          onClick={() => setNoInterest((v) => !v)}
          data-testid="add-info-no-interest"
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

      {/* Final confirmation popup before the record is written. */}
      <Modal
        open={confirming}
        onClose={() => (pending ? undefined : setConfirming(false))}
        title="Create this layaway record?"
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </Button>
            <Button type="button" onClick={() => void save()} disabled={pending} data-testid="add-info-confirm">
              {pending ? 'Saving…' : 'Confirm & Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5 text-sm" data-testid="add-info-review">
          <Line label="Customer" value={source?.customerName ?? '—'} />
          <Line label="Assigned Code" value={assignedCode.code ?? '—'} />
          <Line label="Item" value={source?.itemCode ?? '—'} />
          <Line label="Item Total" value={formatPeso(toStr(itemCentavos))} />
          <Line label="Monthly Interest" value={noInterest ? '₱0' : formatPeso(toStr(monthlyInterest))} />
          <Line label="Term" value={`${term} ${term === 1 ? 'month' : 'months'}`} />
          <Line label="Payment" value={formatPeso(toStr(paidCentavos))} />
          <Line label="Grand Total" value={formatPeso(toStr(grandTotal))} strong />
          <Line label="Remaining Balance" value={formatPeso(toStr(balance))} strong />
        </div>
      </Modal>
    </Modal>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('tabular-nums', strong ? 'font-bold' : 'font-medium')}>{value}</span>
    </div>
  );
}

function Fig({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'font-bold' : 'font-medium')}>
        {formatPeso(value)}
      </dd>
    </div>
  );
}
