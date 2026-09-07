import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import { canOpenPage, requireActiveStaff } from '@/lib/authz/guard';
import { PageHeader } from '@/components/ui/page-primitives';
import { listAttendancePage, listClockStaff } from '@/lib/hr/attendance';
import { DEFAULT_ATTENDANCE_PAGE_SIZE, quickRange } from '@/lib/hr/attendance-paging';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Team Management → Review Attendance. A review WORKSPACE (Owner 2026-09-07): server-paginated,
 * defaulting to the last 7 days at 25/page, so it no longer renders the whole history in one
 * long table. Gated by hr_review_attendance (assignable in Manage Access; the Owner holds it
 * implicitly). RLS scopes the data underneath — a holder of hr_review_attendance reads all
 * records; this page never bypasses that. Selfies are lazy-loaded per opened day.
 */
export default async function ReviewAttendancePage() {
  if (!(await canOpenPage('hr_review_attendance'))) notFound();
  const staff = await requireActiveStaff();

  const { from, to } = quickRange('7d');
  const [initialPage, roster] = await Promise.all([
    listAttendancePage(
      { from, to, staffIds: null, status: 'all' },
      1,
      DEFAULT_ATTENDANCE_PAGE_SIZE,
    ),
    listClockStaff(),
  ]);

  // Owner or Selected Admin may correct/delete a record from Details.
  const canManage = staff.roleKey === 'owner' || staff.roleKey === 'selected_admin';

  return (
    <div>
      <PageHeader
        title="Review Attendance"
        description="Review and inspect attendance records."
      />
      <ReviewAttendanceView
        initialPage={initialPage}
        roster={roster}
        canManage={canManage}
      />
    </div>
  );
}
