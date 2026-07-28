import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import { requireActiveStaff } from '@/lib/authz/guard';
import { PageHeader } from '@/components/ui/page-primitives';
import { listAttendance, listAttendanceSelfies } from '@/lib/hr/attendance';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Team Management → Review Attendance (Owner/Admin). A read-only review of ALL
 * team attendance with filters. Access is Owner-only for now (Admin correction
 * rights come with the Phase-2 permission + schema work). RLS still scopes the
 * data underneath: listAttendance returns every row only because the Owner's
 * policy permits it — this page never bypasses that.
 */
export default async function ReviewAttendancePage() {
  const staff = await requireActiveStaff();
  if (staff.roleKey !== 'owner') {
    // Non-Owners have no all-records review yet; send them to their own attendance.
    redirect('/admin/attendance');
  }

  const [records, selfies] = await Promise.all([
    listAttendance(500),
    listAttendanceSelfies(),
  ]);

  return (
    <div>
      <PageHeader
        title="Review Attendance"
        description="All team attendance — filter by employee, date, and status."
      />
      <ReviewAttendanceView records={records} selfies={selfies} />
    </div>
  );
}
