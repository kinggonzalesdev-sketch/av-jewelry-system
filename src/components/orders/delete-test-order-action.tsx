'use client';

import { useState } from 'react';

import { deleteTestOrderAction } from '@/lib/orders/actions';
import type { OrderDetail } from '@/lib/orders/detail-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { Money } from '@/components/shell/privacy';

/**
 * SUPER ADMIN (Owner) — "Delete Test Order & Return Item". Shown only for a TEST
 * order (detail.isTest) to an Owner; a production order never offers it and the DB
 * refuses it regardless. The confirmation names exactly what will happen (customer,
 * order, item(s), recorded payment, items returned, test status) and requires typing
 * "DELETE TEST". It removes the test order + its test payment and returns the item(s)
 * to Active Inventory — test rows never touch any report, so no figure changes.
 */
export function DeleteTestOrderAction({
  detail,
  onDone,
}: {
  detail: OrderDetail;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const CONFIRM = 'DELETE TEST';

  const run = async () => {
    if (pending || confirm !== CONFIRM) return;
    setPending(true);
    setError(null);
    const res = await deleteTestOrderAction(detail.officialOrderId, confirm);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    setOpen(false);
    onDone();
  };

  const amounts = detail.amounts;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => {
          setConfirm('');
          setError(null);
          setOpen(true);
        }}
        data-testid="delete-test-order"
      >
        🧪 Delete Test Order
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete Test Order & Return Item"
        description="Super Admin only. This removes a TEST order and returns its item(s) to Active Inventory."
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
              disabled={pending || confirm !== CONFIRM}
              data-testid="delete-test-order-confirm"
            >
              {pending ? 'Deleting…' : 'Delete Test Order'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <dl className="space-y-1.5">
            <SummaryRow label="Customer" value={detail.customer.displayName} />
            <SummaryRow
              label="Order number"
              value={<span className="font-mono">{detail.orderNumber}</span>}
            />
            <div className="border-b border-border py-1.5">
              <span className="text-muted-foreground">Item(s) to be returned</span>
              <ul className="mt-1 space-y-0.5">
                {detail.items.length === 0 ? (
                  <li className="text-muted-foreground">—</li>
                ) : (
                  detail.items.map((it, i) => (
                    <li key={`${it.claimReference}-${i}`} className="font-medium">
                      {it.itemName ?? '—'}{' '}
                      {it.itemCode ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          ({it.itemCode})
                        </span>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <SummaryRow
              label="Recorded payment"
              value={
                amounts.unavailable ? (
                  <span className="text-muted-foreground">unavailable</span>
                ) : (
                  <Money amount={amounts.verifiedNetPayments} />
                )
              }
            />
            <SummaryRow
              label="Test status"
              value={
                <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Test order
                </span>
              }
            />
          </dl>

          <p className="text-xs text-muted-foreground">
            This deletes the test order and its <strong>test payment</strong>, then returns the
            item(s) above to <strong>Active Inventory</strong>. Test records never appear in any
            report, so no sales or payment figure changes. This cannot be undone.
          </p>

          <div>
            <Label htmlFor="delete-test-confirm" className="text-xs">
              Type <span className="font-mono font-semibold">DELETE TEST</span> to confirm
            </Label>
            <Input
              id="delete-test-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE TEST"
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

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
