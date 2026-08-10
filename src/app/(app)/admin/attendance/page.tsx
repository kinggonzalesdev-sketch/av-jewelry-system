import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AttendanceView } from '@/components/hr/attendance-view';
import { DeviceManager } from '@/components/hr/device-manager';
import { canOpenPage, requireActiveStaff } from '@/lib/authz/guard';
import { PageHeader } from '@/components/ui/page-primitives';
import {
  listAttendance,
  listClockStaff,
  listLastClockOutToday,
  listOpenSessions,
} from '@/lib/hr/attendance';
import {
  isAttendanceGatingActive,
  isThisDeviceApproved,
  listDevices,
} from '@/lib/hr/devices';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Team Management → Attendance (Bible §F). Clock in/out is self-service for any
 * active staff member; records are RLS-scoped (own; Owner sees all). Payroll moved
 * to /admin/payroll; the all-records review is at /admin/attendance/review. Route
 * unchanged so existing links keep working.
 *
 * Device gate (Phase 2a): once the Owner registers a shop phone, only that device
 * may clock in/out — enforced server-side, logged when blocked. Before that, it is
 * a no-op (nobody is locked out).
 */
export default async function AttendancePage() {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('hr_attendance'))) notFound();
  const staff = await requireActiveStaff();
  const isOwner = staff.roleKey === 'owner';

  const [records, openSessions, lastOutToday, clockStaff, gatingActive, thisApproved] =
    await Promise.all([
      listAttendance(),
      listOpenSessions(),
      listLastClockOutToday(),
      // The kiosk roster is available to ANY hr_attendance holder (Owner request):
      // reaching this page already requires that permission, so a granted staff/admin
      // can operate the clock, not just the Owner. Returns active staff name + role.
      listClockStaff(),
      isAttendanceGatingActive(),
      isThisDeviceApproved(),
    ]);

  // Owner or Selected Admin may permanently delete an attendance record.
  const canManage = isOwner || staff.roleKey === 'selected_admin';
  const devices = isOwner ? await listDevices() : [];
  const blockedHere = gatingActive && !thisApproved;

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

        <AttendanceView
          records={records}
          payroll={{ ok: true, rows: [] }}
          from=""
          to=""
          isOwner={isOwner}
          clockStaff={clockStaff}
          openSessions={openSessions}
          lastOutToday={lastOutToday}
          // Everyone who can open this page holds hr_attendance, so the clock is
          // shown to all of them — a granted staff/admin can sign the team in/out on
          // the approved shop phone, not just the Owner.
          showClock
          showPayroll={false}
          canManage={canManage}
        />
      </div>
    </div>
  );
}
