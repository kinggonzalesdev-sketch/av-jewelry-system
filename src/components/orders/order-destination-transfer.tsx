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
 * Transfer to Destination (§6).
 *
 * Offered from every ACTIVE stage that lists it in the shared stage table — not
 * only For Prepare. Selecting a destination NEVER transfers on its own: it opens a
 * confirmation modal ("Transfer this order to [X]?") and only "Accept Transfer"
 * performs it.
 *
 * Duplicate transfers are prevented by the database, which refuses a transfer to
 * the destination the order is ALREADY at; the button is also disabled while
 * pending. Re-routing to a DIFFERENT destination stays allowed, which is what an
 * operator correcting a mistake actually needs.
 *
 * Completed is offered only when the order is genuinely eligible — and even then
 * the SQL routes it through the one completion gate, so picking it from this list
 * can never skip the fully-paid and fulfilled checks. On success only this order +
 * the parent's status counts refresh (no full reload).
 */
export function OrderDestinationTransfer({
  orderId,
  destination,
  destinationSetByName,
  destinationSetAt,
  canTransfer,
  completionBlock,
  onTransferred,
}: {
  orderId: string;
  destination: string | null;
  destinationSetByName: string | null;
  destinationSetAt: string | null;
  canTransfer: boolean;
  /** The database's completion verdict; null means Completed may be offered. */
  completionBlock: string | null;
  onTransferred: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The stage table already decided this stage offers a transfer; this component
  // only needs the caller's permission.
  if (!canTransfer) return null;

  const current = destination as FulfillmentDestination | null;

  // Where it may go NOW: never back to where it already is (the DB refuses that).
  // "Complete Order → Completed" is ALWAYS offered (Owner request); when the order
  // is not yet eligible the Transfer button is disabled with the reason shown, so a
  // refused round-trip never happens and the operator sees exactly what is missing.
  const choices = OFFERED_DESTINATIONS.filter((d) => d !== current);

  // Selected Complete Order but the database says it cannot complete yet.
  const completedBlocked = selected === 'completed' && completionBlock !== null;

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

  const label = selected ? DESTINATION_LABEL[selected as FulfillmentDestination] : '';

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
          className="h-9 flex-1 min-w-[12rem] rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <option value="">Choose destination…</option>
          {choices.map((d) => (
            <option key={d} value={d}>
              {DESTINATION_LABEL[d]} → {DESTINATION_CARD[d]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size="sm"
          disabled={!selected || completedBlocked}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
          data-testid="order-destination-transfer"
        >
          Transfer
        </Button>
      </div>
      {completedBlocked ? (
        <p
          className="mt-1 text-[11px] text-amber-600"
          data-testid="order-destination-complete-blocked"
        >
          Cannot complete yet — {completionBlock}
        </p>
      ) : null}
      {current ? (
        <p
          className="mt-1 text-[11px] text-muted-foreground"
          data-testid="order-destination-current"
        >
          Currently in {DESTINATION_LABEL[current] ?? current}
          {destinationSetByName ? ` · moved by ${destinationSetByName}` : ''}
          {destinationSetAt
            ? ` · ${new Date(destinationSetAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
            : ''}
        </p>
      ) : null}
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
            section. Who moved it, and when, is recorded.
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
