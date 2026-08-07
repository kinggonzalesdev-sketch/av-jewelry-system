'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { adminEditOrderAction } from '@/lib/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * SUPER ADMIN (Owner) — "Edit" an order from the Orders list Actions column. Owner-only
 * (the DB re-checks). Corrects exactly two fields: the customer name and the total
 * amount (the total is set on the single item's price; a multi-item order is rejected
 * server-side). stopPropagation keeps the row's own open from firing.
 */
export function OrderEdit({
  orderId,
  currentName,
  currentTotal,
}: {
  orderId: string;
  currentName: string;
  currentTotal: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const [amount, setAmount] = useState(currentTotal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (pending) return;
    const amt = amount.trim().replace(/,/g, '');
    if (amt && !/^\d+(\.\d{1,2})?$/.test(amt)) {
      setError('Enter a valid amount, e.g. 9300 or 9300.50.');
      return;
    }
    setPending(true);
    setError(null);
    const res = await adminEditOrderAction(orderId, name.trim() || null, amt || null);
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
          setName(currentName);
          setAmount(currentTotal);
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
        title="Edit Order"
        description="Super Admin only. Correct the customer name and/or total amount."
        size="sm"
        footer={
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
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
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
