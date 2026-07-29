'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import {
  activateLayawayAction,
  loadAvailableLayawayCodesAction,
} from '@/lib/payments/actions';
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
  // Available layaway codes for the CUSTOMER'S initial (A1–A200 for "Ana", …).
  const [codes, setCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [codesLoading, setCodesLoading] = useState(false);
  const [codeLetter, setCodeLetter] = useState('');

  const selectedOrder = payableOrders.find((o) => o.officialOrderId === orderId) ?? null;
  const depositsForOrder = selectedOrder
    ? verifiedPayments.filter((p) => p.orderNumber === selectedOrder.orderNumber)
    : [];

  // The customer determines the letter, so the list follows the chosen order.
  const letter = (selectedOrder?.customerDisplayName ?? '')
    .trim()
    .charAt(0)
    .toUpperCase();

  // Reload the free codes whenever the customer's initial changes. Adjusting state
  // during render (guarded on the letter) is React's supported alternative to a
  // derived-state effect and cannot loop.
  if (letter !== codeLetter) {
    setCodeLetter(letter);
    setCode('');
    setCodes([]);
    if (/^[A-Z]$/.test(letter)) {
      setCodesLoading(true);
      void loadAvailableLayawayCodesAction(letter)
        .then((list) => {
          setCodes(list);
          // Auto-select the first available code; another may still be chosen.
          setCode(list[0] ?? '');
        })
        .finally(() => setCodesLoading(false));
    }
  }

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

            {/* Available Code — filtered to the CUSTOMER'S initial, showing only
                codes no live account holds. Compact: dropdown, count, selection. */}
            <div>
              <Label htmlFor="lay-code" className="text-xs">
                Available Code
              </Label>
              <select
                id="lay-code"
                value={code}
                disabled={!selectedOrder || codesLoading || codes.length === 0}
                onChange={(e) => setCode(e.target.value)}
                data-testid="layaway-code-select"
                className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
              >
                {!selectedOrder ? (
                  <option value="">Select an order first</option>
                ) : codesLoading ? (
                  <option value="">Loading codes…</option>
                ) : codes.length === 0 ? (
                  <option value="">
                    {/^[A-Z]$/.test(codeLetter)
                      ? `No ${codeLetter} codes available`
                      : 'No customer initial'}
                  </option>
                ) : (
                  codes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))
                )}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {selectedOrder && /^[A-Z]$/.test(codeLetter) ? (
                  <>
                    <span data-testid="layaway-code-count">{codes.length}</span> available
                    under <span className="font-mono">{codeLetter}</span>
                    {code ? (
                      <>
                        {' · selected '}
                        <span className="font-mono font-semibold text-gold-strong">
                          {code}
                        </span>
                      </>
                    ) : null}
                  </>
                ) : (
                  'Codes filter to the customer’s first letter.'
                )}
              </p>
              <input type="hidden" name="layawayCode" value={code} />
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
