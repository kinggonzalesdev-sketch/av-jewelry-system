import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import { canOpenPage, requireActiveStaff } from '@/lib/authz/guard';
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
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('hr_review_attendance'))) notFound();
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
      />
      <ReviewAttendanceView records={records} selfies={selfies} />
    </div>
  );
}
