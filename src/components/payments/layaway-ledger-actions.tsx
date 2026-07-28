'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  addLayawayLedgerPaymentAction,
  loadLayawayLedgerDetailAction,
  updateLayawayLedgerAccountAction,
} from '@/lib/payments/actions';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';

/** Today in the USER'S LOCAL date (never the UTC date, which rolls a day early in PH). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
};

/** A peso string as EXACT integer centavos — never through a JS float. */
function centavos(value: string | null): bigint {
  if (!value) return 0n;
  const negative = value.trim().startsWith('-');
  const clean = value.replace(/[^\d.]/g, '');
  const [whole = '0', fraction = ''] = clean.split('.');
  const c = BigInt(whole || '0') * 100n + BigInt(`${fraction}00`.slice(0, 2) || '0');
  return negative ? -c : c;
}

function pesoString(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * Owner/Admin "Add Payment" for an imported layaway account.
 *
 * Remaining Balance = Grand Total − Total Payments, computed here in EXACT integer
 * centavos (never a float). A payment must be greater than zero and must never
 * exceed the remaining balance; a fully-paid account cannot take another payment at
 * all. Those rules are checked HERE for immediate feedback and again in the database
 * function, which is the real gate — so nothing is saved when validation fails, even
 * if this form is bypassed. The recorder is captured as Received By.
 */
export function LedgerAddPayment({
  id,
  accountNo,
  customerName,
  grandTotal,
  paidToDate,
}: {
  id: string;
  accountNo: string;
  customerName: string;
  grandTotal: string | null;
  paidToDate: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mop, setMop] = useState('cash');
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ balance: string; status: string } | null>(null);
  // Guards a double-tap / double-submit even before React re-renders the disabled
  // button — a repeat click must never record the payment twice.
  const submittingRef = useRef(false);

  const remainingCents = centavos(grandTotal) - centavos(paidToDate);
  const fullyPaid = remainingCents <= 0n;
  const amountCents = centavos(amount);
  const exceeds = amountCents > remainingCents;
  // Live, client-side validation mirroring the database's rules verbatim.
  const validationError = !amount.trim()
    ? null
    : amountCents <= 0n
      ? 'Enter a payment amount greater than zero.'
      : exceeds
        ? `Payment exceeds the remaining balance of ${formatPeso(pesoString(remainingCents))}.`
        : null;
  const canSubmit = !pending && !fullyPaid && amountCents > 0n && !exceeds;

  const reset = () => {
    setAmount('');
    setDate(today());
    setMop('cash');
    setReference('');
    setError(null);
    setDone(null);
    setPending(false);
  };

  const run = async () => {
    // Never submit an invalid payment, and never submit the same one twice.
    if (!canSubmit || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await addLayawayLedgerPaymentAction({
        ledgerId: id,
        amount: amount.trim(),
        paymentDate: date || null,
        mop: mop || null,
        reference: reference.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone({ balance: res.balance, status: res.status });
      router.refresh();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={fullyPaid}
        title={fullyPaid ? 'This layaway account is already fully paid.' : undefined}
        data-testid={`ledger-add-payment-${id}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        Add Payment
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add layaway payment"
        description={`Account ${accountNo} — ${customerName}`}
        size="sm"
        footer={
          done ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void run()} disabled={!canSubmit}>
                {pending ? 'Recording…' : 'Record payment'}
              </Button>
            </>
          )
        }
      >
        {done ? (
          <div className="space-y-2" data-testid="ledger-payment-done">
            <p className="text-sm">
              Payment recorded. New balance{' '}
              <strong>{formatPeso(done.balance)}</strong>.
            </p>
            {done.status === 'completed' ? (
              <p className="rounded-md border border-green-600/40 bg-green-600/10 px-2 py-1.5 text-xs text-green-700">
                Fully paid — the account is now <strong>Completed</strong> and its code
                was released.
              </p>
            ) : null}
          </div>
        ) : fullyPaid ? (
          <p
            role="alert"
            className="rounded-md border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
            data-testid="ledger-payment-fully-paid"
          >
            This layaway account is already fully paid.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Remaining balance:{' '}
              <strong data-testid="ledger-payment-remaining">
                {formatPeso(pesoString(remainingCents))}
              </strong>{' '}
              <span className="text-[10px]">(Grand Total − Total Payments)</span>
            </p>
            <div>
              <Label className="text-xs">Amount</Label>
              <MoneyInput
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-right text-sm tabular-nums outline-none focus:border-gold"
                placeholder="0.00"
                value={amount}
                onValueChange={setAmount}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`ledger-pay-date-${id}`} className="text-xs">
                  Payment Date
                </Label>
                <Input
                  id={`ledger-pay-date-${id}`}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label htmlFor={`ledger-pay-mop-${id}`} className="text-xs">
                  Mode of Payment
                </Label>
                <select
                  id={`ledger-pay-mop-${id}`}
                  value={mop}
                  onChange={(e) => setMop(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
                >
                  <option value="cash">Cash</option>
                  <option value="gcash">GCash</option>
                  <option value="maya">Maya</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="card">Card</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor={`ledger-pay-ref-${id}`} className="text-xs">
                Reference / Notes (optional)
              </Label>
              <Input
                id={`ledger-pay-ref-${id}`}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. GCash ref, OR number"
                className="mt-1 h-9"
              />
            </div>
            {validationError ?? error ? (
              <p role="alert" className="text-sm text-destructive">
                {validationError ?? error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}

/**
 * Owner/Admin "Edit" for an imported layaway account. Corrects the descriptive +
 * money fields; the DB recomputes Grand Total (Item + Interest) and Balance and
 * auto-completes a fully-paid account. Payment history is never touched here.
 */
export function LedgerEditAccount({
  id,
  accountNo,
}: {
  id: string;
  accountNo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState('');
  const [remarks, setRemarks] = useState('');
  const [datePurchased, setDatePurchased] = useState('');
  const [itemAmount, setItemAmount] = useState('');
  const [interest, setInterest] = useState('');
  const [nextDueDate, setNextDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const openModal = async () => {
    setOpen(true);
    setError(null);
    setLoading(true);
    try {
      const d = await loadLayawayLedgerDetailAction(id);
      if (!d) {
        setError('That account could not be loaded.');
      } else {
        setCustomerName(d.customerName ?? '');
        setRemarks(d.remarks ?? '');
        setDatePurchased(d.datePurchased ?? '');
        setItemAmount(d.itemAmount ?? '');
        setInterest(d.interest ?? '');
        setNextDueDate(d.nextDueDate ?? '');
        setNotes(d.notes ?? '');
      }
    } catch {
      setError('That account could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const run = async () => {
    if (pending || !customerName.trim()) return;
    setPending(true);
    setError(null);
    const res = await updateLayawayLedgerAccountAction({
      id,
      customerName: customerName.trim(),
      remarks: remarks.trim() || null,
      datePurchased: datePurchased || null,
      itemAmount: itemAmount.trim() || null,
      interest: interest.trim() || null,
      nextDueDate: nextDueDate || null,
      notes: notes.trim() || null,
    });
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setOpen(false);
    setPending(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void openModal()}
        data-testid={`ledger-edit-${id}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        Edit
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit layaway account"
        description={`Account ${accountNo}`}
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={pending || loading || !customerName.trim()}
            >
              {pending ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`ledger-edit-name-${id}`} className="text-xs">
                Customer Name
              </Label>
              <Input
                id={`ledger-edit-name-${id}`}
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Item Amount</Label>
                <MoneyInput
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-right text-sm tabular-nums outline-none focus:border-gold"
                  placeholder="0.00"
                  value={itemAmount}
                  onValueChange={setItemAmount}
                />
              </div>
              <div>
                <Label className="text-xs">Interest</Label>
                <MoneyInput
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-right text-sm tabular-nums outline-none focus:border-gold"
                  placeholder="0.00"
                  value={interest}
                  onValueChange={setInterest}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Grand Total (Item + Interest) and Balance are recomputed on save.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`ledger-edit-datep-${id}`} className="text-xs">
                  Date Purchased
                </Label>
                <Input
                  id={`ledger-edit-datep-${id}`}
                  type="date"
                  value={datePurchased}
                  onChange={(e) => setDatePurchased(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
              <div>
                <Label htmlFor={`ledger-edit-due-${id}`} className="text-xs">
                  Next Due Date
                </Label>
                <Input
                  id={`ledger-edit-due-${id}`}
                  type="date"
                  value={nextDueDate}
                  onChange={(e) => setNextDueDate(e.target.value)}
                  className="mt-1 h-9"
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`ledger-edit-remarks-${id}`} className="text-xs">
                Remarks / Financer
              </Label>
              <Input
                id={`ledger-edit-remarks-${id}`}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor={`ledger-edit-notes-${id}`} className="text-xs">
                Notes
              </Label>
              <Input
                id={`ledger-edit-notes-${id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
