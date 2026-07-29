'use client';

import { useState } from 'react';

import {
  markOrderDoneAction,
  transferOrderToCompletedAction,
} from '@/lib/orders/actions';
import { canOfferCompletion, stageOffers } from '@/lib/orders/stage-actions';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Done (Delivery) and Transfer to Completed (§5).
 *
 * Both do the same movement — record the handover, close fulfillment, retire the
 * items, stamp completed by / date / time — so they share one confirmation flow
 * and one server round trip. Which one is offered comes from the shared stage
 * table; whether EITHER may be offered comes from `completionBlock`, the
 * database's own verdict.
 *
 * Duplicate completion cannot happen: the button locks while pending, and the
 * database refuses a second completion outright rather than writing a second
 * stamp. A premature press is refused too — the DB checks fully-paid and
 * fulfilled, and the refusal reason is shown verbatim.
 */
export function OrderCompletionActions({
  orderId,
  status,
  paidInFull,
  balanceUnavailable,
  canRelease,
  completionBlock,
  onDone,
}: {
  orderId: string;
  status: string;
  paidInFull: boolean;
  balanceUnavailable: boolean;
  canRelease: boolean;
  completionBlock: string | null;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState<null | 'done' | 'transfer_completed'>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offer = (action: 'done' | 'transfer_completed') =>
    canOfferCompletion({
      status,
      action,
      paidInFull,
      balanceUnavailable,
      canRelease,
      completionBlock,
    });

  const showDone = offer('done');
  const showTransfer = offer('transfer_completed');

  // Nothing to offer. When the stage WOULD offer completion but the order is not
  // eligible yet, say why instead of rendering an empty card — a blank space
  // reads as a bug, and the operator needs to know what is missing.
  if (!showDone && !showTransfer) {
    const wouldOffer =
      canRelease &&
      (stageOffers(status, 'done') || stageOffers(status, 'transfer_completed'));
    if (!wouldOffer) return null;
    const reason = completionBlock ?? 'This order is not fully paid yet.';
    return (
      <p
        className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
        data-testid="order-completion-blocked"
      >
        Cannot complete yet — {reason}
      </p>
    );
  }

  const run = async () => {
    if (pending || !confirming) return;
    setPending(true);
    setError(null);
    const res =
      confirming === 'done'
        ? await markOrderDoneAction(orderId)
        : await transferOrderToCompletedAction(orderId);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setConfirming(null);
    onDone();
  };

  const isDone = confirming === 'done';

  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-completion">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Actions
      </p>
      <div className="flex flex-wrap gap-2">
        {showDone ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setError(null);
              setConfirming('done');
            }}
            data-testid="order-done"
          >
            Done
          </Button>
        ) : null}
        {showTransfer ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setError(null);
              setConfirming('transfer_completed');
            }}
            data-testid="order-transfer-completed"
          >
            Transfer to Completed
          </Button>
        ) : null}
      </div>
      {error && confirming === null ? (
        <p role="alert" className="mt-1.5 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Modal
        open={confirming !== null}
        onClose={() => {
          if (!pending) setConfirming(null);
        }}
        title={isDone ? 'Confirm Done' : 'Transfer to Completed'}
        size="sm"
        critical
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirming(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={pending}
              data-testid="order-completion-confirm"
            >
              {pending ? 'Completing…' : isDone ? 'Mark as Done' : 'Move to Completed'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {isDone
            ? 'Record this order as delivered and move it to Completed?'
            : 'Move this order to Completed?'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Who completed it, and the date and time, are recorded. This can only be
          done once.
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
