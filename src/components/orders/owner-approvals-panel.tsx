'use client';

import { useActionState } from 'react';

import {
  acceptCancellationApprovalAction,
  decideApprovalAction,
  executeApprovalAction,
  rejectCancellationApprovalAction,
} from '@/lib/fulfillment/actions';
import {
  EMPTY_FULFILLMENT_STATE,
  type FulfillmentActionState,
} from '@/lib/fulfillment/action-state';
import type { ApprovalRow } from '@/lib/fulfillment/service';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Owner Approval Center — the six non-delegable Owner approvals (order cancellation,
 * layaway forfeiture, price override, exceptional release, Live Batch reopen, and
 * verified wrong-payment correction).
 *
 * It lives on the Orders page because the standalone /orders/fulfillment route was
 * retired; this panel is the reason that page could not simply be deleted. The
 * behaviour is unchanged and still uses the same guarded server actions:
 *
 *   - Deciding AUTHORIZES; it does not act.
 *   - Executing is a SEPARATE step that re-validates state, so an approval granted
 *     earlier cannot license an action whose preconditions have since changed.
 *   - An approval executes exactly once; a retry cannot run it again.
 *   - Only the Owner may decide. No permission grants this — showing the buttons is
 *     a convenience; the database is the control.
 *
 * Renders nothing when there is nothing to approve, so it never adds noise.
 */
/** A short local date-time for the request timestamp, or empty. */
function fmtWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function OwnerApprovalsPanel({
  approvals,
  isOwner,
}: {
  approvals: ApprovalRow[];
  isOwner: boolean;
}) {
  const [, decide, deciding] = useActionState<FulfillmentActionState, FormData>(
    decideApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [, execute, executing] = useActionState<FulfillmentActionState, FormData>(
    executeApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [, acceptCancel, acceptingCancel] = useActionState<FulfillmentActionState, FormData>(
    acceptCancellationApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );
  const [, rejectCancel, rejectingCancel] = useActionState<FulfillmentActionState, FormData>(
    rejectCancellationApprovalAction,
    EMPTY_FULFILLMENT_STATE,
  );

  // Only outstanding work belongs here: anything decided AND executed is history.
  const open = approvals.filter((a) => !a.executedAt && a.status !== 'rejected');
  if (open.length === 0) return null;

  return (
    <Card data-testid="owner-approvals">
      <CardHeader>
        <CardTitle className="text-base">
          Owner Approval Center
          <span className="ml-2 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-medium text-gold-strong">
            {open.length} pending
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {open.map((a) => (
            <li
              key={a.id}
              className="rounded-lg border border-border p-3"
              data-testid={`owner-approval-${a.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold capitalize">
                    {a.actionKind.replace(/_/g, ' ')}
                  </p>
                  {/* WHAT is being approved: the order + customer, so the Owner decides
                      with full context instead of a bare action name. */}
                  {a.orderNumber || a.invoiceNumber || a.customerName ? (
                    <p className="break-words text-xs font-medium text-foreground">
                      {[
                        a.orderNumber,
                        a.invoiceNumber && a.invoiceNumber !== '—' ? a.invoiceNumber : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      {a.customerName ? ` — ${a.customerName}` : ''}
                    </p>
                  ) : null}
                  {a.reason ? (
                    <p className="break-words text-xs text-muted-foreground">
                      Reason: {a.reason}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {a.requestedBy ? `Requested by ${a.requestedBy} · ` : ''}
                    {fmtWhen(a.requestedAt)}
                  </p>
                </div>
                <span className="whitespace-nowrap rounded-full border px-2 py-0.5 text-xs capitalize">
                  {a.status.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Order cancellation is simplified (Owner request): Accept finalizes
                  in ONE step, Reject undoes it. The other approval kinds keep the
                  deliberate Approve → Execute two-step. */}
              {isOwner &&
              a.status === 'pending_owner_approval' &&
              a.actionKind === 'official_order_cancellation' ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form action={acceptCancel}>
                    <input type="hidden" name="orderId" value={a.entityId} />
                    <Button type="submit" size="sm" disabled={acceptingCancel}>
                      Accept
                    </Button>
                  </form>
                  <form action={rejectCancel}>
                    <input type="hidden" name="orderId" value={a.entityId} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={rejectingCancel}
                    >
                      Reject
                    </Button>
                  </form>
                </div>
              ) : isOwner && a.status === 'pending_owner_approval' ? (
                <div className="mt-2 flex flex-wrap items-end gap-2">
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

              {isOwner &&
              a.status === 'approved' &&
              !a.executedAt &&
              a.actionKind !== 'official_order_cancellation' ? (
                <form action={execute} className="mt-2">
                  <input type="hidden" name="requestId" value={a.id} />
                  <Button type="submit" size="sm" variant="outline" disabled={executing}>
                    Execute
                  </Button>
                </form>
              ) : null}

              {!isOwner ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  These approvals are non-delegable. Only the Owner can decide them — no
                  permission grants this.
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-muted-foreground">
          Deciding authorizes; executing is a separate step that re-validates state. An
          approval executes exactly once — a retry cannot run it again.
        </p>
      </CardContent>
    </Card>
  );
}
