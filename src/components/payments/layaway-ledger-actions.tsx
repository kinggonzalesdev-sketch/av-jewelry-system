'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  addLayawayLedgerPaymentAction,
  addLayawayPaymentAndTransferAction,
  cancelLayawayLedgerAction,
  loadLayawayLedgerDetailAction,
  transferLayawayToDestinationAction,
  updateLayawayLedgerAccountAction,
} from '@/lib/payments/actions';
import { formatPeso } from '@/lib/payments/format';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
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
  nextDueDate = null,
  code = null,
  canTransfer = true,
}: {
  id: string;
  accountNo: string;
  customerName: string;
  grandTotal: string | null;
  paidToDate: string | null;
  /** Next installment due date, shown in the computation panel. */
  nextDueDate?: string | null;
  /** Layaway Code — shown in the transfer confirmation. */
  code?: string | null;
  /** Whether this user may transfer to a destination (else only "No transfer"). */
  canTransfer?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mop, setMop] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [reference, setReference] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ balance: string; status: string } | null>(null);
  // Transfer to Destination (optional, combined with the payment as one action).
  const [dest, setDest] = useState('');
  const [confirming, setConfirming] = useState(false);
  // true = the confirm popup is a TRANSFER-ONLY (Save) action, no payment recorded.
  const [transferOnly, setTransferOnly] = useState(false);
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
    setDest('');
    setConfirming(false);
    setTransferOnly(false);
  };

  const DEST_LABELS: Record<string, string> = {
    pickup: 'For Pickup',
    delivery: 'For Delivery',
    shipping: 'For Shipping',
    keep: 'Keep',
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

  // Combined action: record the payment AND transfer, atomically (one RPC).
  const runCombined = async () => {
    if (!canSubmit || !dest || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await addLayawayPaymentAndTransferAction(
        {
          ledgerId: id,
          amount: amount.trim(),
          paymentDate: date || null,
          mop: mop || null,
          reference: reference.trim() || null,
        },
        dest,
      );
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      // The account left active layaway; close and let the lists refresh it away.
      setConfirming(false);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  // "Save" = transfer ONLY (no payment). Uses the standalone transfer RPC.
  const runTransferOnly = async () => {
    if (!dest || submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await transferLayawayToDestinationAction(id, dest);
      if (!res.ok) {
        setError(res.error);
        setConfirming(false);
        return;
      }
      setConfirming(false);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  // "Pending balance after" this payment, for the transfer confirmation.
  const remainingAfterCents = remainingCents - amountCents < 0n ? 0n : remainingCents - amountCents;

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        data-testid={`ledger-add-payment-${id}`}
        {...(fullyPaid
          ? { title: 'Fully paid — open to transfer it to a destination.' }
          : {})}
      >
        {fullyPaid ? 'Transfer' : 'Add Payment'}
      </Button>

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
              {/* Save = transfer ONLY (no payment). Enabled once a destination is
                  picked, so an account can be moved without recording a payment. */}
              {dest ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setTransferOnly(true);
                    setConfirming(true);
                  }}
                  disabled={pending}
                  data-testid={`ledger-pay-save-${id}`}
                >
                  Save
                </Button>
              ) : null}
              {/* No "Record payment" for a fully-paid account — only Save (transfer). */}
              {fullyPaid ? null : (
              <Button
                type="button"
                onClick={() => {
                  if (dest) {
                    setTransferOnly(false);
                    setConfirming(true);
                  } else {
                    void run();
                  }
                }}
                disabled={!canSubmit}
                data-testid={`ledger-pay-submit-${id}`}
              >
                {pending
                  ? 'Recording…'
                  : dest
                    ? 'Record Payment & Transfer'
                    : 'Record payment'}
              </Button>
              )}
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
            {Number(done.balance) <= 0 ? (
              <p className="flex items-center gap-1.5 rounded-md border border-green-600/40 bg-green-600/10 px-2 py-1.5 text-xs text-green-700">
                <span aria-hidden="true">✓</span> This account is now fully paid. It stays
                here — transfer it to a destination when you&apos;re ready.
              </p>
            ) : null}
          </div>
        ) : fullyPaid ? (
          <div className="space-y-3">
            <p
              className="flex items-center gap-1.5 rounded-md border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm text-green-700"
              data-testid="ledger-payment-fully-paid"
            >
              <span aria-hidden="true">✓</span> This account is already fully paid. It stays
              here — transfer it to a destination when you&apos;re ready.
            </p>
            {canTransfer ? (
              <div>
                <Label htmlFor={`ledger-pay-dest-${id}`} className="text-xs">
                  Transfer to Destination
                </Label>
                <select
                  id={`ledger-pay-dest-${id}`}
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
                  data-testid={`ledger-pay-dest-${id}`}
                >
                  <option value="">Choose destination…</option>
                  <option value="pickup">For Pickup</option>
                  <option value="delivery">For Delivery</option>
                  <option value="shipping">For Shipping</option>
                  <option value="keep">Keep</option>
                </select>
              </div>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Amount</Label>
              <MoneyInput
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-right text-sm tabular-nums outline-none focus:border-gold"
                placeholder="0.00"
                value={amount}
                onValueChange={setAmount}
              />
            </div>

            {/* Live computation — paid so far, this payment, and what's left. */}
            <dl
              className="space-y-0.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs"
              data-testid="ledger-pay-computation"
            >
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Grand total</dt>
                <dd className="tabular-nums">{formatPeso(grandTotal ?? '0')}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Paid so far</dt>
                <dd className="tabular-nums">{formatPeso(paidToDate ?? '0')}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Pending balance</dt>
                <dd className="tabular-nums" data-testid="ledger-payment-remaining">
                  {formatPeso(pesoString(remainingCents))}
                </dd>
              </div>
              {amount.trim() ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">This payment</dt>
                    <dd className="tabular-nums">{formatPeso(amount.trim())}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Total paid after</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatPeso(pesoString(centavos(paidToDate) + amountCents))}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Pending after</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatPeso(
                        pesoString(
                          remainingCents - amountCents < 0n ? 0n : remainingCents - amountCents,
                        ),
                      )}
                    </dd>
                  </div>
                </>
              ) : null}
              {nextDueDate ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Next due date</dt>
                  <dd className="tabular-nums">{nextDueDate}</dd>
                </div>
              ) : null}
            </dl>
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
                  {PAYMENT_METHOD_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
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

            {/* Transfer to Destination — OPTIONAL. Selecting a destination turns the
                one footer action into "Record Payment & Transfer" (one atomic step). */}
            {canTransfer ? (
              <div>
                <Label htmlFor={`ledger-pay-dest-${id}`} className="text-xs">
                  Transfer to Destination
                </Label>
                <select
                  id={`ledger-pay-dest-${id}`}
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
                  data-testid={`ledger-pay-dest-${id}`}
                >
                  <option value="">No transfer</option>
                  <option value="pickup">For Pickup</option>
                  <option value="delivery">For Delivery</option>
                  <option value="shipping">For Shipping</option>
                  <option value="keep">Keep</option>
                </select>
              </div>
            ) : null}

            {validationError ?? error ? (
              <p role="alert" className="text-sm text-destructive">
                {validationError ?? error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>

      {/* Payment+Transfer OR transfer-only (Save) confirmation — double-click-protected. */}
      <Modal
        open={confirming}
        onClose={() => (pending ? undefined : setConfirming(false))}
        title={
          transferOnly
            ? `Transfer this Layaway account to ${DEST_LABELS[dest] ?? dest}?`
            : `Record this payment and transfer the Layaway account to ${DEST_LABELS[dest] ?? dest}?`
        }
        size="sm"
        critical
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void (transferOnly ? runTransferOnly() : runCombined())}
              disabled={pending}
              data-testid={`ledger-pay-transfer-confirm-${id}`}
            >
              {pending
                ? 'Processing…'
                : transferOnly
                  ? 'Confirm Transfer'
                  : 'Confirm Payment & Transfer'}
            </Button>
          </>
        }
      >
        <dl className="space-y-1.5 text-sm" data-testid="ledger-pay-transfer-review">
          <ConfirmLine label="Customer" value={customerName || '—'} />
          <ConfirmLine label="Layaway Code" value={code ?? '—'} />
          {transferOnly ? null : (
            <>
              <ConfirmLine
                label="Payment Amount"
                value={amount.trim() ? formatPeso(amount.trim()) : '—'}
              />
              <ConfirmLine label="Mode of Payment" value={mop} />
            </>
          )}
          <ConfirmLine
            label="Remaining Balance"
            value={formatPeso(pesoString(transferOnly ? remainingCents : remainingAfterCents))}
            strong
          />
          <ConfirmLine label="Destination" value={DEST_LABELS[dest] ?? dest} strong />
        </dl>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
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
  canTransfer = true,
}: {
  id: string;
  accountNo: string;
  /** Whether this user may transfer to a destination (else the control is hidden). */
  canTransfer?: boolean;
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
  // Optional Transfer to Destination — applied on Save, after the field edits.
  const [dest, setDest] = useState('');

  const openModal = async () => {
    setOpen(true);
    setError(null);
    setDest('');
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
    // If a destination was chosen, transfer AFTER the edits are saved. A transfer
    // failure (e.g. an imported account with no linked order) surfaces its own
    // message but the field edits above are already persisted.
    if (dest) {
      const t = await transferLayawayToDestinationAction(id, dest);
      if (!t.ok) {
        setPending(false);
        setError(t.error);
        return;
      }
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
        className="rounded-md border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent"
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
              {pending ? 'Saving…' : dest ? 'Save & Transfer' : 'Save changes'}
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

            {/* Transfer to Destination — OPTIONAL. Choosing one moves the account to
                that Orders destination when you Save (after the field edits). */}
            {canTransfer ? (
              <div>
                <Label htmlFor={`ledger-edit-dest-${id}`} className="text-xs">
                  Transfer to Destination
                </Label>
                <select
                  id={`ledger-edit-dest-${id}`}
                  value={dest}
                  onChange={(e) => setDest(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
                  data-testid={`ledger-edit-dest-${id}`}
                >
                  <option value="">No transfer</option>
                  <option value="pickup">For Pickup</option>
                  <option value="delivery">For Delivery</option>
                  <option value="shipping">For Shipping</option>
                  <option value="keep">Keep</option>
                </select>
              </div>
            ) : null}

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
 * "Cancel Order" for a layaway ledger account (Owner/Admin) — shown beside Add
 * Payment inside the View modal. Sets the account to Cancelled and releases its
 * code (payment history is kept). Confirm step; the DB is the real gate. `onDone`
 * lets the parent View modal close itself after a successful cancel.
 */
export function LedgerCancelAccount({
  id,
  accountNo,
  customerName,
  code = null,
  onDone,
}: {
  id: string;
  accountNo: string;
  customerName: string;
  code?: string | null;
  /** Called after a successful cancel — e.g. to close the View modal. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);

  const run = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await cancelLayawayLedgerAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirming(false);
      router.refresh();
      onDone?.();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => {
          setError(null);
          setConfirming(true);
        }}
        data-testid={`ledger-cancel-${id}`}
      >
        Cancel Order
      </Button>

      <Modal
        open={confirming}
        onClose={() => (pending ? undefined : setConfirming(false))}
        title="Cancel this Layaway account?"
        size="sm"
        critical
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep account
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run()}
              disabled={pending}
              data-testid={`ledger-cancel-confirm-${id}`}
            >
              {pending ? 'Cancelling…' : 'Yes, Cancel Order'}
            </Button>
          </>
        }
      >
        <dl className="space-y-1.5 text-sm">
          <ConfirmLine label="Customer" value={customerName || '—'} />
          <ConfirmLine label="Layaway Code" value={code ?? '—'} />
          <ConfirmLine label="Account No." value={accountNo} />
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          The account is marked <strong>Cancelled</strong> and its code is released. Payment
          history is kept. This can&apos;t be undone.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Modal>
    </>
  );
}

function ConfirmLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-bold tabular-nums' : 'font-medium tabular-nums'}>{value}</dd>
    </div>
  );
}
