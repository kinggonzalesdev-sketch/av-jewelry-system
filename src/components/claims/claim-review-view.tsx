'use client';

import { useActionState } from 'react';

import {
  confirmClaimAction,
  reprintLabelAction,
  retryPrintAction,
  voidLabelJobAction,
} from '@/lib/claims/actions';
import type { ConfirmActionState, LabelActionState } from '@/lib/claims/action-state';
import { EMPTY_CONFIRM_STATE } from '@/lib/claims/action-state';
import { EMPTY_LABEL_STATE } from '@/lib/claims/action-state';
import type { ClaimReviewRow } from '@/lib/claims/review';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Claim Review queue (Bible §6.4, §22.6).
 *
 * Confirmation is always a human decision — there is deliberately no bulk
 * approve. The controls are convenience only: permission, claim state, and
 * availability are all re-checked server-side and in the database, so hiding a
 * button is never what stops an action.
 */
export function ClaimReviewView({
  claims,
  canConfirm,
}: {
  claims: ClaimReviewRow[];
  canConfirm: boolean;
}) {
  const [confirmState, confirmAction, confirming] = useActionState<
    ConfirmActionState,
    FormData
  >(confirmClaimAction, EMPTY_CONFIRM_STATE);

  const [labelState, retryAction, retrying] = useActionState<LabelActionState, FormData>(
    retryPrintAction,
    EMPTY_LABEL_STATE,
  );

  const [voidState, voidAction, voiding] = useActionState<LabelActionState, FormData>(
    voidLabelJobAction,
    EMPTY_LABEL_STATE,
  );
  const [reprintState, reprintAction, reprinting] = useActionState<
    LabelActionState,
    FormData
  >(reprintLabelAction, EMPTY_LABEL_STATE);

  if (claims.length === 0) {
    return (
      <EmptyState
        title="No claims awaiting review"
        description="Pending Claims captured during a Live appear here for confirmation."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/*
        Confirmation and printing are reported separately, because they are
        separate facts. A print failure must never read as a failed confirmation:
        the item really is reserved.
      */}
      {confirmState.confirmed && confirmState.printProblem ? (
        <Card className="border-amber-500">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold">
              Claim confirmed — label printing failed
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The claim is confirmed and the stock is reserved. Only the label did not
              print: {confirmState.printProblem}
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <form action={retryAction}>
                <input
                  type="hidden"
                  name="labelJobId"
                  value={confirmState.confirmed.labelJobId}
                />
                <Button type="submit" size="sm" variant="outline" disabled={retrying}>
                  {retrying ? 'Retrying…' : 'Retry Print'}
                </Button>
              </form>

              <form action={reprintAction} className="flex items-end gap-2">
                <input
                  type="hidden"
                  name="labelJobId"
                  value={confirmState.confirmed.labelJobId}
                />
                <div>
                  <Label htmlFor="reprint-reason" className="text-xs">
                    Reprint reason
                  </Label>
                  <Input
                    id="reprint-reason"
                    name="reason"
                    required
                    placeholder="Why reprint?"
                    className="h-8 w-48"
                  />
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={reprinting}>
                  Reprint with Reason
                </Button>
              </form>
            </div>

            {labelState.error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {labelState.error}
              </p>
            ) : null}
            {labelState.success ? (
              <p className="mt-2 text-sm text-muted-foreground">{labelState.success}</p>
            ) : null}
            {reprintState.error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {reprintState.error}
              </p>
            ) : null}
            {reprintState.success ? (
              <p className="mt-2 text-sm text-muted-foreground">{reprintState.success}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {confirmState.error ? (
        <p role="alert" className="text-sm text-destructive">
          {confirmState.error}
        </p>
      ) : null}
      {confirmState.success ? (
        <p className="text-sm text-muted-foreground">{confirmState.success}</p>
      ) : null}

      {/* Label controls for a job that DID print.
          Retry belongs to a failed job; a reprint deliberately prints again one
          that already succeeded, and voiding cancels the paper. Without this
          block those two had no path in the UI at all — the label job existed
          and nothing could act on it. */}
      {confirmState.confirmed && !confirmState.printProblem ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm font-semibold">Label job</p>

            <div className="flex flex-wrap items-end gap-2">
              <form action={reprintAction} className="flex items-end gap-2">
                <input
                  type="hidden"
                  name="labelJobId"
                  value={confirmState.confirmed.labelJobId}
                />
                <div>
                  <Label htmlFor="reprint-reason-ok" className="text-xs">
                    Reprint reason
                  </Label>
                  <Input
                    id="reprint-reason-ok"
                    name="reason"
                    required
                    placeholder="Why reprint?"
                    className="h-8 w-48"
                  />
                </div>
                <Button type="submit" size="sm" variant="outline" disabled={reprinting}>
                  Reprint with Reason
                </Button>
              </form>

              <form action={voidAction} className="flex items-end gap-2">
                <input
                  type="hidden"
                  name="labelJobId"
                  value={confirmState.confirmed.labelJobId}
                />
                <div>
                  <Label htmlFor="void-reason" className="text-xs">
                    Void reason
                  </Label>
                  <Input
                    id="void-reason"
                    name="reason"
                    required
                    placeholder="Why void?"
                    className="h-8 w-48"
                  />
                </div>
                <Button type="submit" size="sm" variant="destructive" disabled={voiding}>
                  Void Label Job
                </Button>
              </form>
            </div>

            <p className="text-xs text-muted-foreground">
              A reprint produces another sheet of paper — it never creates a second claim
              or a second reservation. Voiding cancels the <strong>label only</strong>:
              the claim stands and the stock stays reserved.
            </p>

            {reprintState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {reprintState.error}
              </p>
            ) : null}
            {reprintState.success ? (
              <p className="text-sm text-muted-foreground">{reprintState.success}</p>
            ) : null}
            {voidState.error ? (
              <p role="alert" className="text-sm text-destructive">
                {voidState.error}
              </p>
            ) : null}
            {voidState.success ? (
              <p className="text-sm text-muted-foreground">{voidState.success}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <ul className="space-y-3">
        {claims.map((claim) => (
          <li key={claim.claimId}>
            <Card>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {claim.customerDisplayName}
                      {claim.customerFacebookName ? (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          ({claim.customerFacebookName})
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {claim.claimReference}
                      {claim.liveBatchReference ? ` · ${claim.liveBatchReference}` : ''}
                    </p>
                  </div>

                  <span className="rounded-full border px-2 py-0.5 text-xs">
                    {claim.captureMethod?.replace(/_/g, ' ') ?? claim.intakeKind}
                    {claim.capturedAgainstFlexItem ? ' · flex' : ''}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
                  {(
                    [
                      ['Item', claim.itemName ?? '—'],
                      ['Item code', claim.itemCode ?? '—'],
                      ['Grams/pc', claim.gramsPerPiece?.toString() ?? '—'],
                      ['Quantity', String(claim.quantity)],
                      [
                        'Price/pc',
                        claim.totalPricePerPiece !== null
                          ? `PHP ${claim.totalPricePerPiece.toFixed(2)}`
                          : '—',
                      ],
                      ['Captured by', claim.capturedByName ?? '—'],
                      ['Captured at', new Date(claim.capturedAt).toLocaleString()],
                      ['Evidence', `${claim.evidenceCount} attached`],
                      ['Available', String(claim.availableQuantity)],
                      ['Reserves', `${claim.reservationImpact} on confirm`],
                      [
                        'Miner',
                        claim.minerPosition ? `Position ${claim.minerPosition}` : '—',
                      ],
                      ['Waitlist', claim.waitlistStatus ?? '—'],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium">{value}</dd>
                    </div>
                  ))}
                </dl>

                {claim.warnings.map((warning) => (
                  <p
                    key={warning.message}
                    className={
                      warning.severity === 'blocking'
                        ? 'rounded border border-destructive/40 px-2 py-1.5 text-xs text-destructive'
                        : 'rounded border px-2 py-1.5 text-xs text-muted-foreground'
                    }
                  >
                    {warning.message}
                  </p>
                ))}

                {canConfirm ? (
                  <form action={confirmAction}>
                    <input type="hidden" name="claimId" value={claim.claimId} />
                    <input type="hidden" name="labelSize" value="40x30mm" />
                    <Button type="submit" disabled={confirming}>
                      {confirming ? 'Confirming…' : 'Confirm Claim & Print Label'}
                    </Button>
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Reserves {claim.reservationImpact} exactly once. Creates no invoice
                      and no Official Order.
                    </p>
                  </form>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Confirming requires the Confirm Claim &amp; Print Label permission.
                  </p>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
