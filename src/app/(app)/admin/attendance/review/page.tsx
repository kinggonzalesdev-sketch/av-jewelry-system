import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewAttendanceView } from '@/components/hr/review-attendance-view';
import { canOpenPage } from '@/lib/authz/guard';
import { PageHeader } from '@/components/ui/page-primitives';
import { listAttendance } from '@/lib/hr/attendance';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Team Management → Review Attendance. A read-only review of ALL team attendance
 * with filters. Gated by the hr_review_attendance permission (assignable in Manage
 * Access; the Owner holds it implicitly). RLS scopes the data underneath:
 * listAttendance returns every row only because the attendance_read policy now
 * permits a holder of hr_review_attendance to read all — this page never bypasses that.
 */
export default async function ReviewAttendancePage() {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('hr_review_attendance'))) notFound();

  // Selfies are NO LONGER loaded here — minting a signed URL for EVERY selfie ever (~2
  // Storage round-trips per record across all history) was the page's main delay. The review
  // modal lazy-loads just the opened day's selfies via loadAttendanceSelfiesAction.
  const records = await listAttendance(500);

  return (
    <div>
      <PageHeader title="Review Attendance" />
      <ReviewAttendanceView records={records} />
    </div>
  );
}
