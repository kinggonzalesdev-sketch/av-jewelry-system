'use client';

import { useState } from 'react';

import { removeOrderItemAction, splitOrderItemAction } from '@/lib/orders/actions';
import type { OrderLineItemDetail } from '@/lib/orders/detail-types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Edit Items (Owner request 2026-08-09) — SUPER ADMIN (owner) only. Per piece:
 *   - Remove: returns it to Active inventory, the order total drops by its price.
 *   - Split: moves it to its own new For-Invoice order (pay/deliver separately).
 * The database re-checks every rule; this panel just hides the controls when they
 * would be refused (not owner, a locked status, or the last remaining item).
 */

/** Mirror of app_private.order_items_locked() — the DB is the real gate. */
const LOCKED_STATUSES = new Set([
  'cancelled',
  'for_cancel',
  'dispatched_or_picked_up',
  'completed',
  'closed',
  'delivered',
  'picked_up',
  'released',
]);

type Pending = { kind: 'remove' | 'split'; item: OrderLineItemDetail };

export function OrderItemEditControls({
  orderId,
  status,
  items,
  isOwner,
  onRefresh,
}: {
  orderId: string;
  status: string;
  items: OrderLineItemDetail[];
  isOwner: boolean;
  onRefresh: () => void;
}) {
  const [target, setTarget] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The DB refuses editing a locked order or the last item; hide to match.
  if (!isOwner || LOCKED_STATUSES.has(status) || items.length <= 1) return null;

  const run = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    if (target.kind === 'remove') {
      const res = await removeOrderItemAction(orderId, target.item.claimId);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(
        `Removed ${target.item.itemCode ?? 'the item'} — returned to Active inventory.`,
      );
    } else {
      const res = await splitOrderItemAction(orderId, target.item.claimId);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(`Split into new order ${res.orderNumber}.`);
    }
    setTarget(null);
    onRefresh();
  };

  const label = (it: OrderLineItemDetail) => it.itemCode ?? it.claimReference;

  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-edit-items">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
          Edit Items
        </p>
        <span className="rounded-full bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-strong">
          Super Admin
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
        Remove a piece (returns to Active inventory, the order total drops) or split it
        into its own new order to pay and deliver on its own.
      </p>
      {note ? (
        <p
          className="mb-2 text-xs font-medium text-emerald-600"
          data-testid="order-edit-items-note"
        >
          {note}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.claimId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs">{label(it)}</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTarget({ kind: 'split', item: it });
                }}
                data-testid={`order-item-split-${it.claimId}`}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
              >
                Split to new order
              </button>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setTarget({ kind: 'remove', item: it });
                }}
                data-testid={`order-item-remove-${it.claimId}`}
                className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
              >
                Remove
              </button>
            </span>
          </li>
        ))}
      </ul>

      <Modal
        open={target !== null}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        critical
        size="sm"
        title={
          target?.kind === 'remove'
            ? 'Remove item from order'
            : 'Split item to a new order'
        }
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            {target?.kind === 'remove' ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void run()}
                disabled={busy}
                data-testid="order-item-edit-confirm"
              >
                {busy ? 'Removing…' : 'Remove item'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                data-testid="order-item-edit-confirm"
              >
                {busy ? 'Splitting…' : 'Split to new order'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-mono">{target ? label(target.item) : ''}</p>
          {target?.kind === 'remove' ? (
            <p className="text-muted-foreground">
              This piece returns to Active inventory (sellable again) and the order total
              drops by its price. Payments already made stay on this order — if that
              leaves the order overpaid, it shows a credit (never auto-refunded).
            </p>
          ) : (
            <p className="text-muted-foreground">
              This piece moves to a brand-new For-Invoice order (same customer, unpaid) so
              it can be paid and delivered on its own. This order keeps the remaining
              items and all its payments.
            </p>
          )}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
