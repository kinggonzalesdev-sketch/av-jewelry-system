'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { setHourlyRateAction } from '@/lib/hr/actions';
import { EMPTY_HR_STATE, type HrActionState } from '@/lib/hr/action-state';
import type { EmployeeRateRow } from '@/lib/hr/rate';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal, ModalFormGrid } from '@/components/ui/modal';
import { EmptyState } from '@/components/states/empty-state';

/**
 * Employee Rates (Payroll tab). Manages each active team member's DAILY salary rate.
 * Setting a rate appends an effective-dated history row (previous rates kept), and
 * payroll uses the rate effective for the period. Owner / authorized Admin only —
 * the server + the DEFINER function are the real gates.
 */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

const FREQ_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  bi_weekly: 'Bi-Weekly',
  monthly: 'Monthly',
};

function EditRate({ row }: { row: EmployeeRateRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState(row.hourlyRate ?? '');
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [state, submit, saving] = useActionState<HrActionState, FormData>(
    setHourlyRateAction,
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

  const formId = `rate-form-${row.staffProfileId}`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setRate(row.hourlyRate ?? '');
          setEffective(new Date().toISOString().slice(0, 10));
          setOpen(true);
        }}
        data-testid={`edit-rate-${row.staffProfileId}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        Edit rate
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
          <ModalFormGrid>
            <div>
              <Label htmlFor={`rate-${row.staffProfileId}`} className="text-xs">
                Salary amount (per day)
              </Label>
              <MoneyInput
                id={`rate-${row.staffProfileId}`}
                name="rate"
                value={rate}
                onValueChange={setRate}
                className="mt-1 h-9 text-right tabular-nums"
              />
            </div>
            <div>
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
            <div>
              <Label htmlFor={`eff-${row.staffProfileId}`} className="text-xs">
                Effective date
              </Label>
              <Input
                id={`eff-${row.staffProfileId}`}
                name="effectiveDate"
                type="date"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
                className="mt-1 h-9"
              />
            </div>
          </ModalFormGrid>
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

export function EmployeeRatesView({
  rows,
  canManage,
}: {
  rows: EmployeeRateRow[];
  canManage: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState title="No active team members" />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-left text-sm" data-testid="employee-rates">
        <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Employee Name</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 text-right font-medium">Salary Rate</th>
            <th className="px-3 py-2 font-medium">Pay Frequency</th>
            <th className="px-3 py-2 font-medium">Effective Date</th>
            <th className="px-3 py-2 font-medium">Last Updated</th>
            {canManage ? <th className="px-3 py-2 text-right font-medium">Actions</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staffProfileId} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{r.fullName}</td>
              <td className="px-3 py-2 capitalize text-muted-foreground">
                {r.roleKey.replace(/_/g, ' ')}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.hourlyRate === null ? (
                  <span className="text-[11px] text-muted-foreground">No rate set</span>
                ) : (
                  <>
                    {formatPeso(r.hourlyRate)}
                    <span className="text-[10px] text-muted-foreground"> /day</span>
                  </>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {FREQ_LABEL[r.payFrequency] ?? r.payFrequency}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{r.effectiveDate ?? '—'}</td>
              <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.lastUpdated)}</td>
              {canManage ? (
                <td className="px-3 py-2 text-right">
                  <EditRate row={r} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
