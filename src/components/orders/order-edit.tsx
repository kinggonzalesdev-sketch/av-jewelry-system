'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  adminEditOrderAction,
  requestOrderDetailsEditAction,
} from '@/lib/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * "Edit" an order from the Orders list Actions column — corrects the customer name and/or
 * total amount (the total is set on the single item's price; a multi-item order is rejected
 * server-side). TWO modes:
 *   - OWNER: applies directly (the DB re-checks Owner).
 *   - ADMIN (non-owner): submits the change for Owner approval with a reason — nothing
 *     changes until the Owner approves it in /approvals.
 * stopPropagation keeps the row's own open from firing.
 */
export function OrderEdit({
  orderId,
  currentName,
  currentTotal,
  isOwner = true,
  onDone,
}: {
  orderId: string;
  currentName: string;
  currentTotal: string;
  /** Owner edits directly; a non-owner admin submits the change for Owner approval. */
  isOwner?: boolean;
  /** Called on success INSTEAD of the default full-page router.refresh() — lets the
   *  Daily Cash view refresh just its box + totals in place, with no reload. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [amount, setAmount] = useState(currentTotal);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const save = async () => {
    if (pending) return;
    const amt = amount.trim().replace(/,/g, '');
    if (amt && !/^\d+(\.\d{1,2})?$/.test(amt)) {
      setError('Enter a valid amount, e.g. 9300 or 9300.50.');
      return;
    }
    if (!isOwner && reason.trim().length === 0) {
      setError('Add a reason for the Owner.');
      return;
    }
    setPending(true);
    setError(null);
    const res = isOwner
      ? await adminEditOrderAction(orderId, name.trim() || null, amt || null)
      : await requestOrderDetailsEditAction(
          orderId,
          name.trim() || null,
          amt || null,
          reason,
        );
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    if (!isOwner) {
      // Admin request: nothing changed yet — confirm it was sent to the Owner.
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
          setName(currentName);
          setAmount(currentTotal);
          setReason('');
          setSent(false);
          setError(null);
          setOpen(true);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
        data-testid="order-edit"
      >
        Edit
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isOwner ? 'Edit Order' : 'Request order edit'}
        description={
          isOwner
            ? 'Correct the customer name and/or total amount.'
            : 'Submit a name/total correction for Owner approval — nothing changes until the Owner approves it.'
        }
        size="sm"
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
                onClick={() => void save()}
                disabled={pending}
                data-testid="order-edit-save"
              >
                {pending
                  ? isOwner
                    ? 'Saving…'
                    : 'Sending…'
                  : isOwner
                    ? 'Save'
                    : 'Send request'}
              </Button>
            </>
          )
        }
      >
        {sent ? (
          <p
            className="text-sm font-medium text-emerald-600"
            data-testid="order-edit-sent"
          >
            Request sent. The Owner reviews it in Approvals — nothing changes until then.
          </p>
        ) : (
          <div className="space-y-3 text-sm" onClick={(e) => e.stopPropagation()}>
            <div>
              <Label htmlFor="edit-order-name" className="text-xs">
                Customer Name
              </Label>
              <Input
                id="edit-order-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                className="mt-1 h-9"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Renaming updates this customer&apos;s name wherever it appears.
              </p>
            </div>
            <div>
              <Label htmlFor="edit-order-total" className="text-xs">
                Total Amount (₱)
              </Label>
              <Input
                id="edit-order-total"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 9300"
                className="mt-1 h-9"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Sets the item&apos;s price. Multi-item orders are edited per item.
              </p>
            </div>
            {!isOwner ? (
              <div>
                <Label htmlFor="edit-order-reason" className="text-xs">
                  Reason (for the Owner)
                </Label>
                <Input
                  id="edit-order-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoComplete="off"
                  placeholder="Why should this be corrected?"
                  className="mt-1 h-9"
                  data-testid="order-edit-reason"
                />
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
