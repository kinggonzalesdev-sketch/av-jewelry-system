'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  deleteAttendanceRecordAction,
  requestAttendanceDeletionAction,
} from '@/lib/hr/actions';
import { RequestDeletionButton } from '@/components/approvals/request-deletion-button';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow } from '@/lib/hr/attendance';
import { clockTime, formatWorkDate } from '@/lib/hr/attendance-paging';
import { durationHours, formatDuration } from '@/lib/hr/format';
import type { AttendanceDay } from '@/lib/hr/sessions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * One day's work sessions: each session's clock in/out, its duration, the off-duty gaps shown
 * but NOT counted, and the day's total. Moved out of attendance-view.tsx unchanged (Owner
 * 2026-09-06) so the records table and the payroll view no longer share one large component.
 *
 * Correcting is still per SESSION — deleting one session never rewrites the whole day, and
 * Review Attendance remains the place for review/approval.
 */
export function AttendanceDayDetails({
  day,
  canManage,
  isOwner,
  onClose,
}: {
  day: AttendanceDay;
  canManage: boolean;
  isOwner: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`${day.staffName ?? 'Staff'} — ${formatWorkDate(day.workDate)}`}
      description={`${day.sessionCount} work session${day.sessionCount === 1 ? '' : 's'}`}
      size="md"
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
                <div className="flex items-center justify-between">
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
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {clockTime(s.row.timeIn)} →{' '}
                  {s.row.timeOut ? (
                    clockTime(s.row.timeOut)
                  ) : (
                    <span className="text-gold-strong">still clocked in</span>
                  )}
                </div>
                {canManage ? (
                  <div className="mt-2">
                    <AttendanceRowDelete row={s.row} isOwner={isOwner} />
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
 * Owner/Admin permanent delete of one attendance record. Opens a confirmation
 * that requires typing DELETE (irreversible), then removes the record; payroll,
 * being derived, recomputes on the next read. A non-owner Admin requests Owner
 * approval instead — unchanged behaviour, moved verbatim.
 */
export function AttendanceRowDelete({
  row,
  isOwner = false,
}: {
  row: AttendanceRow;
  isOwner?: boolean;
}) {
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

  const formId = `attendance-delete-form-${row.id}`;

  // A non-owner Admin can't delete directly — they request Owner approval (Approvals
  // Phase 2). The Owner keeps the immediate type-DELETE flow below.
  if (!isOwner) {
    const label = `${row.staffName ?? 'staff'} · ${row.workDate}`;
    return (
      <RequestDeletionButton
        label={label}
        entityNoun="attendance record"
        testIdBase={`attendance-request-delete-${row.id}`}
        onRequest={(reason) => requestAttendanceDeletionAction(row.id, label, reason)}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirm('');
          setOpen(true);
        }}
        data-testid={`attendance-delete-${row.id}`}
        className="tap-44 rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
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
            Delete the {formatWorkDate(row.workDate)} record for{' '}
            <strong>{row.staffName ?? 'this staff member'}</strong>? Payroll totals will
            recompute without it.
          </p>
          <div>
            <Label htmlFor={`attendance-delete-confirm-${row.id}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`attendance-delete-confirm-${row.id}`}
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
