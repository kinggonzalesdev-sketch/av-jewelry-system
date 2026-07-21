import type { Metadata } from 'next';

import { AttendanceView } from '@/components/hr/attendance-view';
import { PageHeader } from '@/components/ui/page-primitives';
import { getOpenSession, listAttendance } from '@/lib/hr/attendance';
import { getPayroll } from '@/lib/hr/payroll';

export const metadata: Metadata = {
  title: 'Attendance & Payroll — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

function firstOfMonth(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Attendance & Payroll (Bible §F). Clock in/out is self-service for any active
 * staff member; the records and payroll are RLS-scoped — a staff member sees
 * only their own, the Owner sees everyone. Not a primary nav item: reachable
 * under Settings → Administration.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const from = typeof params.from === 'string' ? params.from : firstOfMonth();
  const to = typeof params.to === 'string' ? params.to : today();

  const [openSession, records, payroll] = await Promise.all([
    getOpenSession(),
    listAttendance(),
    getPayroll(from, to),
  ]);

  return (
    <div>
      <PageHeader
        title="Attendance & Payroll"
        description="Digital attendance and payroll — replacing the biometric. You see your own records; the Owner sees all."
      />
      <AttendanceView
        openSession={openSession}
        records={records}
        payroll={payroll}
        from={from}
        to={to}
      />
    </div>
  );
}
