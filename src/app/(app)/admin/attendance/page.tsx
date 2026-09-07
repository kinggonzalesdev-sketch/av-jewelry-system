import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttendanceClock } from '@/components/hr/attendance-clock';
import { AttendanceRecords } from '@/components/hr/attendance-records';
import { AttendanceSummaryCards } from '@/components/hr/attendance-summary-cards';
import { DeviceManager } from '@/components/hr/device-manager';
import { Card, CardContent } from '@/components/ui/card';
import { canOpenPage, requireActiveStaff } from '@/lib/authz/guard';
import { PageHeader } from '@/components/ui/page-primitives';
import {
  listAttendancePage,
  listClockStaff,
  listLastClockOutToday,
  listOpenSessions,
  listTodaySessionStaff,
} from '@/lib/hr/attendance';
import {
  DEFAULT_ATTENDANCE_PAGE_SIZE,
  quickRange,
  summarizeAttendanceToday,
} from '@/lib/hr/attendance-paging';
import {
  isAttendanceGatingActive,
  isThisDeviceApproved,
  listDevices,
} from '@/lib/hr/devices';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Team Management → Attendance (Bible §F). Clock in/out is self-service for any active staff
 * member; records are RLS-scoped (own; Owner / a review-permission holder sees all).
 *
 * Refined 2026-09-06 (Owner): a compact device banner, a clear "Attendance today" action card,
 * team summary cards for reviewers, and a filtered + SERVER-PAGINATED records list defaulting
 * to the last 7 days — so the page no longer loads the whole history on every render. Clock,
 * device, session and payroll logic are all unchanged.
 */
export default async function AttendancePage() {
  if (!(await canOpenPage('hr_attendance'))) notFound();
  const staff = await requireActiveStaff();
  const isOwner = staff.roleKey === 'owner';

  // A reviewer (Owner or an hr_review_attendance holder) may see team-wide data — the same
  // people RLS lets read every member's records. Everyone else sees only their own.
  const canSeeTeam = isOwner || (await canOpenPage('hr_review_attendance'));

  const initialFilters = {
    ...quickRange('7d'),
    staffIds: null,
    status: 'all' as const,
  };

  const [
    initialPage,
    openSessions,
    lastOutToday,
    clockStaff,
    todaySessionStaff,
    gatingActive,
    thisApproved,
  ] = await Promise.all([
    listAttendancePage(
      { from: initialFilters.from, to: initialFilters.to, staffIds: null, status: 'all' },
      1,
      DEFAULT_ATTENDANCE_PAGE_SIZE,
    ),
    listOpenSessions(),
    listLastClockOutToday(),
    listClockStaff(),
    canSeeTeam ? listTodaySessionStaff() : Promise.resolve([]),
    isAttendanceGatingActive(),
    isThisDeviceApproved(),
  ]);

  const canManage = isOwner || staff.roleKey === 'selected_admin';
  const devices = isOwner ? await listDevices() : [];
  const blockedHere = gatingActive && !thisApproved;
  const summary = summarizeAttendanceToday(todaySessionStaff, openSessions);

  return (
    <div>
      <PageHeader
        title="Attendance"
        description="Clock in and out. You see your own records; the Owner sees all."
      />
      <div className="space-y-4">
        {blockedHere ? (
          <div
            className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
            role="alert"
            data-testid="device-blocked"
          >
            <p className="font-semibold text-destructive">
              This device cannot clock in/out
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              It is not the approved shop phone. Use the registered device, or ask the
              Owner to register this one below.
            </p>
          </div>
        ) : null}

        {isOwner ? <DeviceManager devices={devices} thisApproved={thisApproved} /> : null}

        {/* Attendance today — pick who is signing in, then Clock In / Out / Continue Duty. */}
        <Card>
          <CardContent className="pt-4">
            <p className="mb-1 text-sm font-semibold text-foreground">Attendance today</p>
            <AttendanceClock
              staff={clockStaff}
              openSessions={openSessions}
              lastOutToday={lastOutToday}
            />
          </CardContent>
        </Card>

        {canSeeTeam ? <AttendanceSummaryCards summary={summary} /> : null}

        <AttendanceRecords
          initialPage={initialPage}
          roster={clockStaff}
          canManage={canManage}
          isOwner={isOwner}
          canFilterStaff={canSeeTeam}
          defaultRange="7d"
        />
      </div>
    </div>
  );
}
