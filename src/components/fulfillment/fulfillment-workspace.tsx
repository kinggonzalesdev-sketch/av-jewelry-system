'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState } from 'react';

import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import {
  completeFulfillmentAction,
  decideApprovalAction,
  dispatchAction,
  executeApprovalAction,
  releaseFulfillmentAction,
  requestApprovalAction,
} from '@/lib/fulfillment/actions';
import type { FulfillmentActionState } from '@/lib/fulfillment/action-state';
import { EMPTY_FULFILLMENT_STATE } from '@/lib/fulfillment/action-state';
import type { ApprovalRow, FulfillmentListResult } from '@/lib/fulfillment/service';
import { formatPeso } from '@/lib/payments/format';
import { CollectionRemittanceControls } from '@/components/fulfillment/collection-controls';
import { PrepareFulfillmentForm } from '@/components/fulfillment/prepare-fulfillment-form';
import { EmptyState } from '@/components/states/empty-state';
import { ReadError, StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Fulfillment & Owner Approval Center (Bible §18, §5.13, §22.13–22.14).
 *
 * The screen states exactly what the database enforces:
 *   - Preparing is not releasing; releasing is not dispatching.
 *   - Normal release is permission-based; only the exceptional path needs the Owner.
 *   - Requesting executes nothing; deciding is not executing; execution happens once.
 *
 * The release preconditions shown here are ADVISORY. The database decides at
 * release time, so a stale screen can never talk goods out of the building.
 */

const TABS = ['Fulfillment Queue', 'Owner Approval Center'] as const;
type Tab = (typeof TABS)[number];

/** Fulfillment status → unified tone (same colour language as Orders): blue = in
 *  transit / awaiting release, green = done, red = failed, amber = needs attention. */
function fulfillmentTone(status: string): BadgeTone {
  if (
    ['for_shipping', 'for_pickup', 'dispatched', 'picked_up', 'approved_for_release'].includes(
      status,
    )
  ) {
    return 'info';
  }
  if (status === 'completed') return 'success';
  if (status === 'failed_delivery') return 'danger';
  if (['held', 'unclaimed_pickup'].includes(status)) return 'warning';
  return 'neutral';
}

/** Owner-approval status → unified tone: amber = awaiting, green = approved/executed,
 *  red = rejected. */
function approvalTone(status: string): BadgeTone {
  if (status === 'pending_owner_approval') return 'warning';
  if (['approved', 'executed', 'approved_and_executed'].includes(status)) return 'success';
  if (['rejected', 'denied', 'cancelled'].includes(status)) return 'danger';
  return 'neutral';
}

export function FulfillmentWorkspace({
  fulfillments,
  approvals,
  canPrepare,
  canRelease,
  canRequest,
  isOwner,
}: {
  fulfillments: FulfillmentListResult;
  approvals: ApprovalRow[];
  canPrepare: boolean;
  canRelease: boolean;
  canRequest: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Fulfillment Queue');
  // Order whose in-page details modal is open (null = closed). Opening navigates
  // nowhere, so the queue's tab and scroll position are preserved.
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  const [releaseState, releaseAction, releasing] = useActionState<
    FulfillmentActionState,
    FormData
  >(releaseFulfillmentAction, EMPTY_FULFILLMENT_STATE);
  const [dispatchState, dispatch, dispatching] = useActionState<
    FulfillmentActionState,
    FormData
  >(dispatchAction, EMPTY_FULFILLMENT_STATE);
  const [completeState, complete, completing] = useActionState<
    FulfillmentActionState,
    FormData
  >(completeFulfillmentAction, EMPTY_FULFILLMENT_STATE);
  const [requestState, request, requesting] = useActionState<
    FulfillmentActionState,
    FormData
  >(requestApprovalAction, EMPTY_FULFILLMENT_STATE);
  const [decideState, decide, deciding] = useActionState<
    FulfillmentActionState,
    FormData
  >(decideApprovalAction, EMPTY_FULFILLMENT_STATE);
  const [executeState, execute, executing] = useActionState<
    FulfillmentActionState,
    FormData
  >(executeApprovalAction, EMPTY_FULFILLMENT_STATE);

  const notices = [
    releaseState,
    dispatchState,
    completeState,
    requestState,
    decideState,
    executeState,
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <Button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            size="sm"
            variant={tab === t ? 'default' : 'outline'}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>

      {notices.map((n, i) =>
        n.error ? (
          <p key={`e${i}`} role="alert" className="text-sm text-destructive">
            {n.error}
          </p>
        ) : null,
      )}
      {notices.map((n, i) =>
        n.success ? (
          <p key={`s${i}`} className="text-sm text-muted-foreground">
            {n.success}
          </p>
        ) : null,
      )}

      {tab === 'Fulfillment Queue' ? (
        !fulfillments.ok ? (
          // A FAILED read, not an empty queue — say so, never a false "nothing".
          <ReadError
            title="Fulfillment queue could not be loaded"
            detail={fulfillments.reason}
          />
        ) : fulfillments.rows.length === 0 ? (
          <EmptyState
            title="Nothing to fulfill"
            description="Official Orders appear here for shipping or pickup preparation."
          />
        ) : (
          <ul className="space-y-2">
            {fulfillments.rows.map((f) => (
              <li key={f.officialOrderId}>
                <Card>
                  <CardContent className="space-y-2 pt-6">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {f.customerDisplayName}
                        </p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          <button
                            type="button"
                            onClick={() => setDetailOrderId(f.officialOrderId)}
                            data-testid={`fulfillment-open-order-${f.officialOrderId}`}
                            className="text-gold-strong hover:underline"
                          >
                            {f.orderNumber}
                          </button>{' '}
                          · {f.method ?? 'unset'}
                          {f.courier ? ` · ${f.courier}` : ''}
                          {f.trackingNumber ? ` · ${f.trackingNumber}` : ''}
                        </p>
                      </div>
                      <StatusBadge
                        label={f.status.replace(/_/g, ' ')}
                        tone={fulfillmentTone(f.status)}
                        className="capitalize"
                      />
                    </div>

                    {f.balanceUnavailable ? (
                      <p
                        role="alert"
                        data-testid="fulfillment-balance-unavailable"
                        className="rounded border border-destructive/50 px-2 py-1.5 text-xs"
                      >
                        <strong className="text-destructive">Balance unavailable.</strong>{' '}
                        The authoritative payment figures could not be read, so they are
                        not shown — this is <strong>not</strong> ₱0.00 paid. Release is
                        unaffected: the database re-checks payment at release time and
                        will refuse if the rule is not met. {f.balanceUnavailable}
                      </p>
                    ) : null}

                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                      <div>
                        <dt className="text-muted-foreground">Verified paid</dt>
                        <dd className="font-medium tabular-nums">
                          {f.balanceUnavailable ? '—' : formatPeso(f.verifiedNetPayments)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Total payable</dt>
                        <dd className="font-medium tabular-nums">
                          {f.balanceUnavailable ? '—' : formatPeso(f.totalAmountPayable)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">COD</dt>
                        <dd className="font-medium">
                          {f.isCod ? (f.codApproved ? 'Approved' : 'Not approved') : 'No'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Deposit floor</dt>
                        <dd className="font-medium">
                          {f.balanceUnavailable
                            ? 'Unknown'
                            : f.meetsDepositFloor
                              ? 'Met'
                              : 'Below'}
                        </dd>
                      </div>
                    </dl>

                    {/* Advisory only — the database decides at release time. */}
                    {f.method === 'shipping' &&
                    !f.balanceUnavailable &&
                    !f.meetsDepositFloor ? (
                      <p className="rounded border border-amber-500 px-2 py-1.5 text-xs">
                        Verified payment is below the ₱1,000 shipping deposit floor.
                        Normal release will be refused — an Owner-approved exceptional
                        release is the only way past it.
                      </p>
                    ) : null}

                    {f.isCod && !f.codApproved ? (
                      <p className="rounded border border-amber-500 px-2 py-1.5 text-xs">
                        COD is not approved. Release will be refused until it is.
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-end gap-2">
                      {canRelease &&
                      !['dispatched', 'picked_up', 'completed'].includes(f.status) ? (
                        <form action={releaseAction}>
                          <input
                            type="hidden"
                            name="officialOrderId"
                            value={f.officialOrderId}
                          />
                          <Button type="submit" size="sm" disabled={releasing}>
                            {releasing ? 'Releasing…' : 'Normal Release'}
                          </Button>
                        </form>
                      ) : null}

                      {canRelease && f.status === 'approved_for_release' ? (
                        <form action={dispatch}>
                          <input
                            type="hidden"
                            name="officialOrderId"
                            value={f.officialOrderId}
                          />
                          <input
                            type="hidden"
                            name="kind"
                            value={f.method === 'pickup' ? 'picked_up' : 'dispatched'}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={dispatching}
                          >
                            {f.method === 'pickup' ? 'Mark Picked Up' : 'Mark Dispatched'}
                          </Button>
                        </form>
                      ) : null}

                      {canRelease && ['dispatched', 'picked_up'].includes(f.status) ? (
                        <form action={complete}>
                          <input
                            type="hidden"
                            name="officialOrderId"
                            value={f.officialOrderId}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={completing}
                          >
                            Complete
                          </Button>
                        </form>
                      ) : null}

                      {canRequest ? (
                        <form action={request} className="flex items-end gap-2">
                          <input
                            type="hidden"
                            name="actionKind"
                            value="exceptional_fulfillment_release"
                          />
                          <input type="hidden" name="entityType" value="official_order" />
                          <input
                            type="hidden"
                            name="entityId"
                            value={f.officialOrderId}
                          />
                          <div>
                            <Label
                              htmlFor={`xr-${f.officialOrderId}`}
                              className="text-xs"
                            >
                              Exceptional release reason
                            </Label>
                            <Input
                              id={`xr-${f.officialOrderId}`}
                              name="reason"
                              required
                              placeholder="Why bypass the rules?"
                              className="h-8 w-52"
                            />
                          </div>
                          <Button
                            type="submit"
                            size="sm"
                            variant="outline"
                            disabled={requesting}
                          >
                            Request Exceptional Release
                          </Button>
                        </form>
                      ) : null}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Preparing is not releasing, and releasing is not dispatching. Normal
                      release needs verified payment; it is permission-based, not
                      Owner-only. Requesting an exceptional release releases nothing.
                    </p>

                    {/* COD collection & remittance + the printable waybill (#3
                        deeper). Shown once a method is prepared; the writes are
                        re-checked server-side and enforced by the database. */}
                    {f.method ? (
                      <CollectionRemittanceControls row={f} canRelease={canRelease} />
                    ) : null}

                    {/* Gated on the permission the domain module re-checks
                        server-side. Hiding it here is convenience; the control is
                        requirePermission('fulfillment_preparation') underneath. */}
                    {canPrepare && <PrepareFulfillmentForm row={f} />}

                    {!canPrepare && !canRelease ? (
                      <p className="text-xs text-muted-foreground">
                        Fulfillment actions require the Fulfillment Preparation or
                        Fulfillment Release permission.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'Owner Approval Center' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">The six Owner approvals</CardTitle>
          </CardHeader>
          <CardContent>
            {approvals.length === 0 ? (
              <EmptyState
                title="No approval requests"
                description="Cancellation, forfeiture, price override, exceptional release, Live Batch reopen, and verified wrong-payment correction all arrive here."
              />
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id}>
                    <Card>
                      <CardContent className="space-y-2 pt-6">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {a.actionKind.replace(/_/g, ' ')}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {a.reason}
                            </p>
                          </div>
                          <StatusBadge
                            label={`${a.status.replace(/_/g, ' ')}${a.executedAt ? ' · executed' : ''}`}
                            tone={approvalTone(a.status)}
                            className="capitalize"
                          />
                        </div>

                        {isOwner && a.status === 'pending_owner_approval' ? (
                          <div className="flex flex-wrap items-end gap-2">
                            <form action={decide} className="flex items-end gap-2">
                              <input type="hidden" name="requestId" value={a.id} />
                              <input type="hidden" name="decision" value="approved" />
                              <Button type="submit" size="sm" disabled={deciding}>
                                Approve
                              </Button>
                            </form>
                            <form action={decide} className="flex items-end gap-2">
                              <input type="hidden" name="requestId" value={a.id} />
                              <input type="hidden" name="decision" value="rejected" />
                              <Button
                                type="submit"
                                size="sm"
                                variant="destructive"
                                disabled={deciding}
                              >
                                Reject
                              </Button>
                            </form>
                          </div>
                        ) : null}

                        {isOwner && a.status === 'approved' && !a.executedAt ? (
                          <form action={execute}>
                            <input type="hidden" name="requestId" value={a.id} />
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={executing}
                            >
                              Execute
                            </Button>
                          </form>
                        ) : null}

                        {a.executedAt ? (
                          <p className="text-xs text-muted-foreground">
                            Executed. An approval executes exactly once — a retry cannot
                            run it again.
                          </p>
                        ) : null}

                        {!isOwner ? (
                          <p className="text-xs text-muted-foreground">
                            These six approvals are non-delegable. Only the Owner can
                            decide them — no permission grants this.
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-xs text-muted-foreground">
              A request never executes. Deciding authorizes; executing is a separate step
              that re-validates state — an approval granted earlier does not license an
              action whose preconditions have since changed.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Shared in-page order details — click an order number above to open it.
          The queue stays mounted behind it; actions refresh only this order. */}
      <OrderDetailsModal
        orderId={detailOrderId}
        onClose={() => setDetailOrderId(null)}
        onMutated={() => router.refresh()}
      />
    </div>
  );
}
