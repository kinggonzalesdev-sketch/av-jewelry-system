'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { recordPaymentAction } from '@/lib/payments/actions';
import type { RecordPaymentActionState } from '@/lib/payments/action-state';
import { EMPTY_RECORD_PAYMENT_STATE } from '@/lib/payments/action-state';
import { formatPeso } from '@/lib/payments/format';
import { PAYMENT_METHODS } from '@/lib/payments/methods';
import type { PayableOrderRow } from '@/lib/payments/workspace';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';

/**
 * Record Payment (Bible §16; docs/PHASE-6-APPROVED-DECISIONS.md §3).
 *
 * Records SUBMITTED EVIDENCE. It does not verify, and it cannot: the domain
 * module has no `status` field to set and the payment is born
 * `submitted_unverified` in the database. Recording and verifying are separate
 * acts by separate authority — collapsing them would let a screenshot pay for a
 * ring.
 *
 * ⚠️  NO CARD DATA. There is no input here for a card number, CVV, or PIN, and
 *     none may be added. For a card payment the operator records the CHANNEL
 *     (provider) and the APPROVAL REFERENCE — that is the entire permitted
 *     footprint (§3).
 *
 * Money is rendered from strings the database already decided. Nothing on this
 * screen computes a balance.
 */

/**
 * The five canonical Mode-of-Payment choices (shared source of truth). The method
 * name IS the channel, so only Cash needs an extra field (the collection location);
 * GCash / BPI / BDO / Credit Card need nothing beyond the reference number. No card
 * number, CVV, or PIN is ever collected.
 */
const METHODS = PAYMENT_METHODS.map((m) => ({
  value: m,
  label: m,
  needsLocation: m === 'Cash',
}));

type MethodValue = (typeof METHODS)[number]['value'];

