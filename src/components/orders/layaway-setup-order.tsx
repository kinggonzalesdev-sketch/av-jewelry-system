'use client';

import { useEffect, useState } from 'react';

import {
  createLayawayFromOrderAction,
  previewLayawayCodeAction,
} from '@/lib/payments/actions';
import { formatPeso } from '@/lib/payments/format';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { MoneyInput } from '@/components/ui/money-input';
import { cn } from '@/lib/utils';

/**
 * Set Up Layaway — the "fill up" popup shown on a For-Layaway order (Owner request
 * 2026-07-30). It creates a layaway ledger account from the ORDER's customer + total
 * amount + total grams (all read-only), editing only the financial details: interest,
 * term, remarks, payment. It never modifies the order or inventory — the items stay
 * on the order. The layaway code is automatic and the database recomputes every
 * figure on save; the preview here is a courtesy.
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
function perGramCentavos(grams: string, rate: string): bigint {
  const g = (grams ?? '').trim();
  if (!/^\d*\.?\d*$/.test(g) || !PRICE_RE.test((rate ?? '').trim())) return 0n;
  const [gw = '0', gf = ''] = g.split('.');
  const milli = BigInt(gw || '0') * 1000n + BigInt(`${gf}000`.slice(0, 3) || '0');
  const r = centavos(rate);
  if (milli === 0n || r === 0n) return 0n;
  return (r * milli + 500n) / 1000n;
}

export function LayawaySetupForOrder({
  orderId,
  customerName,
  adminName,
  itemAmount,
  grams,
  onDone,
}: {
  orderId: string;
  customerName: string;
  adminName: string | null;
  /** Order total (string money) — the layaway item amount. */
  itemAmount: string;
  /** Total grams across the order's items (string), or '' when none. */
  grams: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="order-setup-layaway"
        className="font-semibold"
      >
        Set Up Layaway
      </Button>
      {open ? (
        <SetupForm
          orderId={orderId}
          customerName={customerName}
          adminName={adminName}
          itemAmount={itemAmount}
          grams={grams}
          onClose={() => setOpen(false)}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}

function SetupForm({
  orderId,
  customerName,
  adminName,
  itemAmount,
  grams,
  onClose,
  onDone,
}: {
  orderId: string;
  customerName: string;
  adminName: string | null;
  itemAmount: string;
  grams: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [noInterest, setNoInterest] = useState(false);
  const [term, setTerm] = useState<1 | 2 | 3>(3);
  const [remarks, setRemarks] = useState('');
  const [payment, setPayment] = useState('');
  const [mop, setMop] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [reference, setReference] = useState('');

  // Assigned Layaway Code (Owner request): the system auto-assigns the next free
  // code for the customer's first letter. Shown read-only here as a courtesy — the
  // database claims the code on Save and re-derives a free one if it was taken.
  const [assignedCode, setAssignedCode] = useState<string | null>(null);
  const codeLetter = (customerName ?? '').toUpperCase().match(/[A-Z]/)?.[0] ?? null;
  useEffect(() => {
    const name = (customerName ?? '').trim();
    if (!name) return;
    let cancelled = false;
    void previewLayawayCodeAction(name).then((res) => {
      if (!cancelled) setAssignedCode(res.code);
    });
    return () => {
      cancelled = true;
    };
  }, [customerName]);

  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<null | {
    accountNo: string;
    layawayCode: string | null;
    grandTotal: string;
    payment: string;
    balance: string;
  }>(null);

  const itemCentavos = centavos(itemAmount);
  const hasGrams = Boolean(grams && Number(grams) > 0);
  const monthlyInterest = noInterest || !hasGrams ? 0n : perGramCentavos(grams, '150');
  const grandTotal = itemCentavos + monthlyInterest;
  const paidCentavos = centavos(payment);
  const balance = grandTotal - paidCentavos;

  const validate = (): string | null => {
    if (itemCentavos <= 0n) return 'This order has no amount to place on layaway.';
    if (!noInterest && !hasGrams) {
      return 'This order has no grams, so per-gram interest cannot be charged. Use No Interest.';
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
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await createLayawayFromOrderAction({
        orderId,
        interestType: noInterest ? 'none' : 'per_gram',
        term,
        remarks: remarks.trim() || null,
        payment: payment.trim() || '0',
        modeOfPayment: mop,
        reference: reference.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setSaved({
        accountNo: res.accountNo,
        layawayCode: res.layawayCode,
        grandTotal: res.grandTotal,
        payment: res.payment,
        balance: res.balance,
      });
      setConfirming(false);
      onDone();
    } catch {
      setError('The layaway account could not be saved. Please try again.');
      setConfirming(false);
    } finally {
      setPending(false);
    }
  };

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
        <div className="space-y-3" data-testid="setup-layaway-saved">
          <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-3 text-sm">
            <p className="font-semibold">Account {saved.accountNo}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Created from this order
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
      ariaLabel="Set Up Layaway"
      size="lg"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={openConfirm} disabled={pending} data-testid="setup-layaway-save">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {/* Fixed from the order (read-only). */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Customer Name</L>
            <input className={readonlyClass} value={customerName} readOnly data-testid="setup-customer" />
          </label>
          <label className="block">
            <L>Admin Name</L>
            <input className={readonlyClass} value={adminName ?? ''} readOnly />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Total Amount</L>
            <input
              className={readonlyClass}
              value={formatPeso(itemAmount)}
              readOnly
              data-testid="setup-total"
            />
          </label>
          <label className="block">
            <L>Total Grams</L>
            <input className={readonlyClass} value={hasGrams ? `${grams}g` : '—'} readOnly />
          </label>
        </div>

        {/* Assigned Layaway Code — auto-assigned from the first free code for the
            customer's letter. Read-only; the database claims it on Save. */}
        <label className="block">
          <L>Assigned Layaway Code</L>
          <input
            className={readonlyClass}
            value={assignedCode ?? ''}
            readOnly
            placeholder={
              assignedCode
                ? undefined
                : codeLetter
                  ? 'Finding a code…'
                  : 'No letter to assign a code from'
            }
            data-testid="setup-layaway-code"
          />
          {assignedCode ? (
            <span className="mt-1 block text-[11px] text-muted-foreground">
              Code assigned automatically
            </span>
          ) : codeLetter ? (
            <span className="mt-1 block text-[11px] text-destructive">
              No available code under letter {codeLetter}
            </span>
          ) : null}
        </label>

        {/* Editable: interest + term. */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <label className="block">
            <L>Monthly Interest (Grams × ₱150)</L>
            <input
              className={cn(fieldClass, 'bg-muted/40', noInterest && 'opacity-60')}
              value={noInterest ? '0% Interest' : formatPeso(toStr(monthlyInterest))}
              readOnly
              data-testid="setup-interest"
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
                  data-testid={`setup-term-${t}`}
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

        {/* Editable: Remarks / Financer + Payment + Mode of Payment (one line). */}
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <label className="block">
            <L>Remarks / Financer</L>
            <input
              className={fieldClass}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Optional"
              data-testid="setup-remarks"
            />
          </label>
          <label className="block">
            <L>Payment</L>
            <MoneyInput
              className={fieldClass}
              placeholder="0.00"
              value={payment}
              onValueChange={setPayment}
              data-testid="setup-payment"
            />
          </label>
          <label className="block">
            <L>Mode of Payment</L>
            <select
              className={fieldClass}
              value={mop}
              onChange={(e) => setMop(e.target.value)}
              data-testid="setup-mop"
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
            data-testid="setup-reference"
          />
        </label>

        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm"
          data-testid="setup-totals"
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
          <p role="alert" className="text-sm text-destructive" data-testid="setup-error">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setNoInterest((v) => !v)}
          data-testid="setup-no-interest"
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

      <Modal
        open={confirming}
        onClose={() => (pending ? undefined : setConfirming(false))}
        title="Create this layaway account?"
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Back
            </Button>
            <Button type="button" onClick={() => void save()} disabled={pending} data-testid="setup-confirm">
              {pending ? 'Saving…' : 'Confirm & Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5 text-sm" data-testid="setup-review">
          <Line label="Customer" value={customerName} />
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
      <dd className={cn('tabular-nums', strong ? 'font-bold' : 'font-medium')}>{formatPeso(value)}</dd>
    </div>
  );
}
