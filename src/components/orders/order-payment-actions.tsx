'use client';

import { useState } from 'react';

import { addOrderPaymentAction } from '@/lib/orders/actions';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';

/**
 * Add Payment / Add Down Payment-Deposit for an order (Order View modal, beside the
 * payment summary). Records a real received payment strictly within the remaining
 * balance; the DB is the authority (this mirrors its checks for instant feedback).
 * A fully-paid order disables both buttons. Never advances the workflow status.
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

export function OrderPaymentActions({
  orderId,
  remaining,
  paidInFull,
  canRecord,
  onRefresh,
}: {
  orderId: string;
  remaining: string;
  paidInFull: boolean;
  canRecord: boolean;
  onRefresh: () => void;
}) {
  const [mode, setMode] = useState<null | 'payment' | 'deposit'>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [mop, setMop] = useState('cash');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canRecord) return null;

  const remainingCentavos = centavos(remaining);
  const fullyPaid = paidInFull || remainingCentavos <= 0n;

  const open = (m: 'payment' | 'deposit') => {
    setMode(m);
    setAmount('');
    setDate(today());
    setMop('cash');
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
      isDeposit: mode === 'deposit',
    });
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    setMode(null);
    onRefresh();
  };

  const isDeposit = mode === 'deposit';

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
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={fullyPaid}
          onClick={() => open('payment')}
          data-testid="order-add-payment"
        >
          Add Payment
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={fullyPaid}
          onClick={() => open('deposit')}
          data-testid="order-add-deposit"
        >
          Add Down Payment / Deposit
        </Button>
      </div>

      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={isDeposit ? 'Add Down Payment / Deposit' : 'Add Payment'}
        description={`Remaining balance: ${formatPeso(remaining)}`}
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={pending || !amount.trim()}
            >
              {pending ? 'Saving…' : isDeposit ? 'Record deposit' : 'Record payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{isDeposit ? 'Deposit Amount' : 'Payment Amount'}</Label>
            <MoneyInput
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-3 text-right text-sm tabular-nums outline-none focus:border-gold"
              placeholder="0.00"
              value={amount}
              onValueChange={setAmount}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="order-pay-date" className="text-xs">
                {isDeposit ? 'Deposit Date' : 'Payment Date'}
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
                <option value="cash">Cash</option>
                <option value="e_wallet">E-Wallet (GCash / Maya)</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
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
    </div>
  );
}
