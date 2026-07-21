import type { Metadata } from 'next';
import Link from 'next/link';

import { PrinterStatusRow } from '@/components/shell/printer-status';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { PageHeader } from '@/components/ui/page-primitives';
import {
  getCurrentStaffProfile,
  requireActiveStaff,
  requireUser,
} from '@/lib/authz/guard';

export const metadata: Metadata = {
  title: 'Settings — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  selected_admin: 'Selected Admin',
  staff: 'Staff',
};

/**
 * Settings (Bible §8, §30) — a unified home for functionality that ALREADY
 * exists, nothing invented to fill the screen.
 *
 *   - Profile: the real authenticated identity (read-only).
 *   - Administration: links to the real admin routes — Staff (Owner-only),
 *     Capabilities, Security, and the Audit trail. Hiding the Staff link from
 *     non-Owners is a convenience; each page and RLS re-check (Bible §30.3 r2).
 *   - Device & display: the honest Bluetooth/printer status and the manual
 *     Light/Dark toggle — the same real controls the shell already exposes.
 */
export default async function SettingsPage() {
  const [staff, profile, user] = await Promise.all([
    requireActiveStaff(),
    getCurrentStaffProfile(),
    requireUser(),
  ]);
  const isOwner = staff.roleKey === 'owner';
  const roleLabel = ROLE_LABEL[profile.roleKey] ?? profile.roleKey;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Profile, administration, and device controls — existing functionality in one place."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile — real identity, read-only. */}
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="profile-h"
        >
          <h2 id="profile-h" className="text-sm font-semibold text-foreground">
            Profile
          </h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium" data-testid="settings-full-name">
                {profile.fullName}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="font-medium">{roleLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium">{user.email ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Read-only. Accounts are managed by the Owner or an authorized administrator
            (Bible §5.3, §30.5).
          </p>
        </section>

        {/* Administration — links to existing admin routes. */}
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="admin-h"
        >
          <h2 id="admin-h" className="text-sm font-semibold text-foreground">
            Administration
          </h2>
          <ul className="mt-2 space-y-1.5">
            {isOwner ? (
              <li>
                <Link
                  href="/admin/staff"
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
                >
                  <span aria-hidden="true" className="w-4 text-center text-xs">
                    ◆
                  </span>
                  Staff Management
                </Link>
              </li>
            ) : null}
            <li>
              <Link
                href="/admin/capabilities"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ⚙
                </span>
                Capabilities
              </Link>
            </li>
            <li>
              <Link
                href="/admin/attendance"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ⏱
                </span>
                Attendance &amp; Payroll
              </Link>
            </li>
            <li>
              <Link
                href="/admin/scrap"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ♻
                </span>
                Scrap Income
              </Link>
            </li>
            <li>
              <Link
                href="/admin/integrations"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ⇄
                </span>
                Integrations (Pancake, printer)
              </Link>
            </li>
            <li>
              <Link
                href="/security"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ⛨
                </span>
                Security
              </Link>
            </li>
            <li>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ▤
                </span>
                Audit trail (Dashboard → Audit)
              </Link>
            </li>
          </ul>
        </section>

        {/* Device & display — the same honest controls the shell exposes. */}
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="device-h"
        >
          <h2 id="device-h" className="text-sm font-semibold text-foreground">
            Device &amp; display
          </h2>
          <div className="mt-2 space-y-2">
            <PrinterStatusRow />
            <ThemeToggle />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            The printer stays gated off until a real device passes validation at
            Capabilities. The theme choice is saved on this device.
          </p>
        </section>
      </div>
    </div>
  );
}
