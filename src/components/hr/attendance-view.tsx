'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  deleteAttendanceRecordAction,
  requestAttendanceDeletionAction,
  setHourlyRateAction,
} from '@/lib/hr/actions';
import { RequestDeletionButton } from '@/components/approvals/request-deletion-button';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow } from '@/lib/hr/attendance';
import { durationHours, formatDuration } from '@/lib/hr/format';
import { groupAttendanceDays, type AttendanceDay } from '@/lib/hr/sessions';
import type { PayrollResult, PayrollRow } from '@/lib/hr/payroll';
import { formatPeso } from '@/lib/payments/format';
import type { PayslipSnapshot } from '@/lib/hr/payslip-types';
import { AttendanceClock, type ClockStaffMember } from '@/components/hr/attendance-clock';
import { PayrollSummaryButton } from '@/components/hr/payroll-summary-button';
import { PayslipButton } from '@/components/hr/payslip-button';
import { EmptyState } from '@/components/states/empty-state';
import { ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';

/**
 * Attendance & Payroll (Bible §F). Clock in/out is self-service; the list and
 * payroll are RLS-scoped (a staff member sees only their own; the Owner sees
 * all). Salary is shown only when a rate is set — otherwise it says so honestly.
 *
 * Pay model (Owner decision): a DAILY salary rate on a weekly cycle. A period pays
 * the daily rate for each day actually worked, plus a flat ₱300 for every shift
 * clocked out at or after 10:00 PM. Days come from real attendance, so no
 * workdays-per-week setting is guessed at.
 */

const FREQUENCY_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  bi_weekly: 'Bi-Weekly',
  monthly: 'Monthly',
};

