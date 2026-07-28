'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { deleteAttendanceRecordAction, setHourlyRateAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow } from '@/lib/hr/attendance';
import { durationHours, formatDuration } from '@/lib/hr/format';
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
 */
export function AttendanceView({
  records = [],
  payroll,
  from,
  to,
  isOwner,
  clockStaff = [],
  openSessions = {},
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
        <AttendanceClock staff={clockStaff} openSessions={openSessions} />
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
                  className="w-full min-w-[900px] text-left text-sm"
                  data-testid="payroll"
                >
                  <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Employee</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">Role</th>
                      <th className="min-w-[7rem] px-4 py-2 text-right font-medium whitespace-nowrap">
                        Regular Hours
                      </th>
                      <th className="min-w-[7rem] px-4 py-2 text-right font-medium whitespace-nowrap">
                        Overtime Hours
                      </th>
                      <th className="min-w-[6rem] px-4 py-2 text-right font-medium whitespace-nowrap">
                        Hourly Rate
                      </th>
                      <th className="min-w-[6rem] px-4 py-2 text-right font-medium whitespace-nowrap">
                        Salary
                      </th>
                      <th className="min-w-[6rem] py-2 pl-10 pr-4 font-medium whitespace-nowrap">
                        Status
                      </th>
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
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
                        <td className="px-3 py-2 font-medium whitespace-nowrap">{r.fullName}</td>
                        <td className="px-3 py-2 capitalize text-muted-foreground whitespace-nowrap">
                          {r.roleKey.replace(/_/g, ' ')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {formatDuration(r.totalHours)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {formatDuration(r.overtimeHours)}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          {isOwner ? (
                            <RateCell row={r} />
                          ) : r.hourlyRate === null ? (
                            <span className="text-[11px] text-muted-foreground">
                              No rate set
                            </span>
                          ) : (
                            <span className="tabular-nums">
                              {formatPeso(r.hourlyRate)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          {r.computedSalary === null ? (
                            <span className="text-[11px] text-muted-foreground">
                              No rate set
                            </span>
                          ) : (
                            formatPeso(r.computedSalary)
                          )}
                        </td>
                        <td className="py-2 pl-10 pr-4 whitespace-nowrap">
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
                        <td className="px-3 py-2 text-right whitespace-nowrap">
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
                <p className="mt-2 text-xs text-muted-foreground">
                  Hours, overtime, and salary are computed from attendance in SQL.
                  Overtime is per session beyond 8h (provisional). Salary needs an hourly
                  rate; without one it stays honestly blank.
                  {isOwner
                    ? ' As Owner, set a rate below to compute salary — clear it to blank the salary again.'
                    : ''}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Attendance records */}
      {showRecords ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance records</CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <EmptyState
                title="No attendance yet"
                description="Clock in above to record a session."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-left text-sm">
                  <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Staff</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Time in</th>
                      <th className="px-3 py-2 font-medium">Time out</th>
                      <th className="px-3 py-2 text-right font-medium">Duration</th>
                      {canManage ? (
                        <th className="px-3 py-2 text-right font-medium">Actions</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b last:border-0">
                        <td className="px-3 py-2">{r.staffName ?? '—'}</td>
                        <td className="px-3 py-2">{r.workDate}</td>
                        <td className="px-3 py-2">
                          {new Date(r.timeIn).toLocaleTimeString()}
                        </td>
                        <td className="px-3 py-2">
                          {r.timeOut ? (
                            new Date(r.timeOut).toLocaleTimeString()
                          ) : (
                            <span className="text-gold-strong">Open</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatDuration(durationHours(r.timeIn, r.timeOut))}
                        </td>
                        {canManage ? (
                          <td className="px-3 py-2 text-right">
                            <AttendanceRowDelete row={r} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Owner/Admin permanent delete of one attendance record. Opens a confirmation
 * that requires typing DELETE (irreversible), then removes the record; payroll,
 * being derived, recomputes on the next read.
 */
function AttendanceRowDelete({ row }: { row: AttendanceRow }) {
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
        aria-label={`Edit hourly rate for ${row.fullName}`}
        className="rounded-md border border-border px-2 py-1 text-xs tabular-nums hover:bg-accent"
      >
        {row.hourlyRate ? formatPeso(row.hourlyRate) : 'Set rate'}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Hourly rate — ${row.fullName}`}
        description="Stored as entered (money is never a float); the database enforces ≥ 0. Clear it to blank the salary."
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
              Hourly rate
            </Label>
            <MoneyInput
              id={`rate-${row.staffProfileId}`}
              name="rate"
              defaultValue={row.hourlyRate ?? ''}
              placeholder="—"
              className="mt-1 h-9 text-right tabular-nums"
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
