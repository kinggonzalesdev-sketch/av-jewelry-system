'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { deleteCancelledOrderAction } from '@/lib/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * SUPER ADMIN (Owner) — "Delete" a CANCELLED order from the Orders list Actions column.
 * Rendered only for a cancelled order to an Owner; the DB refuses anything that is not
 * cancelled. Removes the order + its records and returns any still-reserved item(s) to
 * Active Inventory. Requires typing "DELETE". stopPropagation keeps the row's own
 * click (which opens the order drawer) from firing when this control is used.
 */
export function CancelledOrderDelete({
  orderId,
  orderLabel,
  customerName,
}: {
  orderId: string;
  orderLabel: string;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (pending || confirm !== 'DELETE') return;
    setPending(true);
    setError(null);
    const res = await deleteCancelledOrderAction(orderId, confirm);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setConfirm('');
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
        title="Delete Cancelled Order"
        description="Super Admin only. Removes this cancelled order and returns any reserved item(s) to Active Inventory."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run()}
              disabled={pending || confirm !== 'DELETE'}
              data-testid="delete-cancelled-order-confirm"
            >
              {pending ? 'Deleting…' : 'Delete Order'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p>
            Delete cancelled order{' '}
            <span className="font-mono font-semibold">{orderLabel}</span> for{' '}
            <span className="font-medium">{customerName}</span>? Its records are removed and any
            reserved item(s) return to <strong>Active Inventory</strong>. This cannot be undone.
          </p>
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
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
