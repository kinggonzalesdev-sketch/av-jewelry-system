'use client';

import { useActionState, useState } from 'react';

import {
  approveAllReadyAction,
  approveAndSendAction,
  copyMessageAction,
  markReviewedAction,
  markSentAction,
  prepareAllEligibleAction,
  removeClaimAction,
  retryMessageAction,
} from '@/lib/invoicing/actions';
import type { InvoiceActionState } from '@/lib/invoicing/action-state';
import { EMPTY_INVOICE_STATE } from '@/lib/invoicing/action-state';
import type { DraftSummary } from '@/lib/invoicing/drafts';
import { moneyString } from '@/lib/payments/format';
import { Money } from '@/components/shell/privacy';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** One draft card: summary, Print invoice (reprintable), Review/Approve, and — for
 *  an open (unsent) draft — the claims with a rule-safe Remove (before approval).
 *  Editing a SENT invoice is refused server-side; this UI matches that. */
function DraftCard({
  draft,
  canPrepare,
  reviewAction,
  reviewing,
  approveAction,
  approving,
  removeAction,
  removing,
}: {
  draft: DraftSummary;
  canPrepare: boolean;
  reviewAction: (fd: FormData) => void;
  reviewing: boolean;
  approveAction: (fd: FormData) => void;
  approving: boolean;
  removeAction: (fd: FormData) => void;
  removing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const editable =
    canPrepare && (draft.status === 'draft' || draft.status === 'in_review');

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{draft.customerDisplayName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {draft.claimCount} claim(s) · <Money amount={moneyString(draft.totalAmount)} />{' '}
              ·{' '}
              {draft.paymentArrangement?.replace('_', ' ') ?? 'unset'} ·{' '}
              {draft.fulfillmentArrangement ?? 'unset'}
            </p>
            {draft.orderNumber ? (
              <p className="truncate font-mono text-xs">
                {draft.invoiceNumber}
                {draft.holdExpiresAt
                  ? ` · hold until ${new Date(draft.holdExpiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`
                  : ''}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full border px-2 py-0.5 text-xs">
              {draft.status.replace('_', ' ')}
            </span>

            {canPrepare && draft.status === 'draft' ? (
              <form action={reviewAction}>
                <input type="hidden" name="invoiceDraftId" value={draft.id} />
                <Button type="submit" size="sm" variant="outline" disabled={reviewing}>
                  Review Invoice
                </Button>
              </form>
            ) : null}

            {canPrepare && draft.status === 'in_review' ? (
              <form action={approveAction}>
                <input type="hidden" name="invoiceDraftId" value={draft.id} />
                <Button type="submit" size="sm" disabled={approving}>
                  Approve &amp; Send Invoice
                </Button>
              </form>
            ) : null}
          </div>
        </div>

        {/* Line items — review, and (open drafts only) remove a claim with a reason.
            A sent invoice is history and cannot be edited (enforced server-side). */}
        {draft.claims.length > 0 ? (
          <div className="rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent"
              data-testid={`invoice-claims-toggle-${draft.id}`}
            >
              <span>
                {open ? 'Hide' : 'Review'} {draft.claimCount} line item(s)
              </span>
              <span aria-hidden="true">{open ? '▲' : '▼'}</span>
            </button>
            {open ? (
              <ul className="divide-y divide-border">
                {draft.claims.map((c) => (
                  <li key={c.claimId} className="px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="font-mono">{c.claimReference}</span> ·{' '}
                        {c.itemName ?? c.itemCode ?? '—'} · Qty {c.quantity}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums">
                          <Money amount={moneyString(c.lineTotal)} />
                        </span>
                        {editable && removingId !== c.claimId ? (
                          <button
                            type="button"
                            onClick={() => setRemovingId(c.claimId)}
                            className="rounded border border-border px-1.5 py-0.5 text-[11px] text-destructive hover:bg-destructive/10"
                          >
                            Remove
                          </button>
                        ) : null}
                      </span>
                    </div>
                    {editable && removingId === c.claimId ? (
                      <form
                        action={removeAction}
                        onSubmit={() => setRemovingId(null)}
                        className="mt-1.5 flex flex-wrap items-center gap-1.5"
                      >
                        <input type="hidden" name="invoiceDraftId" value={draft.id} />
                        <input type="hidden" name="claimId" value={c.claimId} />
                        <input
                          name="reason"
                          required
                          placeholder="Reason for removing"
                          className="h-7 flex-1 rounded border border-border bg-background px-2 text-[11px] outline-none focus:border-gold"
                        />
                        <Button
                          type="submit"
                          size="sm"
                          variant="destructive"
                          disabled={removing}
                        >
                          Confirm
                        </Button>
                        <button
                          type="button"
                          onClick={() => setRemovingId(null)}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Invoice workspace (Bible §15, §22.8–22.9).
 *
 * Two deliberate honesty rules shape this screen:
 *   - An order that exists is reported as existing even when its message fails.
 *   - Copy is not Sent. The two are separate controls with separate wording,
 *     because the system cannot witness a paste into Facebook.
 *
 * Controls are convenience only: permission, eligibility, and grouping are all
 * re-checked server-side and in the database.
 */
export function InvoiceWorkspace({
  drafts,
  canPrepare,
}: {
  drafts: DraftSummary[];
  canPrepare: boolean;
}) {
  const [state, prepareAction, preparing] = useActionState<InvoiceActionState, FormData>(
    prepareAllEligibleAction,
    EMPTY_INVOICE_STATE,
  );
  const [approveState, approveAction, approving] = useActionState<
    InvoiceActionState,
    FormData
  >(approveAndSendAction, EMPTY_INVOICE_STATE);
  const [bulkState, bulkAction, bulking] = useActionState<InvoiceActionState, FormData>(
    approveAllReadyAction,
    EMPTY_INVOICE_STATE,
  );
  const [reviewState, reviewAction, reviewing] = useActionState<
    InvoiceActionState,
    FormData
  >(markReviewedAction, EMPTY_INVOICE_STATE);
  const [copyState, copyAction] = useActionState<InvoiceActionState, FormData>(
    copyMessageAction,
    EMPTY_INVOICE_STATE,
  );
  const [sentState, sentAction, sending] = useActionState<InvoiceActionState, FormData>(
    markSentAction,
    EMPTY_INVOICE_STATE,
  );
  const [retryState, retryAction, retrying] = useActionState<
    InvoiceActionState,
    FormData
  >(retryMessageAction, EMPTY_INVOICE_STATE);
  const [removeState, removeAction, removing] = useActionState<
    InvoiceActionState,
    FormData
  >(removeClaimAction, EMPTY_INVOICE_STATE);

  const notices = [
    state,
    approveState,
    bulkState,
    reviewState,
    copyState,
    sentState,
    retryState,
    removeState,
  ];

  return (
    <div className="space-y-4">
      {canPrepare ? (
        <Card>
          <CardHeader>
            <CardTitle>Bulk actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <form action={prepareAction}>
              <Button type="submit" variant="outline" disabled={preparing}>
                {preparing ? 'Preparing…' : 'Prepare All Eligible Invoices'}
              </Button>
            </form>

            <form action={bulkAction}>
              {/* Explicit confirmation: bulk approval is the commit point. */}
              <input type="hidden" name="confirm" value="yes" />
              <Button type="submit" disabled={bulking}>
                {bulking ? 'Approving…' : 'Approve & Send All Ready Invoices'}
              </Button>
            </form>

            <p className="w-full text-xs text-muted-foreground">
              Preparing creates drafts only — no Official Order and no message. Approving
              is the commit point: it creates one Official Order per draft and starts the
              3-day hold.
            </p>
          </CardContent>
        </Card>
      ) : null}

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

      {/*
        The order exists; only the message failed. Reporting this as a failure
        would send the operator to approve an order that already exists.
      */}
      {approveState.order && approveState.messageProblem ? (
        <Card className="border-amber-500">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold">
              Official Order created — message sending failed
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Order (invoice{' '}
              {approveState.order.invoiceNumber}) exists and its stock is committed. Only
              the message failed: {approveState.messageProblem}
            </p>
            <form action={retryAction} className="mt-3">
              <input
                type="hidden"
                name="officialOrderId"
                value={approveState.order.officialOrderId}
              />
              <Button type="submit" size="sm" variant="outline" disabled={retrying}>
                {retrying ? 'Retrying…' : 'Retry Message'}
              </Button>
            </form>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Retrying re-sends the message only. It cannot create another Official Order.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Prepared message: Copy and Mark as Sent are deliberately separate. */}
      {(approveState.messageBody ?? retryState.messageBody) ? (
        <Card>
          <CardHeader>
            <CardTitle>Invoice message</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-muted p-3 text-xs">
              {approveState.messageBody ?? retryState.messageBody}
            </pre>

            <div className="mt-3 flex flex-wrap gap-2">
              <form action={copyAction}>
                <input
                  type="hidden"
                  name="messageId"
                  value={approveState.messageId ?? retryState.messageId ?? ''}
                />
                <Button type="submit" size="sm" variant="outline">
                  Copy Invoice Message
                </Button>
              </form>

              <form action={sentAction}>
                <input
                  type="hidden"
                  name="messageId"
                  value={approveState.messageId ?? retryState.messageId ?? ''}
                />
                <Button type="submit" size="sm" variant="outline" disabled={sending}>
                  Mark as Sent
                </Button>
              </form>
            </div>

            <p className="mt-2 text-xs text-muted-foreground">
              Copy is not Sent. Mark as Sent records your attestation — delivery and read
              are not observed, because no messaging integration exists.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {drafts.length === 0 ? (
        <EmptyState
          title="No Invoice Drafts"
          description={
            canPrepare
              ? 'Use Prepare All Eligible Invoices to group Confirmed Claims into drafts.'
              : 'You do not have the Invoice Preparation permission.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <DraftCard
                draft={draft}
                canPrepare={canPrepare}
                reviewAction={reviewAction}
                reviewing={reviewing}
                approveAction={approveAction}
                approving={approving}
                removeAction={removeAction}
                removing={removing}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
