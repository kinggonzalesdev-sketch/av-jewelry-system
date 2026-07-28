'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useRef } from 'react';

import {
  completeFulfillmentAction,
  decideApprovalAction,
  dispatchAction,
  executeApprovalAction,
  releaseFulfillmentAction,
  requestApprovalAction,
} from '@/lib/fulfillment/actions';
import {
  EMPTY_FULFILLMENT_STATE,
  type FulfillmentActionState,
} from '@/lib/fulfillment/action-state';
import type { ApprovalRow, FulfillmentRow } from '@/lib/fulfillment/service';
import { formatPeso } from '@/lib/payments/format';
import { CollectionRemittanceControls } from '@/components/fulfillment/collection-controls';
import { PrepareFulfillmentForm } from '@/components/fulfillment/prepare-fulfillment-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Fulfillment actions for ONE order, hosted inside the Order Details modal so the
 * whole lifecycle lives on Orders (Owner request — Fulfillment left the sidebar).
 *
 * Every control REUSES the existing, permission-guarded fulfillment actions and
 * components — nothing is re-implemented. Preparing is not releasing; releasing is
 * not dispatching; the six Owner approvals are non-delegable. The database
 * re-checks each write at execution time, so a stale modal can never talk goods
 * out of the building. On success, the modal re-fetches this order's data.
 */
