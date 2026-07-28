'use client';

import { useState } from 'react';

import { AttendanceView } from '@/components/hr/attendance-view';
import { EmployeeRatesView } from '@/components/hr/employee-rates-view';
import type { PayrollResult } from '@/lib/hr/payroll';
import type { PayslipSnapshot } from '@/lib/hr/payslip-types';
import type { EmployeeRateRow } from '@/lib/hr/rate';
import { Button } from '@/components/ui/button';

/**
 * Payroll workspace tabs. "Payroll" is the derived table; "Employee Rates" manages
 * effective-dated hourly rates. The Rates tab exists only for Owner / authorized
 * Admin — everyone else sees just the payroll table, no tab bar.
 */
export function PayrollTabs({
  payroll,
  payslips,
  from,
  to,
  isOwner,
  canManagePayroll,
  rates,
  canManageRates,
}: {
  payroll: PayrollResult;
  payslips: Record<string, PayslipSnapshot>;
  from: string;
  to: string;
  isOwner: boolean;
  canManagePayroll: boolean;
  rates: EmployeeRateRow[];
  canManageRates: boolean;
}) {
  const [tab, setTab] = useState<'payroll' | 'rates'>('payroll');

  const payrollView = (
    <AttendanceView
      payroll={payroll}
      payslips={payslips}
      from={from}
      to={to}
      isOwner={isOwner}
      canManagePayroll={canManagePayroll}
      showClock={false}
      showRecords={false}
    />
  );

  if (!canManageRates) return payrollView;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={tab === 'payroll' ? 'default' : 'outline'}
          aria-pressed={tab === 'payroll'}
          data-testid="payroll-tab-payroll"
          onClick={() => setTab('payroll')}
        >
          Payroll
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === 'rates' ? 'default' : 'outline'}
          aria-pressed={tab === 'rates'}
          data-testid="payroll-tab-rates"
          onClick={() => setTab('rates')}
        >
          Employee Rates
        </Button>
      </div>

      {tab === 'payroll' ? payrollView : <EmployeeRatesView rows={rates} canManage />}
    </div>
  );
}
