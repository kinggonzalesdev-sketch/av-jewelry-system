import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PayrollTabs } from '@/components/hr/payroll-tabs';
import { canOpenPage, requireActiveStaff } from '@/lib/authz/guard';
import { PageHeader } from '@/components/ui/page-primitives';
import { getPayroll } from '@/lib/hr/payroll';
import { listPayslipsForPeriod } from '@/lib/hr/payslip';
import { listEmployeeRates, type EmployeeRateRow } from '@/lib/hr/rate';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Team Management → Payroll (Bible §F). Split out of the old combined Attendance
 * & Payroll page — same derived figures (report_payroll: hours, overtime, rate,
 * computed salary), same RLS (a member sees only their own; the Owner sees all
 * and may set rates). Nothing about the payroll logic changed; only the page it
 * lives on. The Owner-only inline rate editor is reused unchanged.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('hr_payroll'))) notFound();
  const params = await searchParams;
  const from = typeof params.from === 'string' ? params.from : firstOfMonth();
  const to = typeof params.to === 'string' ? params.to : today();

  const [staff, payroll, payslips] = await Promise.all([
    requireActiveStaff(),
    getPayroll(from, to),
    listPayslipsForPeriod(from, to),
  ]);
  const isOwner = staff.roleKey === 'owner';
  // Owner or Selected Admin manage payroll (mark paid) + the Employee Rates tab.
  const canManagePayroll = isOwner || staff.roleKey === 'selected_admin';
  const rates: EmployeeRateRow[] = canManagePayroll ? await listEmployeeRates() : [];

  return (
    <div>
      <PageHeader title="Payroll" />
      <PayrollTabs
        payroll={payroll}
        payslips={payslips}
        from={from}
        to={to}
        isOwner={isOwner}
        canManagePayroll={canManagePayroll}
        rates={rates}
        canManageRates={canManagePayroll}
      />
    </div>
  );
}