/** Today in the user's LOCAL date — the default effective date. */
function todayLocalISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
export function AttendanceView({
  records = [],
  payroll,
  from,
  to,
  isOwner,
  clockStaff = [],
  openSessions = {},
  lastOutToday = {},
  payslips = {},
  showClock = true,
  showPayroll = true,
  showRecords = true,
  canManage = false,
  canManagePayroll,
}: {
  records?: AttendanceRow[];
  payroll: PayrollResult;
  from: string;
  to: string;
  isOwner: boolean;
  /** Active team members that can be clocked in/out (kiosk selector). */
  clockStaff?: ClockStaffMember[];
  /** staff id → ISO time of their current open session. */
  openSessions?: Record<string, string>;
  /** staff id → ISO of their most recent clock-out today (drives Continue Duty). */
  lastOutToday?: Record<string, string>;
  /** Generated payslip snapshots for this period, keyed by staff id. */
  payslips?: Record<string, PayslipSnapshot>;
  /** Section toggles so the split Team Management pages reuse this one view. */
  showClock?: boolean;
  showPayroll?: boolean;
  showRecords?: boolean;
  /** Owner/Admin: shows the Actions column that can permanently delete a record. */
  canManage?: boolean;
  /** Owner/authorized Admin: may generate + mark payslips paid. Defaults to isOwner. */
  canManagePayroll?: boolean;
}) {
  const canManagePayrollResolved = canManagePayroll ?? isOwner;
  return (
    <div className="space-y-4">
      {/* Clock in / out — name header + selfie capture (Cancel / Capture). */}
      {showClock ? (
        <AttendanceClock
          staff={clockStaff}
          openSessions={openSessions}
          lastOutToday={lastOutToday}
        />
      ) : null}

      {/* Payroll summary */}
      {showPayroll ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payroll</CardTitle>
          </CardHeader>
          <CardContent>
            <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="from" className="text-xs">
                  From
                </Label>
                <Input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={from}
                  className="h-8"
                />
              </div>
              <div>
                <Label htmlFor="to" className="text-xs">
                  To
                </Label>
                <Input id="to" name="to" type="date" defaultValue={to} className="h-8" />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Apply
              </Button>
              {isOwner && payroll.ok && payroll.rows.length > 0 ? (
                <PayrollSummaryButton
                  rows={payroll.rows}
                  payslips={payslips}
                  from={from}
                  to={to}
                />
              ) : null}
            </form>

            {!payroll.ok ? (
              <ReadError
                title="Payroll unavailable"
                detail="The payroll totals could not be read."
              />
            ) : payroll.rows.length === 0 ? (
              <EmptyState title="No attendance in this range" />
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="data-table w-full min-w-[900px] text-left text-sm"
                  data-testid="payroll"
                >
                  <colgroup>
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '13%' }} />
                  </colgroup>
                  <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-medium">Employee</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center font-medium">Role</th>
                      <th className="min-w-[7rem] whitespace-nowrap px-3 py-2.5 text-right font-medium">
                        Regular Hours
                      </th>
                      <th className="min-w-[7rem] whitespace-nowrap px-3 py-2.5 text-right font-medium">
                        Overtime Hours
                      </th>
                      <th className="min-w-[6rem] whitespace-nowrap px-3 py-2.5 text-right font-medium">
                        Salary Rate
                      </th>
                      <th className="min-w-[6rem] whitespace-nowrap px-3 py-2.5 text-center font-medium">
                        Pay Frequency
                      </th>
                      <th className="min-w-[6rem] whitespace-nowrap px-3 py-2.5 text-right font-medium">
                        Salary
                      </th>
                      <th className="min-w-[6rem] whitespace-nowrap px-3 py-2.5 text-center font-medium">
                        Status
                      </th>
                      <th className="col-actions whitespace-nowrap px-3 py-2.5 font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {payroll.rows.map((r) => {
                      const snap = payslips[r.staffProfileId] ?? null;
                      const paid = snap?.paymentStatus === 'paid';
                      return (
                      <tr key={r.staffProfileId} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2.5 text-center font-medium">{r.fullName}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-center capitalize text-muted-foreground">
                          {r.roleKey.replace(/_/g, ' ')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {formatDuration(r.totalHours)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {formatDuration(r.overtimeHours)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          {isOwner ? (
                            <RateCell row={r} />
                          ) : r.dailyRate === null ? (
                            <span className="text-[11px] text-muted-foreground">
                              No rate set
                            </span>
                          ) : (
                            <span className="tabular-nums">
                              {formatPeso(r.dailyRate)}
                              <span className="text-[10px] text-muted-foreground"> /day</span>
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-center capitalize">
                          {FREQUENCY_LABEL[r.payFrequency] ?? r.payFrequency}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {r.computedSalary === null ? (
                            <span className="text-[11px] text-muted-foreground">
                              No rate set
                            </span>
                          ) : (
                            formatPeso(r.computedSalary)
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-center">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${
                              paid
                                ? 'border-green-600/40 bg-green-600/10 text-green-700'
                                : 'border-amber-500/40 bg-amber-500/10 text-amber-600'
                            }`}
                          >
                            {paid ? 'Paid' : 'Unpaid'}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right">
                          <PayslipButton
                            employeeId={r.staffProfileId}
                            from={from}
                            to={to}
                            existingSnapshot={snap}
                            canManage={canManagePayrollResolved}
                          />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Attendance records — ONE row per day, with its work sessions inside. */}
      {showRecords ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance records</CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceHistory records={records} canManage={canManage} isOwner={isOwner} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** A local "9:00:00 AM" time label for an ISO timestamp. */
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

/**
 * Attendance history, grouped into ONE row per (staff, day). The row shows the
 * day's first clock-in, final clock-out, how many work sessions it holds, and the
 * TOTAL worked (sum of session durations — never final-out minus first-in). Clicking
 * a day opens its sessions with the off-duty gaps shown but not counted (§7).
 */
function AttendanceHistory({
  records,
  canManage,
  isOwner,
}: {
  records: AttendanceRow[];
  canManage: boolean;
  isOwner: boolean;
}) {
  const days = useMemo(() => groupAttendanceDays(records), [records]);
  const [viewing, setViewing] = useState<AttendanceDay | null>(null);

  if (records.length === 0) {
    return (
      <EmptyState title="No attendance yet" description="Clock in above to record a session." />
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[680px] text-left text-sm" data-testid="attendance-days">
          <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="col-grow px-3 py-2.5 text-left font-medium">Staff</th>
              <th className="px-3 py-2.5 text-center font-medium">Date</th>
              <th className="px-3 py-2.5 text-center font-medium">First in</th>
              <th className="px-3 py-2.5 text-center font-medium">Final out</th>
              <th className="px-3 py-2.5 text-center font-medium">Sessions</th>
              <th className="px-3 py-2.5 text-right font-medium">Total worked</th>
              <th className="px-3 py-2.5 text-right font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.key} className="border-b last:border-0">
                <td className="px-3 py-2.5">{d.staffName ?? '—'}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center">{d.workDate}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center">{clockTime(d.firstIn)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-center">
                  {d.finalOut ? clockTime(d.finalOut) : <span className="text-gold-strong">Open</span>}
                </td>
                <td className="px-3 py-2.5 text-center tabular-nums">{d.sessionCount}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatDuration(d.totalHours)}</td>
                <td className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => setViewing(d)}
                    data-testid={`attendance-day-view-${d.key}`}
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

      {viewing ? (
        <DaySessionsModal
          day={viewing}
          canManage={canManage}
          isOwner={isOwner}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

/** One day's work sessions + off-duty gaps + total (§7, §14). Deleting is per SESSION
 *  (§15) — correcting one session never rewrites the whole day. */
function DaySessionsModal({
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
      title={`${day.staffName ?? 'Staff'} — ${day.workDate}`}
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
          const gapH = s.row.timeOut && next ? durationHours(s.row.timeOut, next.row.timeIn) : null;
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
                  <span className="text-sm tabular-nums">{formatDuration(s.durationHrs)}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {clockTime(s.row.timeIn)} →{' '}
                  {s.row.timeOut ? clockTime(s.row.timeOut) : <span className="text-gold-strong">Open</span>}
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
 * being derived, recomputes on the next read.
 */
function AttendanceRowDelete({ row, isOwner = false }: { row: AttendanceRow; isOwner?: boolean }) {
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

/**
 * Owner-only inline hourly-rate editor for one payroll row. The rate is kept as
 * a string the whole way (money is never a JS float); Postgres casts it and its
 * check constraint (>= 0) has the final say. Submitting an empty field clears
 * the rate, which blanks the computed salary again — an honest, reversible edit.
 */
function RateCell({ row }: { row: PayrollRow }) {
  const [state, submit, saving] = useActionState<HrActionState, FormData>(
    setHourlyRateAction,
    EMPTY_HR_STATE,
  );
  const [open, setOpen] = useState(false);
  // Close the editor once a save succeeds (once per new success).
  const lastSuccess = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastSuccess.current) {
      lastSuccess.current = state.success;
      setOpen(false);
    }
  }, [state.success]);

  const formId = `rate-form-${row.staffProfileId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit salary rate for ${row.fullName}`}
        className="rounded-md border border-border px-2 py-1 text-xs tabular-nums hover:bg-accent"
      >
        {row.dailyRate ? formatPeso(row.dailyRate) : 'Set rate'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Salary rate — ${row.fullName}`}
        size="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form={formId} disabled={saving}>
              {saving ? 'Saving…' : 'Save rate'}
            </Button>
          </>
        }
      >
        <form id={formId} action={submit} className="space-y-3">
          <input type="hidden" name="staffProfileId" value={row.staffProfileId} />
          <div className="max-w-[12rem]">
            <Label htmlFor={`rate-${row.staffProfileId}`} className="text-xs">
              Salary amount (per day)
            </Label>
            <MoneyInput
              id={`rate-${row.staffProfileId}`}
              name="rate"
              defaultValue={row.dailyRate ?? ''}
              placeholder="—"
              className="mt-1 h-9 text-right tabular-nums"
            />
          </div>
          <div className="max-w-[12rem]">
            <Label htmlFor={`freq-${row.staffProfileId}`} className="text-xs">
              Pay frequency
            </Label>
            <select
              id={`freq-${row.staffProfileId}`}
              name="frequency"
              defaultValue={row.payFrequency}
              className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="weekly">Weekly</option>
              <option value="bi_weekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="max-w-[12rem]">
            <Label htmlFor={`eff-${row.staffProfileId}`} className="text-xs">
              Effective date
            </Label>
            <Input
              id={`eff-${row.staffProfileId}`}
              name="effectiveDate"
              type="date"
              required
              defaultValue={todayLocalISO()}
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
