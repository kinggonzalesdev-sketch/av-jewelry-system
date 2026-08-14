'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { prepareFulfillmentAction } from '@/lib/fulfillment/actions';
import type { FulfillmentActionState } from '@/lib/fulfillment/action-state';
import { EMPTY_FULFILLMENT_STATE } from '@/lib/fulfillment/action-state';
import type { FulfillmentRow } from '@/lib/fulfillment/service';
import { Money } from '@/components/shell/privacy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFormGrid } from '@/components/ui/modal';

/**
 * Shipping/Pickup Preparation (Bible §18) — opens in the standard centered modal.
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

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<'shipping' | 'pickup'>(
    row.method === 'pickup' ? 'pickup' : 'shipping',
  );

  // Close the dialog once a prepare succeeds (once per new success).
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
    }
  }, [state.success]);

  const formId = `prepare-${row.officialOrderId}`;

  return (
    <div>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        Prepare fulfillment
      </Button>
      {state.success && !open ? (
        <p role="status" className="mt-1 text-xs text-muted-foreground">
          {state.success}
        </p>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Prepare fulfillment"
        description="Sets the queue and records courier/pickup details. Preparing is not releasing — nothing leaves on this action."
        size="md"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={pending}>
              {pending ? 'Preparing…' : 'Prepare'}
            </Button>
          </>
        }
      >
        <form id={formId} action={action} className="space-y-3">
          <input type="hidden" name="officialOrderId" value={row.officialOrderId} />

          {/* Current state, so the operator is not guessing what they change. */}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-border p-3 text-xs">
            <dt className="text-muted-foreground">Current status</dt>
            <dd className="font-medium">{row.status}</dd>

            <dt className="text-muted-foreground">Verified payments</dt>
            <dd className="font-medium">
              {row.balanceUnavailable ? '—' : <Money amount={row.verifiedNetPayments} />}
            </dd>

            <dt className="text-muted-foreground">Amount payable</dt>
            <dd className="font-medium">
              {row.balanceUnavailable ? '—' : <Money amount={row.totalAmountPayable} />}
            </dd>

            <dt className="text-muted-foreground">Meets ₱1,000 deposit floor</dt>
            <dd className="font-medium">
              {row.balanceUnavailable ? 'Unknown' : row.meetsDepositFloor ? 'Yes' : 'No'}
            </dd>
          </dl>

          <div className="space-y-1">
            <Label htmlFor={`method-${row.officialOrderId}`} className="text-xs">
              Fulfillment method
            </Label>
            <select
              id={`method-${row.officialOrderId}`}
              name="method"
              value={method}
              onChange={(e) => setMethod(e.target.value as 'shipping' | 'pickup')}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="shipping">Shipping</option>
              <option value="pickup">Pickup</option>
            </select>
          </div>

          {method === 'shipping' ? (
            <ModalFormGrid>
              <div className="space-y-1">
                <Label htmlFor={`courier-${row.officialOrderId}`} className="text-xs">
                  Courier
                </Label>
                <Input
                  id={`courier-${row.officialOrderId}`}
                  name="courier"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`tracking-${row.officialOrderId}`} className="text-xs">
                  Tracking number
                </Label>
                <Input
                  id={`tracking-${row.officialOrderId}`}
                  name="trackingNumber"
                  className="h-9"
                />
              </div>
            </ModalFormGrid>
          ) : (
            <ModalFormGrid>
              <div className="space-y-1">
                <Label htmlFor={`location-${row.officialOrderId}`} className="text-xs">
                  Pickup location
                </Label>
                <Input
                  id={`location-${row.officialOrderId}`}
                  name="pickupLocation"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`contact-${row.officialOrderId}`} className="text-xs">
                  Recipient / contact
                </Label>
                <Input
                  id={`contact-${row.officialOrderId}`}
                  name="pickupContact"
                  className="h-9"
                />
              </div>
            </ModalFormGrid>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isCod" className="h-4 w-4" />
            <span>Cash on delivery (COD)</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Marking COD does not approve it. A COD release still needs its approval, and
            the database refuses the release without it.
          </p>

          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Preparing is <strong>not</strong> releasing and <strong>not</strong> shipping.
            Nothing leaves on this action. Release is a separate step with its own
            permission, and the database re-checks payment at that moment.
          </p>

          {state.error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {state.error}
            </p>
          )}
        </form>
      </Modal>
    </div>
  );
}
