'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useState } from 'react';

import type { CaptureItem } from '@/lib/orders/service';
import { captureClaimAction } from '@/lib/live/actions';
import { EMPTY_ACTION_STATE, type ActionState } from '@/lib/live/action-state';
import { PhotoCapture } from '@/components/attachments/photo-capture';
import { Button } from '@/components/ui/button';
import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Orders "New Order" control + the New Order form (reference mockup).
 *
 * Only the New Order action lives here. The earlier Invoice / Confirm / Layaway
 * shortcut buttons (and the separate "New Entry → /live" header link) were
 * removed by Owner request (2026-07-18) — they duplicated the sidebar navigation
 * (Invoice, Payments & Layaway) and the capture entry. Capture now has ONE entry:
 * this New Order form.
 *
 * The New Order form is Manual Post-Live Entry: it creates a PENDING CLAIM only
 * (via the real, permission-guarded captureClaim), never an Official Order — an
 * order exists only after Approve & Send Invoice. Shop and Salesperson are the
 * caller's real session identity; price comes from the item catalogue (read-only,
 * not entered per order); the photo attaches to the item. Reprint Last is honest:
 * printing is gated until a real-device validation, so it explains rather than
 * pretends.
 */

type Customer = { id: string; displayName: string };

const L = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {children}
  </span>
);

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-gold';

function NewOrderModal({
  customers,
  items,
  shopName,
  salesperson,
  onClose,
}: {
  customers: Customer[];
  items: CaptureItem[];
  shopName: string;
  salesperson: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, capture, capturing] = useActionState<ActionState, FormData>(
    captureClaimAction,
    EMPTY_ACTION_STATE,
  );

  const [itemId, setItemId] = useState('');
  const [showReprintNote, setShowReprintNote] = useState(false);

  // Stable per open, changes after each submit (safe double-tap dedup).
  const reactId = useId();
  const [nonce, setNonce] = useState(0);
  const idempotencyKey = `neworder-${reactId}-${nonce}`;

  const selectedItem = items.find((i) => i.id === itemId) ?? null;

  // On a successful capture, refresh the Orders data and close.
  useEffect(() => {
    if (state.success) {
      router.refresh();
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="New Order"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-gold" aria-hidden="true" />
            <h2 className="text-xs font-bold uppercase tracking-wide text-foreground">
              New Order Entry
            </h2>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border text-xs text-muted-foreground hover:bg-accent"
          >
            ✕
          </button>
        </div>

        <form action={capture} onSubmit={() => setNonce((n) => n + 1)}>
          <input type="hidden" name="captureMethod" value="post_live_manual" />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <input type="hidden" name="inventoryItemId" value={itemId} />

          <div className="space-y-3 px-4 py-4">
            {/* Shop + Salesperson — the caller's real session identity (read-only). */}
            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-2">
              <label className="block">
                <L>Shop Name</L>
                <input className={fieldClass} value={shopName} readOnly />
              </label>
              <label className="block">
                <L>Salesperson</L>
                <input className={fieldClass} value={salesperson} readOnly />
              </label>
            </div>
            <p className="text-[10px] text-muted-foreground">
              From your session. Changing either needs the matching permission.
            </p>

            <hr className="border-border" />

            <label className="block">
              <L>Customer</L>
              <select name="customerId" required className={fieldClass} defaultValue="">
                <option value="" disabled>
                  Select a customer…
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <L>Item / Product</L>
              <select
                required
                className={fieldClass}
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
              >
                <option value="" disabled>
                  Select an item…
                </option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.itemCode}
                    {i.itemName ? ` — ${i.itemName}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 gap-3 min-[360px]:grid-cols-[1fr_88px]">
              <label className="block">
                <L>Unit Price</L>
                <input
                  className={cn(fieldClass, 'bg-muted/40')}
                  readOnly
                  value={
                    selectedItem?.unitPrice ? formatPeso(selectedItem.unitPrice) : '—'
                  }
                  title="From the item catalogue — applied at invoicing, not entered per order."
                />
              </label>
              <label className="block">
                <L>Qty</L>
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  defaultValue={1}
                  required
                  className={fieldClass}
                />
              </label>
            </div>

            {/* Photo attaches to the ITEM (it exists before the claim does). */}
            {itemId ? (
              <PhotoCapture
                key={itemId}
                relatedEntityType="inventory_item"
                relatedEntityId={itemId}
                purpose="photo"
                label="Photo attachment"
              />
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Select an item to attach a photo.
              </div>
            )}

            {state.error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {state.error}
              </p>
            ) : null}

            <p className="rounded-lg border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              Confirm creates a <strong>Pending Claim only</strong>. No stock is reserved
              and no Official Order is created — that happens at Approve &amp; Send
              Invoice.
            </p>
          </div>

          {/* Footer: Reprint Last (honest) + Confirm Order */}
          <div className="border-t border-border bg-secondary/40 px-4 py-3">
            <div className="flex items-stretch gap-2">
              <button
                type="button"
                onClick={() => setShowReprintNote(true)}
                title="Reprint the last label. Printing is gated until a real-device validation."
                className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-border bg-card py-1.5 text-muted-foreground hover:bg-accent"
              >
                <span aria-hidden="true">⎙</span>
                <span className="text-[9px] font-semibold uppercase leading-tight">
                  Reprint Last
                </span>
              </button>
              <Button
                type="submit"
                disabled={capturing}
                className="h-auto min-h-[44px] flex-1 text-sm font-bold uppercase tracking-wide"
              >
                {capturing ? 'Saving…' : 'Confirm Order'}
              </Button>
            </div>
            {showReprintNote ? (
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                Reprint is unavailable — the Bluetooth printer is not connected/validated
                yet (see the printer status). Nothing was printed.
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

export function NewOrderWorkflow({
  customers,
  items,
  canCreate,
  shopName,
  salesperson,
}: {
  customers: Customer[];
  items: CaptureItem[];
  canCreate: boolean;
  shopName: string;
  salesperson: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div>
        <Button
          type="button"
          onClick={() => setOpen(true)}
          disabled={!canCreate}
          data-testid="orders-new-order"
          className="font-semibold"
          title={
            canCreate
              ? undefined
              : 'Creating an entry needs the claim capture permission.'
          }
        >
          ＋ New Order
        </Button>
      </div>

      {open ? (
        <NewOrderModal
          customers={customers}
          items={items}
          shopName={shopName}
          salesperson={salesperson}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
