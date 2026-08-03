'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { decideDeletionRequestAction } from '@/lib/authz/deletion-actions';
import type {
  DeletionRequestRow,
  DeletionStatus,
} from '@/lib/authz/deletion-requests';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';

/**
 * Administration → Deletion Requests (§2).
 *
 * Four tabs over ONE register: Pending · Approved · Rejected · Directly Deleted.
 * Approve / Reject appear only for a Super Admin, and only on a pending row — the
 * database refuses everyone else regardless, so the tabs stay readable by any
 * Admin who wants to see where their own request went.
 *
 * Approving records the DECISION. The deletion itself is then carried out through
 * that record's own guarded path, which is why an approved row still names the
 * record: someone has to go and do it, and the register says what was permitted.
 */

const TABS: Array<{ key: DeletionStatus; label: string }> = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'directly_deleted', label: 'Directly Deleted' },
];

const TONE: Record<DeletionStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'strong',
  rejected: 'danger',
  directly_deleted: 'neutral',
};

const LABEL: Record<DeletionStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  directly_deleted: 'Directly Deleted',
};

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function DeletionRequestsPanel({
  requests,
  isSuperAdmin,
}: {
  requests: DeletionRequestRow[];
  /** Only a Super Admin sees Approve / Reject. The DB is the real gate. */
  isSuperAdmin: boolean;
}) {
  const [tab, setTab] = useState<DeletionStatus>('pending');

  const counts = useMemo(() => {
    const c: Record<DeletionStatus, number> = {
      pending: 0,
      approved: 0,
      rejected: 0,
      directly_deleted: 0,
    };
    for (const r of requests) c[r.status] += 1;
    return c;
  }, [requests]);

  const rows = useMemo(() => requests.filter((r) => r.status === tab), [requests, tab]);

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            size="sm"
            variant={tab === t.key ? 'default' : 'outline'}
            onClick={() => setTab(t.key)}
            data-testid={`deletion-tab-${t.key}`}
          >
            {t.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[t.key]}</span>
          </Button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={`No ${LABEL[tab].toLowerCase()} deletion requests`} />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table
            className="data-table w-full min-w-[760px] text-left text-sm"
            data-testid="deletion-requests"
          >
            <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Record</th>
                <th className="px-3 py-2.5 text-center font-medium">Type</th>
                <th className="px-3 py-2.5 text-left font-medium">Reason</th>
                <th className="px-3 py-2.5 text-left font-medium">Requested by</th>
                <th className="px-3 py-2.5 text-center font-medium">Requested</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-3 py-2.5 text-left font-medium">Decided</th>
                {isSuperAdmin && tab === 'pending' ? (
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5 font-medium">{r.entityLabel}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-muted-foreground">
                    {humanize(r.entityType)}
                  </td>
                  <td className="px-3 py-2.5 text-xs">{r.reason}</td>
                  <td className="px-3 py-2.5">{r.requestedByName}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center text-xs">
                    {fmt(r.requestedAt)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusBadge label={LABEL[r.status]} tone={TONE[r.status]} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {r.decidedByName ? (
                      <>
                        {r.decidedByName}
                        <br />
                        {fmt(r.decidedAt)}
                        {r.decisionNote ? (
                          <>
                            <br />
                            <span className="italic">{r.decisionNote}</span>
                          </>
                        ) : null}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  {isSuperAdmin && tab === 'pending' ? (
                    <td className="px-3 py-2.5 text-right">
                      <DecideActions row={r} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Approve / Reject with a confirmation step and an optional note. */
function DecideActions({ row }: { row: DeletionRequestRow }) {
  const router = useRouter();
  const [decision, setDecision] = useState<null | 'approved' | 'rejected'>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!decision || pending) return;
    setPending(true);
    setError(null);
    const res = await decideDeletionRequestAction(row.id, decision, note.trim() || null);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDecision(null);
    setNote('');
    router.refresh();
  };

  const rejecting = decision === 'rejected';

  return (
    <>
      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setError(null);
            setDecision('approved');
          }}
          data-testid={`deletion-approve-${row.id}`}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setError(null);
            setDecision('rejected');
          }}
          data-testid={`deletion-reject-${row.id}`}
        >
          Reject
        </Button>
      </div>

      <Modal
        open={decision !== null}
        onClose={() => {
          if (!pending) setDecision(null);
        }}
        title={rejecting ? 'Reject deletion request' : 'Approve deletion request'}
        size="sm"
        critical={!rejecting}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDecision(null)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={rejecting ? 'outline' : 'destructive'}
              onClick={() => void run()}
              disabled={pending}
              data-testid="deletion-decide-confirm"
            >
              {pending ? 'Saving…' : rejecting ? 'Reject' : 'Approve deletion'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-left">
          <p className="text-sm">
            <strong>{row.entityLabel}</strong> ({humanize(row.entityType)}), requested by{' '}
            {row.requestedByName}.
          </p>
          <p className="text-xs text-muted-foreground">Reason given: {row.reason}</p>
          {!rejecting ? (
            <p className="text-xs text-muted-foreground">
              Approving records the decision. The record is then deleted through its
              own screen, which keeps that screen&apos;s own confirmations in force.
            </p>
          ) : null}
          <div>
            <Label htmlFor={`deletion-note-${row.id}`} className="text-xs">
              Note (optional)
            </Label>
            <Input
              id={`deletion-note-${row.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 h-9"
              autoComplete="off"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
