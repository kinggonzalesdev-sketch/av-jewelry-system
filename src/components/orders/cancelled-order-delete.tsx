'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { deleteOrderAction, requestOrderDeleteAction } from '@/lib/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * "Delete" an order from the Orders list Actions column. Removes the order + all its
 * records (including any payments) and returns any still-reserved item(s) to Active
 * Inventory. TWO modes:
 *   - OWNER: deletes directly after typing "DELETE" (the DB gates on Owner).
 *   - ADMIN (non-owner): submits the deletion for Owner approval with a reason — nothing
 *     is removed until the Owner approves it in /approvals.
 * stopPropagation keeps the row's own click (which opens the order drawer) from firing.
 */
export function OrderDelete({
  orderId,
  orderLabel,
  customerName,
  orderStatus,
  isOwner = true,
  onDone,
}: {
  orderId: string;
  orderLabel: string;
  customerName: string;
  orderStatus?: string;
  /** Owner deletes directly; a non-owner admin submits it for Owner approval. */
  isOwner?: boolean;
  /** Called on success INSTEAD of the default full-page router.refresh() — lets the
   *  Daily Cash view refresh just its box + totals in place, with no reload. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const ready = isOwner ? confirm === 'DELETE' : reason.trim().length > 0;

  const run = async () => {
    if (pending || !ready) return;
    setPending(true);
    setError(null);
    const res = isOwner
      ? await deleteOrderAction(orderId, confirm)
      : await requestOrderDeleteAction(orderId, orderLabel, reason);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    if (!isOwner) {
      setSent(true);
      return;
    }
    setOpen(false);
    if (onDone) onDone();
    else router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirm('');
          setReason('');
          setSent(false);
          setError(null);
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
        data-testid="delete-cancelled-order"
      >
        Delete
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isOwner ? 'Delete Order' : 'Request order delete'}
        description={
          isOwner
            ? 'Removes this order and returns any reserved item(s) to Active Inventory.'
            : 'Submit this deletion for Owner approval — nothing is removed until the Owner approves it.'
        }
        size="sm"
        critical
        footer={
          sent ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={isOwner ? 'destructive' : 'default'}
                onClick={() => void run()}
                disabled={pending || !ready}
                data-testid="delete-cancelled-order-confirm"
              >
                {pending
                  ? isOwner
                    ? 'Deleting…'
                    : 'Sending…'
                  : isOwner
                    ? 'Delete Order'
                    : 'Send request'}
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <p
            className="text-sm font-medium text-emerald-600"
            data-testid="delete-cancelled-order-sent"
          >
            Request sent. The Owner reviews it in Approvals — nothing is removed until then.
          </p>
        ) : (
          <div className="space-y-3 text-sm">
            <p>
              Delete order <span className="font-mono font-semibold">{orderLabel}</span> for{' '}
              <span className="font-medium">{customerName}</span>
              {orderStatus ? (
                <>
                  {' '}
                  (status: <span className="font-medium">{orderStatus}</span>)
                </>
              ) : null}
              ? This removes the order and{' '}
              <strong>all its records (including any payments)</strong> and returns any
              reserved item(s) to <strong>Active Inventory</strong>. This cannot be undone.
            </p>
            {isOwner ? (
              <div>
                <Label htmlFor="delete-cancelled-confirm" className="text-xs">
                  Type <span className="font-mono font-semibold">DELETE</span> to confirm
                </Label>
                <Input
                  id="delete-cancelled-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoComplete="off"
                  placeholder="DELETE"
                  className="mt-1 h-9"
                />
              </div>
            ) : (
              <div>
                <Label htmlFor="delete-order-reason" className="text-xs">
                  Reason (for the Owner)
                </Label>
                <Input
                  id="delete-order-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoComplete="off"
                  placeholder="Why should this order be deleted?"
                  className="mt-1 h-9"
                  data-testid="delete-order-reason"
                />
              </div>
            )}
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
