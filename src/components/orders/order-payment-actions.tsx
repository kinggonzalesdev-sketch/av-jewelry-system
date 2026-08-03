'use client';

import { useState } from 'react';

import { addOrderPaymentAction } from '@/lib/orders/actions';
import { formatPeso } from '@/lib/payments/format';
import { DEFAULT_PAYMENT_METHOD, PAYMENT_METHOD_OPTIONS } from '@/lib/payments/methods';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';

/**
 * Add Payment for an order (Order View modal, beside the payment summary).
 *
 * There is ONE money button. "Add Down Payment / Deposit" was removed by Owner
 * request: a deposit is just a payment, and two buttons writing the same record
 * only invited miscategorising it. Existing deposits keep their original label in
 * payment history — nothing was rewritten.
 *
 * Records a real received payment strictly within the remaining balance; the DB is
 * the authority (this mirrors its checks for instant feedback). The control is not
 * rendered at all once the order is fully paid, and is disabled while saving.
 * Never advances the workflow status.
 */

const PRICE_RE = /^\d{1,12}(\.\d{1,2})?$/;
const today = () => new Date().toISOString().slice(0, 10);

/** Raw price string → exact centavos. '' / invalid → 0. */
function centavos(raw: string): bigint {
  const s = (raw ?? '').trim();
  if (!PRICE_RE.test(s)) return 0n;
  const [w = '0', f = ''] = s.split('.');
  return BigInt(w || '0') * 100n + BigInt(`${f}00`.slice(0, 2) || '0');
}

/** Exact centavos → a peso-formatted string (never a float). */
function pesoFromCentavos(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return formatPeso(`${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`);
}

/** Never show a negative pending balance. */
function clampZero(c: bigint): bigint {
  return c < 0n ? 0n : c;
}

/** One label/value line in the Add-Payment computation panel. */
function CompRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

export function OrderPaymentActions({
  orderId,
  remaining,
  paidInFull,
  canRecord,
  onRefresh,
  asButton = false,
  total,
  paid,
  dueDate,
}: {
  orderId: string;
  remaining: string;
  paidInFull: boolean;
  canRecord: boolean;
  onRefresh: () => void;
  /** Header mode: render JUST the Add Payment button + its modal (no card, no
   *  "Record a payment" label), so it can sit beside the X in the modal header. */
  asButton?: boolean;
  /** For the live paid / pending computation panel (all optional). */
  total?: string | undefined;
  paid?: string | undefined;
  dueDate?: string | null | undefined;
}) {
  const [showForm, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mop, setMop] = useState<string>(DEFAULT_PAYMENT_METHOD);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRecord) return null;

  const remainingCentavos = centavos(remaining);
  const fullyPaid = paidInFull || remainingCentavos <= 0n;

  const openForm = () => {
    setOpen(true);
    setAmount('');
    setDate(today());
    setMop(DEFAULT_PAYMENT_METHOD);
    setReference('');
    setNotes('');
    setError(null);
    setPending(false);
  };

  const run = async () => {
    if (pending) return;
    const amt = amount.trim();
    if (!PRICE_RE.test(amt) || Number(amt) <= 0) {
      setError('Enter a payment amount greater than zero.');
      return;
    }
    // Frontend mirror of the DB rule: never exceed the remaining balance.
    if (centavos(amt) > remainingCentavos) {
      setError(`Payment exceeds the remaining balance of ${formatPeso(remaining)}.`);
      return;
    }
    setPending(true);
    setError(null);
    const res = await addOrderPaymentAction({
      orderId,
      amount: amt,
      paymentDate: date || null,
      method: mop,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    });
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    setOpen(false);
    onRefresh();
  };

  const addButton = (
    <Button
      type="button"
      size="sm"
      disabled={fullyPaid}
      onClick={openForm}
      data-testid="order-add-payment"
    >
      Add Payment
    </Button>
  );

  // Header mode: just the button + its modal, no surrounding card.
  if (asButton) {
    return (
      <>
        {addButton}
        {renderPaymentModal()}
      </>
    );
  }

  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-payment-actions">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Record a payment
      </p>
      {fullyPaid ? (
        <p
          className="rounded-md border border-green-600/40 bg-green-600/10 px-2 py-1.5 text-xs text-green-700"
          data-testid="order-fully-paid"
        >
          This order is already fully paid. No additional payment can be added.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">{addButton}</div>

      {renderPaymentModal()}
    </div>
  );

  function renderPaymentModal() {
    return (
      <Modal
        open={showForm}
        onClose={() => setOpen(false)}
        title="Add Payment"
        description={`Remaining balance: ${formatPeso(remaining)}`}
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={pending || !amount.trim()}
            >
              {pending ? 'Saving…' : 'Record payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Payment Amount</Label>
            <MoneyInput
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-right text-sm tabular-nums outline-none focus:border-gold"
              placeholder="0.00"
              value={amount}
              onValueChange={setAmount}
            />
          </div>

          {/* Live computation — paid so far, this payment, and what's left. */}
          {total !== undefined || paid !== undefined || dueDate ? (
            <dl
              className="space-y-0.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs"
              data-testid="order-pay-computation"
            >
              {total !== undefined ? <CompRow label="Total amount" value={formatPeso(total)} /> : null}
              {paid !== undefined ? <CompRow label="Paid so far" value={formatPeso(paid)} /> : null}
              <CompRow label="Pending balance" value={formatPeso(remaining)} />
              {amount.trim() ? (
                <>
                  <CompRow label="This payment" value={formatPeso(amount.trim())} />
                  {paid !== undefined ? (
                    <CompRow
                      label="Total paid after"
                      value={pesoFromCentavos(centavos(paid) + centavos(amount))}
                      strong
                    />
                  ) : null}
                  <CompRow
                    label="Pending after"
                    value={pesoFromCentavos(clampZero(remainingCentavos - centavos(amount)))}
                    strong
                  />
                </>
              ) : null}
              {dueDate ? <CompRow label="Due date" value={dueDate} /> : null}
            </dl>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="order-pay-date" className="text-xs">
                Payment Date
              </Label>
              <Input
                id="order-pay-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor="order-pay-mop" className="text-xs">
                Mode of Payment
              </Label>
              <select
                id="order-pay-mop"
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
            <Label htmlFor="order-pay-ref" className="text-xs">
              Reference Number
            </Label>
            <Input
              id="order-pay-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. GCash ref no."
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="order-pay-notes" className="text-xs">
              Notes
            </Label>
            <Input
              id="order-pay-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="mt-1 h-9"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive" data-testid="order-pay-error">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    );
  }
}
