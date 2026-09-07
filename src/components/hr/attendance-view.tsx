'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { setHourlyRateAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import { formatDuration } from '@/lib/hr/format';
import type { PayrollResult, PayrollRow } from '@/lib/hr/payroll';
import { Money } from '@/components/shell/privacy';
import type { PayslipSnapshot } from '@/lib/hr/payslip-types';
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
 * Payroll (Bible §F) — the DERIVED period table, RLS-scoped (a staff member sees only their
 * own row; the Owner sees all). Salary is shown only when a rate is set — otherwise it says
 * so honestly.
 *
 * Pay model (Owner decision): a DAILY salary rate on a weekly cycle. A period pays
 * the daily rate for each day actually worked, plus a flat ₱300 for every shift
 * clocked out at or after 10:00 PM. Days come from real attendance, so no
 * workdays-per-week setting is guessed at.
 *
 * The time clock and the attendance history used to live here too. They now have their own
 * components (`attendance-clock.tsx`, `attendance-records.tsx`) because the records list
 * became filtered + server-paginated (Owner 2026-09-06); payroll's reads and maths are
 * untouched by that change.
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
  payroll,
  from,
  to,
  isOwner,
  payslips = {},
  canManagePayroll,
}: {
  payroll: PayrollResult;
  from: string;
  to: string;
  isOwner: boolean;
  /** Generated payslip snapshots for this period, keyed by staff id. */
  payslips?: Record<string, PayslipSnapshot>;
  /** Owner/authorized Admin: may generate + mark payslips paid. Defaults to isOwner. */
  canManagePayroll?: boolean;
}) {
  const canManagePayrollResolved = canManagePayroll ?? isOwner;
  return (
    <div className="space-y-4">
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
                className="data-table data-table--stack w-full min-w-[900px] text-left text-sm"
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
                    <th className="whitespace-nowrap px-3 py-2.5 text-center font-medium">
                      Employee
                    </th>
                    <th className="whitespace-nowrap px-3 py-2.5 text-center font-medium">
                      Role
                    </th>
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
                        <td className="whitespace-nowrap px-3 py-2.5 text-center font-medium">
                          {r.fullName}
                        </td>
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
                              <Money amount={r.dailyRate} />
                              <span className="text-[10px] text-muted-foreground">
                                {' '}
                                /day
                              </span>
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
                            <Money amount={r.computedSalary} />
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
    </div>
  );
}

// The time clock, the attendance history table and its day/delete modals moved to
// attendance-clock.tsx, attendance-records.tsx and attendance-day-details.tsx (Owner
// 2026-09-06). This file is now just Payroll + the inline rate editor below.

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
        {row.dailyRate ? <Money amount={row.dailyRate} /> : 'Set rate'}
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
