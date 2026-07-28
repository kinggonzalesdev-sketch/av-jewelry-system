'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { activateLayawayAction } from '@/lib/payments/actions';
import {
  EMPTY_PAYMENT_STATE,
  type PaymentActionState,
} from '@/lib/payments/action-state';
import type { PayableOrderRow } from '@/lib/payments/workspace';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFormGrid } from '@/components/ui/modal';

/**
 * New Layaway Entry (Bible §5, §17) — activates a Layaway on a real Official
 * Order once a VERIFIED deposit meets the 20% threshold.
 *
 * Transport only: the caller picks the order, its verified deposit, months, and
 * final due date. Every rule (verified ≥ 20%, one layaway per order, the fee) is
 * enforced by activateLayaway and the database — a screen can't lower the bar.
 * The same Official Order + Layaway records power the Orders "For Layaway" card,
 * customer history, balances, and reports — no duplicate records are created.
 */

type VerifiedPayment = {
  paymentId: string;
  orderNumber: string;
  verifiedAmount: string | null;
};

export function NewLayawayForm({
  payableOrders,
  verifiedPayments,
}: {
  payableOrders: PayableOrderRow[];
  verifiedPayments: VerifiedPayment[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<PaymentActionState, FormData>(
    activateLayawayAction,
    EMPTY_PAYMENT_STATE,
  );

  const [open, setOpen] = useState(false);
  const [orderId, setOrderId] = useState('');

  const selectedOrder = payableOrders.find((o) => o.officialOrderId === orderId) ?? null;
  const depositsForOrder = selectedOrder
    ? verifiedPayments.filter((p) => p.orderNumber === selectedOrder.orderNumber)
    : [];

  useEffect(() => {
    if (state.success) {
      // Responding to a server-action result: refresh and close the form.
      router.refresh();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      setOrderId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <div className="contents">
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="new-layaway-entry"
        className="font-semibold"
      >
        ＋ New Entry
      </Button>
      {state.success && !open ? (
        <p className="mt-2 text-sm text-muted-foreground">{state.success}</p>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New Layaway Entry"
        description="Activates a Layaway once a verified deposit meets the 20% threshold."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-layaway-form" disabled={pending}>
              {pending ? 'Activating…' : 'Activate Layaway'}
            </Button>
          </>
        }
      >
        <form id="new-layaway-form" action={action} className="space-y-3">
          <input type="hidden" name="officialOrderId" value={orderId} />

          <ModalFormGrid>
            <div>
              <Label htmlFor="lay-order" className="text-xs">
                Official Order
              </Label>
              <select
                id="lay-order"
                required
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="" disabled>
                  Select an order…
                </option>
                {payableOrders.map((o) => (
                  <option key={o.officialOrderId} value={o.officialOrderId}>
                    {o.orderNumber} · {o.customerDisplayName} ·{' '}
                    {formatPeso(o.totalAmountPayable)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="lay-deposit" className="text-xs">
                Verified deposit payment
              </Label>
              <select
                id="lay-deposit"
                name="depositPaymentId"
                required
                disabled={!selectedOrder}
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
              >
                <option value="">
                  {selectedOrder
                    ? depositsForOrder.length
                      ? 'Select the verified deposit…'
                      : 'No verified deposit on this order'
                    : 'Select an order first'}
                </option>
                {depositsForOrder.map((p) => (
                  <option key={p.paymentId} value={p.paymentId}>
                    {formatPeso(p.verifiedAmount ?? '0')} · {p.paymentId.slice(0, 8)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="lay-months" className="text-xs">
                Months (1–3)
              </Label>
              <select
                id="lay-months"
                name="months"
                required
                defaultValue="3"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>

            <div>
              <Label htmlFor="lay-due" className="text-xs">
                Final due date
              </Label>
              <Input
                id="lay-due"
                name="finalDueDate"
                type="date"
                required
                className="mt-1 h-9"
              />
            </div>
          </ModalFormGrid>

          {state.error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          ) : null}

          <p className="rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
            Activation needs a <strong>verified</strong> down payment of at least 20% of
            the Layaway Amount Payable (fee included). Evidence alone never activates, and
            the database re-checks the threshold — this form cannot lower it.
          </p>
        </form>
      </Modal>
    </div>
  );
}
