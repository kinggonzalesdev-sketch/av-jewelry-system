'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { deleteAttendanceRecordAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow, AttendanceSelfies } from '@/lib/hr/attendance';
import { durationHours, formatDuration } from '@/lib/hr/format';
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/page-primitives';

/**
 * Review Attendance (Team Management, Owner/Admin). A read-only, RLS-scoped view
 * of ALL team attendance with client-side filters. It shows only what the loaded
 * records carry today — corrections (with a required reason + audit), the clock
 * in/out selfies, and Late / Undertime / Overtime columns arrive with the Phase-2
 * schema additions; this page is the honest read surface they will slot into.
 */
/** A clock-in or clock-out selfie: a thumbnail that also downloads when clicked. */
function SelfieThumb({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return <span className="text-[11px] text-muted-foreground">{label} —</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download
      title={`${label} selfie — click to view / download`}
      className="inline-flex flex-col items-center gap-0.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${label} selfie`}
        className="h-9 w-9 rounded object-cover ring-1 ring-border"
      />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </a>
  );
}

export function ReviewAttendanceView({
  records,
  selfies = {},
  canManage = true,
}: {
  records: AttendanceRow[];
  selfies?: AttendanceSelfies;
  /** Owner/Admin: shows the Actions column that can permanently delete a record.
   *  The review page is Owner-only, so this defaults on; the server action is the
   *  real gate regardless. */
  canManage?: boolean;
}) {
  const [employee, setEmployee] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'all' | 'open' | 'complete'>('all');

  const employees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of records) {
      if (!seen.has(r.staffProfileId)) {
        seen.set(r.staffProfileId, r.staffName ?? 'Staff member');
      }
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [records]);

  const filtered = useMemo(() => {
    return records.filter((r) => {
      if (employee !== 'all' && r.staffProfileId !== employee) return false;
      if (from && r.workDate < from) return false;
      if (to && r.workDate > to) return false;
      if (status === 'open' && r.timeOut !== null) return false;
      if (status === 'complete' && r.timeOut === null) return false;
      return true;
    });
  }, [records, employee, from, to, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Employee</span>
          <select
            value={employee}
            onChange={(e) => setEmployee(e.target.value)}
            data-testid="review-filter-employee"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          >
            <option value="all">All employees</option>
            {employees.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'all' | 'open' | 'complete')}
            data-testid="review-filter-status"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          >
            <option value="all">All</option>
            <option value="open">Open (not clocked out)</option>
            <option value="complete">Complete</option>
          </select>
        </label>
        <p className="w-full text-xs text-muted-foreground">
          Showing <span className="tabular-nums">{filtered.length}</span> of{' '}
          <span className="tabular-nums">{records.length}</span> loaded records.
        </p>
      </div>

      {records.length === 0 ? (
        <EmptyState title="No attendance records yet" />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No records match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table
            className="data-table w-full min-w-[720px] text-left text-sm"            data-testid="review-attendance"
          >
            <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Employee</th>
                <th className="px-3 py-2.5 text-center font-medium">Date</th>
                <th className="px-3 py-2.5 text-center font-medium">Time in</th>
                <th className="px-3 py-2.5 text-center font-medium">Time out</th>
                <th className="px-3 py-2.5 text-right font-medium">Total hours</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Overtime</th>
                <th className="px-3 py-2.5 text-center font-medium">Selfies</th>
                {canManage ? (
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-2.5 font-medium">{r.staffName ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">{r.workDate}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">
                    {new Date(r.timeIn).toLocaleTimeString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">
                    {r.timeOut ? new Date(r.timeOut).toLocaleTimeString() : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatDuration(durationHours(r.timeIn, r.timeOut))}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {r.timeOut ? (
                      <StatusBadge label="Complete" tone="strong" />
                    ) : (
                      <StatusBadge label="Open" tone="gold" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.isOvertime ? (
                      <span className="font-medium text-gold-strong">
                        {formatPeso(r.overtimeAmount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-center gap-2">
                      <SelfieThumb label="In" url={selfies[r.id]?.inUrl ?? null} />
                      <SelfieThumb label="Out" url={selfies[r.id]?.outUrl ?? null} />
                    </div>
                  </td>
                  {canManage ? (
                    <td className="px-3 py-2.5 text-right">
                      <ReviewRowDelete row={r} />
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

/**
 * Owner/Admin permanent delete of one attendance record from the Review table.
 * Same guarded action + irreversible "type DELETE" confirmation as the Attendance
 * page — deleting here removes the record everywhere; payroll, being derived,
 * recomputes on the next read.
 */
function ReviewRowDelete({ row }: { row: AttendanceRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [state, submit, pending] = useActionState<HrActionState, FormData>(
    deleteAttendanceRecordAction,
    EMPTY_HR_STATE,
  );

  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  const formId = `review-delete-form-${row.id}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirm('');
          setOpen(true);
        }}
        data-testid={`review-delete-${row.id}`}
        className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Permanently delete attendance record"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              form={formId}
              disabled={pending || confirm !== 'DELETE'}
            >
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        <form id={formId} action={submit} className="space-y-3">
          <input type="hidden" name="recordId" value={row.id} />
          <p className="text-sm">
            Delete the {row.workDate} record for{' '}
            <strong>{row.staffName ?? 'this staff member'}</strong>? Payroll totals will
            recompute without it.
          </p>
          <div>
            <Label htmlFor={`review-delete-confirm-${row.id}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`review-delete-confirm-${row.id}`}
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