export function RecordPaymentForm({
  orders,
  lockedOrder,
  onRecorded,
  embedded = false,
}: {
  orders: PayableOrderRow[];
  /** When set, the form records against THIS one order only: the selector is
   *  hidden and the order is pre-selected. Used by the Order Details modal so
   *  the exact same guarded action runs, scoped to the order in view. */
  lockedOrder?: PayableOrderRow;
  /** Fires once each time a payment records successfully — lets the modal refresh
   *  just this order's data (partial refresh, no full page reload). */
  onRecorded?: () => void;
  /** Render WITHOUT the outer Card + header — for use inside the standard Modal
   *  (or the Order Details modal), which already provides the frame and title. */
  embedded?: boolean;
}) {
  const [state, action, pending] = useActionState<RecordPaymentActionState, FormData>(
    recordPaymentAction,
    EMPTY_RECORD_PAYMENT_STATE,
  );

  const effectiveOrders = lockedOrder ? [lockedOrder] : orders;
  const [orderId, setOrderId] = useState(lockedOrder?.officialOrderId ?? '');
  const [method, setMethod] = useState<MethodValue>('Cash');

  // Notify the parent exactly once per successful record (partial refresh).
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      onRecorded?.();
    }
  }, [state.success, onRecorded]);

  const selected = effectiveOrders.find((o) => o.officialOrderId === orderId) ?? null;
  const spec = METHODS.find((m) => m.value === method) ?? {
    value: 'Cash' as MethodValue,
    label: 'Cash',
    needsLocation: true,
  };

  if (!lockedOrder && orders.length === 0) {
    const emptyMessage = (
      <p className="text-sm text-muted-foreground">
        There are no Official Orders to record a payment against yet. An order is created
        by Approve &amp; Send Invoice.
      </p>
    );
    if (embedded) return emptyMessage;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Record Payment</CardTitle>
        </CardHeader>
        <CardContent>{emptyMessage}</CardContent>
      </Card>
    );
  }

  const formEl = (
    <form action={action} className="space-y-3">
      {/* --- Order selection -------------------------------------------
              Locked to one order inside the Order Details modal (selector hidden,
              order pre-filled); a free chooser everywhere else. */}
      {lockedOrder ? (
        <div className="space-y-1">
          <Label>Official Order</Label>
          <input
            type="hidden"
            name="officialOrderId"
            value={lockedOrder.officialOrderId}
          />
          <p className="rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
            <span className="font-mono">{lockedOrder.orderNumber}</span>
            <span className="text-muted-foreground">
              {' '}
              — {lockedOrder.customerDisplayName}
            </span>
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="officialOrderId">Official Order</Label>
          <select
            id="officialOrderId"
            name="officialOrderId"
            required
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">Select an Official Order…</option>
            {orders.map((o) => (
              <option key={o.officialOrderId} value={o.officialOrderId}>
                {o.orderNumber} — {o.customerDisplayName}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* --- Authoritative order facts, straight from the database -----
              If the balance could not be read, this says so. It NEVER renders
              ₱0.00 from a failed read: a zero balance means "nothing is owed",
              and showing that against an unpaid order is how a customer gets
              told they are square when they are not. */}
      {selected && selected.balanceUnavailable && (
        <div
          role="alert"
          data-testid="balance-unavailable"
          className="rounded-md border border-destructive/50 p-3 text-sm"
        >
          <p className="font-semibold text-destructive">Balance unavailable</p>
          <p className="mt-1 text-muted-foreground">
            The authoritative balance for {selected.orderNumber} could not be read, so it
            is not shown. This is <strong>not</strong> a zero balance.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {selected.balanceUnavailable}
          </p>
          <p className="mt-2 text-xs">
            You may still record evidence — the amount you enter is what the customer
            paid, and verification decides the balance either way.
          </p>
        </div>
      )}

      {selected && !selected.balanceUnavailable && (
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border p-3 text-sm"
          data-testid="order-summary"
        >
          <dt className="text-muted-foreground">Order</dt>
          <dd className="font-medium">{selected.orderNumber}</dd>

          <dt className="text-muted-foreground">Invoice</dt>
          <dd className="font-medium">{selected.invoiceNumber}</dd>

          <dt className="text-muted-foreground">Customer</dt>
          <dd className="font-medium">{selected.customerDisplayName}</dd>

          <dt className="text-muted-foreground">Amount payable</dt>
          <dd className="font-medium">{formatPeso(selected.totalAmountPayable)}</dd>

          <dt className="text-muted-foreground">Verified so far</dt>
          <dd className="font-medium">{formatPeso(selected.verifiedNetPayments)}</dd>

          <dt className="text-muted-foreground">Outstanding balance</dt>
          <dd className="font-semibold">{formatPeso(selected.outstandingBalance)}</dd>

          {selected.overpaymentCredit !== '0' &&
            selected.overpaymentCredit !== '0.00' && (
              <>
                <dt className="text-muted-foreground">Overpayment Credit</dt>
                <dd className="font-medium">
                  {formatPeso(selected.overpaymentCredit)} — flagged for review. Never
                  auto-refunded or moved to another order.
                </dd>
              </>
            )}

          {selected.paidInFull && (
            <>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                Paid in Full — a further payment records an Overpayment Credit and is
                flagged for review.
              </dd>
            </>
          )}
        </dl>
      )}

      {/* --- Amount + method ------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="amount">Payment amount</Label>
          <MoneyInput
            id="amount"
            name="amount"
            placeholder="0.00"
            required
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="paymentMethod">Payment method</Label>
          <select
            id="paymentMethod"
            name="paymentMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as MethodValue)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="transactedAt">Transaction date &amp; time</Label>
          <Input
            id="transactedAt"
            name="transactedAt"
            type="datetime-local"
            required
            className="h-9 text-sm"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="referenceNumber">Transaction / reference number</Label>
          <Input
            id="referenceNumber"
            name="referenceNumber"
            required
            className="h-9 text-sm"
          />
        </div>
      </div>

      {/* --- Note (optional). The method name (GCash / BPI / BDO / Credit Card)
              is itself the channel, so there is no separate provider field. --- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" name="note" className="h-9 text-sm" />
        </div>
      </div>

      {spec.needsLocation && (
        <div className="space-y-1">
          <Label htmlFor="collectionLocation">Store / collection location</Label>
          <Input
            id="collectionLocation"
            name="collectionLocation"
            required
            className="h-9 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Cash is attributed to the receiving staff member and the receipt number. A
            photo is optional for cash (§3).
          </p>
        </div>
      )}

      {/* --- The one thing that must never be misread ------------------ */}
      <p className="rounded-md border border-dashed p-2.5 text-xs text-muted-foreground">
        Recording is <strong>not</strong> verifying. This payment is saved as
        <strong> unverified</strong> and reduces no balance until someone with Payment
        Verification verifies it. Never enter a card number, CVV, or PIN — the system does
        not store them.
      </p>

      <Button type="submit" disabled={pending || !orderId}>
        {pending ? 'Recording…' : 'Record payment evidence'}
      </Button>

      {/* --- Authoritative server result ------------------------------- */}
      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}

      {state.success && (
        <div className="space-y-2">
          <p role="status" className="text-sm font-medium">
            {state.success}
          </p>
          {state.duplicateReferenceFlagged && (
            <p
              role="alert"
              data-testid="duplicate-reference-warning"
              className="rounded-md border border-destructive/50 p-3 text-sm font-medium text-destructive"
            >
              ⚠️ Duplicate reference number. This reference already exists on another
              payment. It was <strong>flagged for review, not rejected</strong> — a human
              decides, because silently refusing it would hide the collision.
            </p>
          )}
        </div>
      )}
    </form>
  );

  if (embedded) return formEl;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Payment</CardTitle>
      </CardHeader>
      <CardContent>{formEl}</CardContent>
    </Card>
  );
}
