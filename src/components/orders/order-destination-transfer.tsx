'use client';

import { useState } from 'react';

import { transferOrderDestinationAction } from '@/lib/orders/actions';
import {
  DESTINATION_CARD,
  DESTINATION_LABEL,
  OFFERED_DESTINATIONS,
  type FulfillmentDestination,
} from '@/lib/orders/destination-types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * For-Prepare fulfillment destination transfer (Orders Workflow — For Prepare).
 *
 * Selecting a destination NEVER transfers on its own — it opens a confirmation
 * modal ("Transfer this order to [X]?"), and only "Accept Transfer" performs it.
 * The transfer is one-way-once (the DB refuses a second one) and the button is
 * disabled while pending, so duplicate/repeated submissions cannot happen. On
 * success only this order + the parent's status counts refresh (no full reload).
 */
export function OrderDestinationTransfer({
  orderId,
  status,
  destination,
  destinationSetByName,
  destinationSetAt,
  canTransfer,
  onTransferred,
}: {
  orderId: string;
  status: string;
  destination: string | null;
  destinationSetByName: string | null;
  destinationSetAt: string | null;
  canTransfer: boolean;
  onTransferred: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already transferred — read-only summary of where it went, by whom, and when.
  if (destination) {
    const d = destination as FulfillmentDestination;
    return (
      <div
        className="rounded-lg border border-border p-3 text-xs"
        data-testid="order-destination-done"
      >
        <p className="font-medium">
          Transferred to {DESTINATION_LABEL[d] ?? destination}
          {DESTINATION_CARD[d] ? ` → ${DESTINATION_CARD[d]}` : ''}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {destinationSetByName ? `by ${destinationSetByName}` : ''}
          {destinationSetAt ? ` · ${new Date(destinationSetAt).toLocaleString()}` : ''}
        </p>
      </div>
    );
  }

  // Only a For-Prepare order, and only a permitted user, can transfer.
  if (status !== 'for_preparation' || !canTransfer) return null;

  const submit = async () => {
    if (!selected || pending) return;
    setPending(true);
    setError(null);
    const res = await transferOrderDestinationAction(orderId, selected);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setConfirmOpen(false);
    onTransferred();
  };

  const label = selected
    ? DESTINATION_LABEL[selected as FulfillmentDestination]
    : '';

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Transfer to destination
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          data-testid="order-destination-select"
          className="h-9 flex-1 min-w-[12rem] rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
        >
          <option value="">Choose destination…</option>
          {OFFERED_DESTINATIONS.map((d) => (
            <option key={d} value={d}>
              {DESTINATION_LABEL[d]} → {DESTINATION_CARD[d]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={!selected}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
          data-testid="order-destination-transfer"
        >
          Transfer
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Selecting does not transfer — you confirm on the next step, and a transfer
        happens only once.
      </p>
      {error && !confirmOpen ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Modal
        open={confirmOpen}
        onClose={() => {
          if (!pending) setConfirmOpen(false);
        }}
        title="Confirm transfer"
        size="sm"
        critical
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={pending}
              data-testid="order-destination-accept"
            >
              {pending ? 'Transferring…' : 'Accept Transfer'}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Transfer this order to <span className="font-semibold">{label}</span>?
        </p>
        {selected ? (
          <p className="mt-1 text-xs text-muted-foreground">
            It will move to the{' '}
            <span className="font-medium">
              {DESTINATION_CARD[selected as FulfillmentDestination]}
            </span>{' '}
            section. This can only be done once.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
