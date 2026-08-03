'use client';

import { useRef, useState } from 'react';

import {
  finalizeOrderCancellationAction,
  rejectOrderCancellationAction,
  requestOrderCancellationAction,
} from '@/lib/orders/actions';
import { canCancelOrderStatus } from '@/lib/orders/cancellation-status';
import { canOfferCancel } from '@/lib/orders/stage-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Cancel Order — the destructive action on an order, kept visually apart from the
 * forward workflow buttons so it can never be hit by reflex.
 *
 * Cancelling is TWO deliberate steps, mirroring the database:
 *   1. Cancel Order  → the order moves to `For Cancel` and stops. Its inventory
 *      stays RESERVED; nothing returns to stock yet. Requires a reason and the
 *      exact word CANCEL.
 *   2. Finalize      → Owner / Selected Admin only. The order becomes `Cancelled`
 *      and any item that was merely reserved goes back to Active Inventory through
 *      the Returned-to-Stock Review the system requires.
 *
 * The order is never deleted: payments, invoices, items, and history all survive.
 */
export function OrderCancelAction({
  orderId,
  orderNumber,
  customerName,
  status,
  isOwner,
  compact = false,
  onDone,
}: {
  orderId: string;
  orderNumber: string;
  customerName: string;
  status: string;
  /** Owner / Selected Admin — only they may finalize a cancellation. */
  isOwner: boolean;
  /** Just the button, no top border or Danger-Zone explainer — for seating it on
   *  the right of the Payment card (Owner request, standardized modal). */
  compact?: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalized, setFinalized] = useState<{ returned: number; kept: number } | null>(
    null,
  );
  // Blocks a double-tap from raising two cancellation requests.
  const submittingRef = useRef(false);

  const awaitingReview = status === 'for_cancel';
  // For an order awaiting review, the Super Admin's choice: accept (finalize) or
  // reject (undo). Null until they pick one and open the confirm modal.
  const [reviewDecision, setReviewDecision] = useState<'accept' | 'reject' | null>(null);
  // The shared stage table decides whether cancelling is offered at all; the
  // cancellable-status list stays the transition rule the server enforces. Both
  // must agree, so a stage marked read-only can never surface a Cancel button.
  const canRequest = canCancelOrderStatus(status) && canOfferCancel(status);

  // Completed / already cancelled orders offer nothing here.
  if (!canRequest && !awaitingReview) return null;

  const submit = async () => {
    if (pending || submittingRef.current) return;
    if (!awaitingReview && (!reason.trim() || confirm !== 'CANCEL')) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      if (awaitingReview) {
        // Super Admin decision: Accept finalizes in one step; Reject undoes it.
        if (reviewDecision === 'reject') {
          const res = await rejectOrderCancellationAction(orderId);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setOpen(false);
          onDone();
        } else {
          const res = await finalizeOrderCancellationAction(orderId);
          if (!res.ok) {
            setError(res.error);
            return;
          }
          setFinalized({ returned: res.returned, kept: res.kept });
          onDone();
        }
      } else {
        const res = await requestOrderCancellationAction(orderId, reason);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
        onDone();
      }
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  const openWith = (decision: 'accept' | 'reject' | null) => {
    setReviewDecision(decision);
    setReason('');
    setConfirm('');
    setError(null);
    setFinalized(null);
    setOpen(true);
  };

  // A for-cancel order awaiting a Super Admin: just Accept / Reject, one step each
  // (Owner request — no "Finalize Cancellation" / "Execute"). Anyone else sees a
  // note that it is under review.
  const cancelButton = awaitingReview ? (
    isOwner ? (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          data-testid="order-cancel-accept"
          onClick={() => openWith('accept')}
        >
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="order-cancel-reject"
          onClick={() => openWith('reject')}
        >
          Reject
        </Button>
      </div>
    ) : (
      <span className="text-xs text-muted-foreground" data-testid="order-cancel-awaiting">
        Awaiting Super Admin review.
      </span>
    )
  ) : (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      data-testid="order-cancel"
      onClick={() => openWith(null)}
    >
      Cancel Order
    </Button>
  );

  return (
    <div className={compact ? '' : 'mt-3 border-t border-destructive/20 pt-3'}>
      {/* Compact (standardized modal): just the button — no Danger-Zone text.
          Legacy: the button beside its explanatory line. */}
      {compact ? (
        cancelButton
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {awaitingReview
              ? 'This order is awaiting cancellation review. Its items stay reserved until it is finalized.'
              : 'Cancelling stops the order. Nothing is deleted and no stock is released yet.'}
          </p>
          {cancelButton}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        critical
        size="sm"
        title={
          awaitingReview
            ? reviewDecision === 'reject'
              ? 'Reject cancellation?'
              : 'Accept cancellation?'
            : 'Cancel this order?'
        }
        description={
          awaitingReview
            ? reviewDecision === 'reject'
              ? 'The request is rejected and the order returns to where it was.'
              : 'The order becomes Cancelled and eligible stock returns to Active Inventory.'
            : 'The order stops and goes up for cancellation review.'
        }
        footer={
          finalized ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Back
              </Button>
              <Button
                type="button"
                variant={reviewDecision === 'reject' ? 'outline' : 'destructive'}
                data-testid="order-cancel-confirm"
                onClick={() => void submit()}
                disabled={
                  pending || (!awaitingReview && (!reason.trim() || confirm !== 'CANCEL'))
                }
              >
                {pending
                  ? 'Working…'
                  : awaitingReview
                    ? reviewDecision === 'reject'
                      ? 'Confirm Reject'
                      : 'Confirm Accept'
                    : 'Confirm Cancellation'}
              </Button>
            </>
          )
        }
      >
        {finalized ? (
          <div className="space-y-2" data-testid="order-cancel-done">
            <p className="text-sm">
              Order <strong>{orderNumber}</strong> is now <strong>Cancelled</strong>.
            </p>
            <p className="text-xs text-muted-foreground">
              {finalized.returned} item(s) returned to Active Inventory
              {finalized.kept > 0
                ? `; ${finalized.kept} kept out of stock (already delivered, released, sold, or forfeited).`
                : '.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Order Number</span>
                <span className="font-mono font-medium">{orderNumber}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium">{customerName}</span>
              </div>
            </div>

            {awaitingReview ? (
              reviewDecision === 'reject' ? (
                <p className="text-xs text-muted-foreground">
                  Rejecting returns the order to the status it held before the
                  cancellation was requested. Nothing is deleted.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Items only ever reserved to this order return to Active Inventory.
                  Anything delivered, released, sold, or forfeited stays out of stock and
                  keeps its history.
                </p>
              )
            ) : (
              <>
                <div>
                  <Label htmlFor={`cancel-reason-${orderId}`} className="text-xs">
                    Cancellation reason
                  </Label>
                  <Input
                    id={`cancel-reason-${orderId}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this order being cancelled?"
                    className="mt-1 h-9"
                  />
                </div>
                <div>
                  <Label htmlFor={`cancel-confirm-${orderId}`} className="text-xs">
                    Type <span className="font-mono font-semibold">CANCEL</span> to confirm
                  </Label>
                  <Input
                    id={`cancel-confirm-${orderId}`}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="off"
                    placeholder="CANCEL"
                    className="mt-1 h-9"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Payments, invoices, items, and history are all kept. The order is never
                  deleted.
                </p>
              </>
            )}

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
