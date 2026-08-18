'use client';

import { useState } from 'react';

import {
  markOrderDispatchedAction,
  setFulfillmentDetailsAction,
  transferOrderToCompletedAction,
} from '@/lib/orders/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';

/**
 * Fulfillment Phase A — destination-aware operational controls INSIDE the Order Details modal.
 *
 * official_orders is the single source of truth; nothing here touches money or inventory, and the
 * handover actions complete through the SAME canonical `transfer_order_to_completed` (its
 * payment/waybill gates and the inventory completion guard are unchanged). Progressive disclosure
 * by fulfillment_destination:
 *   pickup   → Pickup Contact (optional) + Mark Picked Up (completes)
 *   delivery → Courier / Rider (optional) + Mark Delivered (completes)
 *   shipping → Courier (optional) + Mark Dispatched (stamps dispatched_at; the Waybill field and
 *              the final completion action stay where they already are)
 * Layaway / Keep / terminal orders render nothing.
 */

const TERMINAL = new Set(['completed', 'cancelled', 'for_cancel']);
type SaveResult = { ok: true } | { ok: false; error: string };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function OrderFulfillmentDetails({
  orderId,
  destination,
  status,
  courier,
  pickupContact,
  dispatchedAt,
  completionBlock,
  balanceUnavailable,
  canPrepare,
  canRelease,
  onChanged,
}: {
  orderId: string;
  destination: string | null;
  status: string;
  courier: string | null;
  pickupContact: string | null;
  dispatchedAt: string | null;
  completionBlock: string | null;
  balanceUnavailable: boolean;
  canPrepare: boolean;
  canRelease: boolean;
  onChanged: () => void;
}) {
  if (!destination || !['pickup', 'delivery', 'shipping'].includes(destination)) return null;
  if (TERMINAL.has(status)) return null;

  const isPickup = destination === 'pickup';
  const isDelivery = destination === 'delivery';
  const isShipping = destination === 'shipping';
  const title = isPickup ? 'Store Pickup' : isDelivery ? 'Delivery' : 'Shipping';

  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-fulfillment-details">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-2">
        {isPickup ? (
          <DetailField
            label="Pickup Contact"
            testid="fulfillment-pickup-contact"
            value={pickupContact}
            placeholder="Who will collect (name / phone)"
            canEdit={canPrepare}
            onSave={(v) => setFulfillmentDetailsAction(orderId, { pickupContact: v })}
            onSaved={onChanged}
          />
        ) : null}

        {isDelivery || isShipping ? (
          <DetailField
            label={isDelivery ? 'Courier / Rider' : 'Courier'}
            testid="fulfillment-courier"
            value={courier}
            placeholder={isDelivery ? 'Rider or courier name' : 'e.g. LBC, J&T, courier name'}
            canEdit={canPrepare}
            onSave={(v) => setFulfillmentDetailsAction(orderId, { courier: v })}
            onSaved={onChanged}
          />
        ) : null}

        {isShipping ? (
          <DispatchControl
            orderId={orderId}
            dispatchedAt={dispatchedAt}
            canPrepare={canPrepare}
            onChanged={onChanged}
          />
        ) : null}

        {(isPickup || isDelivery) && canRelease ? (
          <HandoverComplete
            orderId={orderId}
            label={isPickup ? 'Mark Picked Up' : 'Mark Delivered'}
            confirmText={
              isPickup
                ? 'Record this order as picked up and move it to Completed?'
                : 'Record this order as delivered and move it to Completed?'
            }
            completionBlock={completionBlock}
            balanceUnavailable={balanceUnavailable}
            onDone={onChanged}
          />
        ) : null}
      </div>
    </div>
  );
}

/** A single "text + Save" operational field (courier / pickup contact). */
function DetailField({
  label,
  testid,
  value,
  placeholder,
  canEdit,
  onSave,
  onSaved,
}: {
  label: string;
  testid: string;
  value: string | null;
  placeholder: string;
  canEdit: boolean;
  onSave: (value: string) => Promise<SaveResult>;
  onSaved: () => void;
}) {
  const [v, setV] = useState(value ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = v.trim() !== (value ?? '').trim();

  const save = async () => {
    if (pending || !dirty) return;
    setPending(true);
    setError(null);
    setSaved(false);
    const res = await onSave(v.trim());
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSaved(true);
    onSaved();
  };

  return (
    <div>
      <p className="mb-1 text-[11px] text-muted-foreground">{label}</p>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={v}
            onChange={(e) => {
              setV(e.target.value);
              setSaved(false);
            }}
            placeholder={placeholder}
            data-testid={`${testid}-input`}
            className="h-9 min-w-[12rem] flex-1"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void save()}
            disabled={pending || !dirty}
            data-testid={`${testid}-save`}
          >
            {pending ? 'Saving…' : value ? 'Update' : 'Save'}
          </Button>
        </div>
      ) : (
        <p className="text-sm font-medium">
          {value ?? <span className="text-muted-foreground">Not set</span>}
        </p>
      )}
      {saved ? (
        <p className="mt-1 text-xs text-green-700" data-testid={`${testid}-saved`}>
          Saved.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Shipping "Mark Dispatched" — stamps dispatched_at; never completes. */
function DispatchControl({
  orderId,
  dispatchedAt,
  canPrepare,
  onChanged,
}: {
  orderId: string;
  dispatchedAt: string | null;
  canPrepare: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await markOrderDispatchedAction(orderId);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged();
  };

  return (
    <div>
      {dispatchedAt ? (
        <p className="text-xs text-muted-foreground" data-testid="fulfillment-dispatched-at">
          Dispatched · {formatDateTime(dispatchedAt)}
        </p>
      ) : canPrepare ? (
        <Button
          type="button"
          size="sm"
          onClick={() => void run()}
          disabled={pending}
          data-testid="fulfillment-mark-dispatched"
        >
          {pending ? 'Marking…' : 'Mark Dispatched'}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Not yet dispatched.</p>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Pickup / Delivery handover → completes via the canonical transfer_order_to_completed. */
function HandoverComplete({
  orderId,
  label,
  confirmText,
  completionBlock,
  balanceUnavailable,
  onDone,
}: {
  orderId: string;
  label: string;
  confirmText: string;
  completionBlock: string | null;
  balanceUnavailable: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blocked = balanceUnavailable || completionBlock !== null;

  const run = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const res = await transferOrderToCompletedAction(orderId);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    onDone();
  };

  if (blocked) {
    return (
      <p
        className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
        data-testid="fulfillment-handover-blocked"
      >
        Cannot complete yet — {completionBlock ?? 'the balance is unavailable.'}
      </p>
    );
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        data-testid="fulfillment-handover"
      >
        {label}
      </Button>
      {error && !open ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Modal
        open={open}
        onClose={() => {
          if (!pending) setOpen(false);
        }}
        title={label}
        size="sm"
        critical
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void run()}
              disabled={pending}
              data-testid="fulfillment-handover-confirm"
            >
              {pending ? 'Completing…' : label}
            </Button>
          </>
        }
      >
        <p className="text-sm">{confirmText}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Who completed it, and the date and time, are recorded. This can only be done once.
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