export function OrderFulfillmentActions({
  row,
  approvals,
  canPrepare,
  canRelease,
  canRequest,
  isOwner,
  onMutated,
}: {
  row: FulfillmentRow | null;
  approvals: ApprovalRow[];
  canPrepare: boolean;
  canRelease: boolean;
  canRequest: boolean;
  isOwner: boolean;
  onMutated: () => void;
}) {
  const router = useRouter();
  const [releaseState, release, releasing] = useActionState<FulfillmentActionState, FormData>(
    releaseFulfillmentAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [dispatchState, dispatch, dispatching] = useActionState<FulfillmentActionState, FormData>(
    dispatchAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [completeState, complete, completing] = useActionState<FulfillmentActionState, FormData>(
    completeFulfillmentAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [requestState, request, requesting] = useActionState<FulfillmentActionState, FormData>(
    requestApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [decideState, decide, deciding] = useActionState<FulfillmentActionState, FormData>(
    decideApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [executeState, execute, executing] = useActionState<FulfillmentActionState, FormData>(
    executeApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );

  const states = [releaseState, dispatchState, completeState, requestState, decideState, executeState];
  const notice = states.map((s) => s.error ?? s.success).find(Boolean) ?? null;
  const isError = states.some((s) => s.error);

  // Re-fetch this order's data + refresh counts once per new success.
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    const success = states.map((s) => s.success).find(Boolean) ?? null;
    if (success && success !== lastSuccess.current) {
      lastSuccess.current = success;
      onMutated();
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseState, dispatchState, completeState, requestState, decideState, executeState]);

  if (!row) {
    return (
      <p className="text-xs text-muted-foreground">
        This order is not in the fulfillment queue yet — it is not ready for preparation.
        Fulfillment actions appear here once it is.
      </p>
    );
  }

  const terminal = ['dispatched', 'picked_up', 'completed'].includes(row.status);

  return (
    <div className="space-y-3">
      {/* Current fulfillment facts — advisory; the DB decides at write time. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Verified paid</dt>
          <dd className="font-medium tabular-nums">
            {row.balanceUnavailable ? '—' : formatPeso(row.verifiedNetPayments)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total payable</dt>
          <dd className="font-medium tabular-nums">
            {row.balanceUnavailable ? '—' : formatPeso(row.totalAmountPayable)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">COD</dt>
          <dd className="font-medium">
            {row.isCod ? (row.codApproved ? 'Approved' : 'Not approved') : 'No'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Deposit floor</dt>
          <dd className="font-medium">
            {row.balanceUnavailable ? 'Unknown' : row.meetsDepositFloor ? 'Met' : 'Below'}
          </dd>
        </div>
      </dl>

      {row.method === 'shipping' && !row.balanceUnavailable && !row.meetsDepositFloor ? (
        <p className="rounded border border-amber-500 px-2 py-1.5 text-xs">
          Verified payment is below the ₱1,000 shipping deposit floor. Normal release will
          be refused — an Owner-approved exceptional release is the only way past it.
        </p>
      ) : null}
      {row.isCod && !row.codApproved ? (
        <p className="rounded border border-amber-500 px-2 py-1.5 text-xs">
          COD is not approved. Release will be refused until it is.
        </p>
      ) : null}

      {/* Release · Dispatch/Pickup · Complete · Request exceptional release. */}
      <div className="flex flex-wrap items-end gap-2">
        {canRelease && !terminal ? (
          <form action={release}>
            <input type="hidden" name="officialOrderId" value={row.officialOrderId} />
            <Button type="submit" size="sm" disabled={releasing}>
              {releasing ? 'Releasing…' : 'Normal Release'}
            </Button>
          </form>
        ) : null}

        {canRelease && row.status === 'approved_for_release' ? (
          <form action={dispatch}>
            <input type="hidden" name="officialOrderId" value={row.officialOrderId} />
            <input
              type="hidden"
              name="kind"
              value={row.method === 'pickup' ? 'picked_up' : 'dispatched'}
            />
            <Button type="submit" size="sm" variant="outline" disabled={dispatching}>
              {row.method === 'pickup' ? 'Mark Picked Up' : 'Mark Dispatched'}
            </Button>
          </form>
        ) : null}

        {canRelease && ['dispatched', 'picked_up'].includes(row.status) ? (
          <form action={complete}>
            <input type="hidden" name="officialOrderId" value={row.officialOrderId} />
            <Button type="submit" size="sm" variant="outline" disabled={completing}>
              Complete
            </Button>
          </form>
        ) : null}

        {canRequest ? (
          <form action={request} className="flex items-end gap-2">
            <input type="hidden" name="actionKind" value="exceptional_fulfillment_release" />
            <input type="hidden" name="entityType" value="official_order" />
            <input type="hidden" name="entityId" value={row.officialOrderId} />
            <div>
              <Label htmlFor={`xr-${row.officialOrderId}`} className="text-xs">
                Exceptional release reason
              </Label>
              <Input
                id={`xr-${row.officialOrderId}`}
                name="reason"
                required
                placeholder="Why bypass the rules?"
                className="h-8 w-52"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={requesting}>
              Request Exceptional Release
            </Button>
          </form>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Preparing is not releasing, and releasing is not dispatching. Normal release needs
        verified payment. Requesting an exceptional release releases nothing.
      </p>

      {/* Prepare (courier/tracking or pickup) — self-contained guarded modal. */}
      {canPrepare ? <PrepareFulfillmentForm row={row} /> : null}

      {/* COD collection & remittance + the printable waybill. */}
      {row.method ? (
        <CollectionRemittanceControls row={row} canRelease={canRelease} />
      ) : null}

      {/* Owner Approval — decide / execute the exceptional release for this order. */}
      {approvals.length > 0 ? (
        <div className="space-y-2 border-t border-border pt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Owner Approval
          </p>
          {approvals.map((a) => (
            <div key={a.id} className="rounded-md border border-border p-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{a.actionKind.replace(/_/g, ' ')}</span>
                <span className="rounded-full border px-2 py-0.5">
                  {a.status.replace(/_/g, ' ')}
                  {a.executedAt ? ' · executed' : ''}
                </span>
              </div>
              {a.reason ? <p className="mt-0.5 text-muted-foreground">{a.reason}</p> : null}

              {isOwner && a.status === 'pending_owner_approval' ? (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <form action={decide}>
                    <input type="hidden" name="requestId" value={a.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Button type="submit" size="sm" disabled={deciding}>
                      Approve
                    </Button>
                  </form>
                  <form action={decide}>
                    <input type="hidden" name="requestId" value={a.id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <Button type="submit" size="sm" variant="destructive" disabled={deciding}>
                      Reject
                    </Button>
                  </form>
                </div>
              ) : null}

              {isOwner && a.status === 'approved' && !a.executedAt ? (
                <form action={execute} className="mt-1.5">
                  <input type="hidden" name="requestId" value={a.id} />
                  <Button type="submit" size="sm" variant="outline" disabled={executing}>
                    Execute
                  </Button>
                </form>
              ) : null}

              {!isOwner ? (
                <p className="mt-1 text-muted-foreground">
                  The six Owner approvals are non-delegable — only the Owner may decide them.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className={isError ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
          {notice}
        </p>
      ) : null}
    </div>
  );
}
