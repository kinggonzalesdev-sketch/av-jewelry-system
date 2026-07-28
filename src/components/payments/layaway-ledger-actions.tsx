'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

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

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Owner/Admin "Add Payment" for an imported layaway account. Records a real payment
 * (attributed to the recorder — Received By), which recomputes Payment + Balance and
 * auto-completes the account when fully paid. The DB function is the real gate.
 */
export function LedgerAddPayment({
  id,
  accountNo,
  customerName,
  balance,
}: {
  id: string;
  accountNo: string;
  customerName: string;
  balance: string | null;
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
    if (pending || !amount.trim()) return;
    setPending(true);
    setError(null);
    const res = await addLayawayLedgerPaymentAction({
      ledgerId: id,
      amount: amount.trim(),
      paymentDate: date || null,
      mop: mop || null,
      reference: reference.trim() || null,
    });
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    setDone({ balance: res.balance, status: res.status });
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        data-testid={`ledger-add-payment-${id}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
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
              <Button
                type="button"
                onClick={() => void run()}
                disabled={pending || !amount.trim()}
              >
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
        ) : (
          <div className="space-y-3">
            {balance ? (
              <p className="text-xs text-muted-foreground">
                Current balance: <strong>{formatPeso(balance)}</strong>
              </p>
            ) : null}
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
