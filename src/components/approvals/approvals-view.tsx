'use client';

import { useActionState, useState, type ReactNode } from 'react';

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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { DataTable, Thead, Tr, Th, Td } from '@/components/ui/data-table';
import { StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';
import { EmptyState } from '@/components/states/empty-state';

/**
 * Approvals module — the dedicated queue for the non-delegable Owner approvals,
 * moved out of Orders (2026-08-09). Presentation only: it REUSES the existing
 * owner_approval_requests reader (ApprovalRow) and the SAME guarded server actions
 * as the old panel. The database remains the control:
 *   - Deciding AUTHORIZES; executing is a separate, state-revalidating step.
 *   - An approval executes exactly once; a retry cannot run it again.
 *   - Only the Owner may decide — showing the buttons is a convenience.
 * Realtime: any change to owner_approval_requests triggers the shell's
 * DashboardSync router.refresh(), so the list, the Pending count, and the sidebar
 * badge all update without a reload.
 */

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

const TABS: { readonly key: TabKey; readonly label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function statusTone(a: ApprovalRow): BadgeTone {
  if (a.status === 'rejected') return 'danger';
  if (a.status === 'approved' || a.executedAt) return 'success';
  if (a.status === 'pending_owner_approval') return 'warning';
  return 'neutral';
}

function statusLabel(a: ApprovalRow): string {
  if (a.status === 'approved' && a.executedAt) return 'Executed';
  return humanize(a.status);
}

function matchesTab(a: ApprovalRow, tab: TabKey): boolean {
  switch (tab) {
    case 'pending':
      return a.status === 'pending_owner_approval';
    case 'approved':
      return a.status === 'approved';
    case 'rejected':
      return a.status === 'rejected';
    case 'all':
      return true;
  }
}

function reference(a: ApprovalRow): string {
  return (
    [a.orderNumber, a.invoiceNumber && a.invoiceNumber !== '—' ? a.invoiceNumber : null]
      .filter(Boolean)
      .join(' · ') || '—'
  );
}

export function ApprovalsView({
  approvals,
  isOwner,
}: {
  approvals: ApprovalRow[];
  isOwner: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pendingCount = approvals.filter(
    (a) => a.status === 'pending_owner_approval',
  ).length;
  const rows = approvals.filter((a) => matchesTab(a, tab));
  // Derived from the fresh prop (by id) so the modal reflects a decision the moment
  // realtime refreshes the list — never a stale copy.
  const selected = selectedId ? approvals.find((a) => a.id === selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-b-2 border-gold text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            data-testid={`approvals-tab-${t.key}`}
          >
            {t.label}
            {t.key === 'pending' && pendingCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                {pendingCount}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={
            tab === 'pending'
              ? 'No approvals are waiting for a decision.'
              : `No ${tab} approvals.`
          }
        />
      ) : (
        <DataTable
          minWidth="920px"
          spacious
          columns={['13%', '13%', '15%', '13%', '18%', '13%', '8%', '7%']}
        >
          <Thead>
            <Tr plain>
              <Th kind="center">Type</Th>
              <Th>Reference</Th>
              <Th>Customer / Item</Th>
              <Th>Requested By</Th>
              <Th>Reason</Th>
              <Th kind="center">Date &amp; Time</Th>
              <Th kind="center">Status</Th>
              <Th kind="actions">Actions</Th>
            </Tr>
          </Thead>
          <tbody>
            {rows.map((a) => (
              <Tr key={a.id}>
                <Td kind="center" clip title={humanize(a.actionKind)} className="font-medium capitalize">
                  {humanize(a.actionKind)}
                </Td>
                <Td clip className="font-mono text-xs">
                  {reference(a)}
                </Td>
                <Td clip title={a.customerName ?? undefined}>
                  {a.customerName ?? '—'}
                </Td>
                <Td clip>{a.requestedBy ?? '—'}</Td>
                <Td clip title={a.reason || undefined} className="text-muted-foreground">
                  {a.reason || '—'}
                </Td>
                <Td kind="center" className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmtWhen(a.requestedAt)}
                </Td>
                <Td kind="center">
                  <StatusBadge label={statusLabel(a)} tone={statusTone(a)} />
                </Td>
                <Td kind="actions">
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                    data-testid={`approval-view-${a.id}`}
                  >
                    View
                  </button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelectedId(null)}
        title="Approval"
        size="md"
      >
        {selected ? <ApprovalDetail approval={selected} isOwner={isOwner} /> : null}
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function ApprovalDetail({ approval: a, isOwner }: { approval: ApprovalRow; isOwner: boolean }) {
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

  const isPending = a.status === 'pending_owner_approval';
  const isCancellation = a.actionKind === 'official_order_cancellation';
  const canExecute = a.status === 'approved' && !a.executedAt && !isCancellation;

  return (
    <div data-testid="approval-detail">
      <dl>
        <DetailRow
          label="Type"
          value={<span className="capitalize">{humanize(a.actionKind)}</span>}
        />
        <DetailRow label="Reference" value={reference(a)} />
        <DetailRow label="Customer / Item" value={a.customerName ?? '—'} />
        <DetailRow label="Reason" value={a.reason || '—'} />
        <DetailRow label="Requested by" value={a.requestedBy ?? '—'} />
        <DetailRow label="Requested" value={fmtWhen(a.requestedAt)} />
        <DetailRow
          label="Status"
          value={<StatusBadge label={statusLabel(a)} tone={statusTone(a)} />}
        />
        {a.decidedAt ? <DetailRow label="Decided" value={fmtWhen(a.decidedAt)} /> : null}
        {a.executedAt ? <DetailRow label="Executed" value={fmtWhen(a.executedAt)} /> : null}
      </dl>

      {/* The SAME guarded server actions as the retired panel. Cancellation is a
          one-step Accept/Reject; every other kind is Approve → Execute. Only the
          Owner sees the controls; the database re-checks and executes exactly once. */}
      {isOwner && isPending && isCancellation ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={acceptCancel}>
            <input type="hidden" name="orderId" value={a.entityId} />
            <Button type="submit" size="sm" disabled={acceptingCancel}>
              Approve
            </Button>
          </form>
          <form action={rejectCancel}>
            <input type="hidden" name="orderId" value={a.entityId} />
            <Button type="submit" size="sm" variant="outline" disabled={rejectingCancel}>
              Reject
            </Button>
          </form>
        </div>
      ) : isOwner && isPending ? (
        <div className="mt-4 flex flex-wrap gap-2">
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
      ) : isOwner && canExecute ? (
        <form action={execute} className="mt-4">
          <input type="hidden" name="requestId" value={a.id} />
          <Button type="submit" size="sm" variant="outline" disabled={executing}>
            Execute
          </Button>
        </form>
      ) : null}

      <p className="mt-3 text-xs text-muted-foreground">
        Deciding authorizes; executing re-validates state and runs exactly once — a retry
        cannot run it again.
      </p>
    </div>
  );
}
