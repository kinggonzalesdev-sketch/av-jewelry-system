'use client';

import { useActionState, useState } from 'react';

import { prepareFulfillmentAction } from '@/lib/fulfillment/actions';
import type { FulfillmentActionState } from '@/lib/fulfillment/action-state';
import { EMPTY_FULFILLMENT_STATE } from '@/lib/fulfillment/action-state';
import type { FulfillmentRow } from '@/lib/fulfillment/service';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Shipping/Pickup Preparation (Bible §18).
 *
 * PREPARING IS NOT RELEASING. This form sets the queue (`for_shipping` /
 * `for_pickup`) and records the courier/pickup details. It cannot move an order
 * into any released state, and the domain module has no field that would let it:
 * release is a separate act, behind a separate permission, gated by the database
 * on verified payment, the ₱1,000 deposit floor, and COD approval.
 *
 * The eligibility figures shown here are ADVISORY ONLY. The database re-decides
 * at release time against stored state, so a stale screen can never talk goods
 * out of the building.
 */
export function PrepareFulfillmentForm({ row }: { row: FulfillmentRow }) {
  const [state, action, pending] = useActionState<FulfillmentActionState, FormData>(
    prepareFulfillmentAction,
    EMPTY_FULFILLMENT_STATE,
  );

  const [method, setMethod] = useState<'shipping' | 'pickup'>(
    row.method === 'pickup' ? 'pickup' : 'shipping',
  );

  return (
    <form action={action} className="space-y-3 rounded-md border p-3">
      <input type="hidden" name="officialOrderId" value={row.officialOrderId} />

      <p className="text-sm font-medium">Prepare fulfillment</p>

      {/* Current state, so the operator is not guessing what they are changing. */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Current status</dt>
        <dd className="font-medium">{row.status}</dd>

        <dt className="text-muted-foreground">Verified payments</dt>
        <dd className="font-medium">
          {row.balanceUnavailable ? '—' : formatPeso(row.verifiedNetPayments)}
        </dd>

        <dt className="text-muted-foreground">Amount payable</dt>
        <dd className="font-medium">
          {row.balanceUnavailable ? '—' : formatPeso(row.totalAmountPayable)}
        </dd>

        <dt className="text-muted-foreground">Meets ₱1,000 deposit floor</dt>
        <dd className="font-medium">
          {row.balanceUnavailable ? 'Unknown' : row.meetsDepositFloor ? 'Yes' : 'No'}
        </dd>
      </dl>

      <div className="space-y-1.5">
        <Label htmlFor={`method-${row.officialOrderId}`}>Fulfillment method</Label>
        <select
          id={`method-${row.officialOrderId}`}
          name="method"
          value={method}
          onChange={(e) => setMethod(e.target.value as 'shipping' | 'pickup')}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="shipping">Shipping</option>
          <option value="pickup">Pickup</option>
        </select>
      </div>

      {method === 'shipping' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`courier-${row.officialOrderId}`}>Courier</Label>
            <Input id={`courier-${row.officialOrderId}`} name="courier" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`tracking-${row.officialOrderId}`}>Tracking number</Label>
            <Input id={`tracking-${row.officialOrderId}`} name="trackingNumber" />
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`location-${row.officialOrderId}`}>Pickup location</Label>
            <Input id={`location-${row.officialOrderId}`} name="pickupLocation" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`contact-${row.officialOrderId}`}>Recipient / contact</Label>
            <Input id={`contact-${row.officialOrderId}`} name="pickupContact" />
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isCod" className="h-4 w-4" />
        <span>Cash on delivery (COD)</span>
      </label>
      <p className="text-xs text-muted-foreground">
        Marking COD does not approve it. A COD release still needs its approval, and the
        database refuses the release without it.
      </p>

      <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
        Preparing is <strong>not</strong> releasing and <strong>not</strong> shipping.
        Nothing leaves on this action. Release is a separate step with its own permission,
        and the database re-checks payment at that moment.
      </p>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Preparing…' : 'Prepare'}
      </Button>

      {state.error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.error}
        </p>
      )}
      {state.success && (
        <p role="status" className="text-sm font-medium">
          {state.success}
        </p>
      )}
    </form>
  );
}
