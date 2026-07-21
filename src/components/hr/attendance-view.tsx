'use client';

import { useActionState } from 'react';

import { clockInAction, clockOutAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { AttendanceRow } from '@/lib/hr/attendance';
import { durationHours, formatDuration } from '@/lib/hr/format';
import type { PayrollResult } from '@/lib/hr/payroll';
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { ReadError } from '@/components/ui/page-primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Attendance & Payroll (Bible §F). Clock in/out is self-service; the list and
 * payroll are RLS-scoped (a staff member sees only their own; the Owner sees
 * all). Salary is shown only when a rate is set — otherwise it says so honestly.
 */
export function AttendanceView({
  openSession,
  records,
  payroll,
  from,
  to,
}: {
  openSession: { open: boolean; since: string | null };
  records: AttendanceRow[];
  payroll: PayrollResult;
  from: string;
  to: string;
}) {
  const [inState, doClockIn, clockingIn] = useActionState<HrActionState, FormData>(
    clockInAction,
    EMPTY_HR_STATE,
  );
  const [outState, doClockOut, clockingOut] = useActionState<HrActionState, FormData>(
    clockOutAction,
    EMPTY_HR_STATE,
  );

  const notice = inState.error ?? outState.error ?? inState.success ?? outState.success;

  return (
    <div className="space-y-4">
      {/* Clock in / out */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time clock</CardTitle>
        </CardHeader>
        <CardContent>
          {openSession.open ? (
            <form action={doClockOut} className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                Clocked in
                {openSession.since
                  ? ` since ${new Date(openSession.since).toLocaleString()}`
                  : ''}
                .
              </span>
              <Button type="submit" disabled={clockingOut}>
                {clockingOut ? 'Clocking out…' : 'Clock Out'}
              </Button>
            </form>
          ) : (
            <form action={doClockIn} className="flex flex-wrap items-end gap-2">
              <div>
                <Label htmlFor="clock-note" className="text-xs">
                  Note (optional)
                </Label>
                <Input id="clock-note" name="note" className="h-9 w-64" />
              </div>
              <Button type="submit" disabled={clockingIn}>
                {clockingIn ? 'Clocking in…' : 'Clock In'}
              </Button>
            </form>
          )}
          {notice ? (
            <p
              role="status"
              className={
                (inState.error ?? outState.error)
                  ? 'mt-2 text-sm text-destructive'
                  : 'mt-2 text-sm text-muted-foreground'
              }
            >
              {notice}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Payroll summary */}
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
                className="w-full min-w-[560px] text-left text-sm"
                data-testid="payroll"
              >
                <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2 font-medium">Staff</th>
                    <th className="px-2.5 py-2 text-right font-medium">Hours</th>
                    <th className="px-2.5 py-2 text-right font-medium">Overtime</th>
                    <th className="px-2.5 py-2 text-right font-medium">Salary</th>
                  </tr>
                </thead>
                <tbody>
                  {payroll.rows.map((r) => (
                    <tr key={r.staffProfileId} className="border-b last:border-0">
                      <td className="px-2.5 py-2">
                        {r.fullName}
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {r.roleKey.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums">
                        {formatDuration(r.totalHours)}
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums">
                        {formatDuration(r.overtimeHours)}
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums">
                        {r.computedSalary === null ? (
                          <span className="text-[11px] text-muted-foreground">
                            No rate set
                          </span>
                        ) : (
                          formatPeso(r.computedSalary)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Hours, overtime, and salary are computed from attendance in SQL. Overtime
                is per session beyond 8h (provisional). Salary needs an hourly rate on the
                staff profile; without one it stays honestly blank.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attendance records */}
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
                    <th className="px-2.5 py-2 font-medium">Staff</th>
                    <th className="px-2.5 py-2 font-medium">Date</th>
                    <th className="px-2.5 py-2 font-medium">Time in</th>
                    <th className="px-2.5 py-2 font-medium">Time out</th>
                    <th className="px-2.5 py-2 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2.5 py-2">{r.staffName ?? '—'}</td>
                      <td className="px-2.5 py-2">{r.workDate}</td>
                      <td className="px-2.5 py-2">
                        {new Date(r.timeIn).toLocaleTimeString()}
                      </td>
                      <td className="px-2.5 py-2">
                        {r.timeOut ? (
                          new Date(r.timeOut).toLocaleTimeString()
                        ) : (
                          <span className="text-gold-strong">Open</span>
                        )}
                      </td>
                      <td className="px-2.5 py-2 text-right tabular-nums">
                        {formatDuration(durationHours(r.timeIn, r.timeOut))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
