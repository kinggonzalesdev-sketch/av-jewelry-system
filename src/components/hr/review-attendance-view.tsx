'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { deleteAttendanceRecordAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow, AttendanceSelfies } from '@/lib/hr/attendance';
import { durationHours, formatDuration } from '@/lib/hr/format';
import { groupAttendanceDays, type AttendanceDay } from '@/lib/hr/sessions';
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

  // Filter the raw sessions, then group into ONE row per (employee, day). The status
  // filter then applies to the day (open = it still has a session running).
  const [viewing, setViewing] = useState<AttendanceDay | null>(null);
  const days = useMemo(() => {
    const filteredRecords = records.filter((r) => {
      if (employee !== 'all' && r.staffProfileId !== employee) return false;
      if (from && r.workDate < from) return false;
      if (to && r.workDate > to) return false;
      return true;
    });
    let grouped = groupAttendanceDays(filteredRecords);
    if (status === 'open') grouped = grouped.filter((d) => d.hasOpen);
    if (status === 'complete') grouped = grouped.filter((d) => !d.hasOpen);
    return grouped;
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
          Showing <span className="tabular-nums">{days.length}</span> attendance{' '}
          {days.length === 1 ? 'day' : 'days'} ({records.length} loaded sessions).
        </p>
      </div>

      {records.length === 0 ? (
        <EmptyState title="No attendance records yet" />
      ) : days.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No records match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table
            className="data-table w-full min-w-[760px] text-left text-sm"
            data-testid="review-attendance"
          >
            <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="col-grow px-3 py-2.5 text-left font-medium">Employee</th>
                <th className="px-3 py-2.5 text-center font-medium">Date</th>
                <th className="px-3 py-2.5 text-center font-medium">First in</th>
                <th className="px-3 py-2.5 text-center font-medium">Final out</th>
                <th className="px-3 py-2.5 text-center font-medium">Sessions</th>
                <th className="px-3 py-2.5 text-right font-medium">Total worked</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Overtime</th>
                <th className="col-actions px-3 py-2.5 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.key} className="border-b last:border-0">
                  <td className="px-3 py-2.5 font-medium">{d.staffName ?? '—'}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">
                    {d.workDate}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">
                    {new Date(d.firstIn).toLocaleTimeString()}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-center">
                    {d.finalOut ? new Date(d.finalOut).toLocaleTimeString() : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-center tabular-nums">
                    {d.sessionCount}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatDuration(d.totalHours)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {d.hasOpen ? (
                      <StatusBadge label="Open" tone="gold" />
                    ) : (
                      <StatusBadge label="Complete" tone="strong" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {d.isOvertime ? (
                      <span className="font-medium text-gold-strong">
                        {formatPeso(d.overtimeAmount)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="col-actions px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => setViewing(d)}
                      data-testid={`review-day-view-${d.key}`}
                      className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing ? (
        <ReviewDayModal
          day={viewing}
          selfies={selfies}
          canManage={canManage}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * One day's work sessions for Review (§14): each session's clock in/out, duration,
 * its selfies, and the off-duty gaps shown but NOT counted, ending in the day's
 * total worked. Deleting is per session (§15).
 */
function ReviewDayModal({
  day,
  selfies,
  canManage,
  onClose,
}: {
  day: AttendanceDay;
  selfies: AttendanceSelfies;
  canManage: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${day.staffName ?? 'Staff'} — ${day.workDate}`}
      description={`${day.sessionCount} work session${day.sessionCount === 1 ? '' : 's'}`}
      size="lg"
      footer={
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="space-y-2">
        {day.sessions.map((s, i) => {
          const next = day.sessions[i + 1];
          const gapH =
            s.row.timeOut && next ? durationHours(s.row.timeOut, next.row.timeIn) : null;
          return (
            <div key={s.row.id}>
              <div className="rounded-md border border-border p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Session {s.sessionNumber}
                    {s.continued ? (
                      <span className="ml-2 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold-strong">
                        Continued Duty
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm tabular-nums">
                    {formatDuration(s.durationHrs)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.row.timeIn).toLocaleTimeString()} →{' '}
                    {s.row.timeOut ? (
                      new Date(s.row.timeOut).toLocaleTimeString()
                    ) : (
                      <span className="text-gold-strong">Open</span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <SelfieThumb label="In" url={selfies[s.row.id]?.inUrl ?? null} />
                    <SelfieThumb label="Out" url={selfies[s.row.id]?.outUrl ?? null} />
                  </div>
                </div>
                {s.row.isOvertime ? (
                  <p className="mt-1 text-[11px] text-gold-strong">
                    Overtime (night) · {formatPeso(s.row.overtimeAmount)}
                  </p>
                ) : null}
                {canManage ? (
                  <div className="mt-2">
                    <ReviewRowDelete row={s.row} />
                  </div>
                ) : null}
              </div>
              {next && gapH && gapH > 0 ? (
                <p className="py-1 text-center text-[11px] text-muted-foreground">
                  Off duty · {formatDuration(gapH)} — not counted
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
          <span>Total worked</span>
          <span className="tabular-nums">{formatDuration(day.totalHours)}</span>
        </div>
      </div>
    </Modal>
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
