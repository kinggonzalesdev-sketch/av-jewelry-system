import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { TeamMembersPanel } from '@/components/settings/team-members-panel';
import { PageHeader } from '@/components/ui/page-primitives';
import { canOpenPage, isPrimarySuperAdmin, requireActiveStaff } from '@/lib/authz/guard';
import { listTeamMembers } from '@/lib/authz/team-accounts';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Settings (Bible §8, §30).
 *
 *   - Portal & Access → Team Members (Owner-only): create team accounts and set
 *     passwords. This is the Owner's deliberate override of ADR §11 — the writes
 *     are Owner-gated and run through the service-role admin boundary.
 *   - Administration: the Integrations link (Pancake).
 *
 * The old read-only Profile card was removed (Owner request 2026-07-22); a
 * member's identity is shown in the shell, and the Owner manages accounts here.
 * The self-service "Change my password" card was also removed (Owner request
 * 2026-07-22) — the Owner sets passwords from the Team Members panel above.
 */
export default async function SettingsPage() {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('view_settings'))) notFound();
  const staff = await requireActiveStaff();
  const isOwner = staff.roleKey === 'owner';
  // Administration is reserved to the PRIMARY Super Admin — not every Super Admin.
  const isPrimary = await isPrimarySuperAdmin();
  // Deletion Requests is visible to Admins too: an Admin who asked for a deletion
  // must be able to see the answer. Only a Super Admin can DECIDE one.
  const isAdminOrAbove = isOwner || staff.roleKey === 'selected_admin';
  const members = isOwner ? await listTeamMembers() : [];

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" description="Portal & access and integrations." />

      {/* Portal & Access — Team Members (Owner-only). */}
      {isOwner ? (
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="portal-h"
        >
          <h2 id="portal-h" className="text-sm font-semibold text-foreground">
            Portal &amp; Access — Team Members
          </h2>
          <TeamMembersPanel members={members} isPrimary={isPrimary} />
        </section>
      ) : null}

      {/* Message Templates — SUPER ADMIN only. Admins may SEND the messages from
          Orders but never see or change the wording; the page enforces that itself. */}
      {isOwner ? (
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="messages-h"
        >
          <h2 id="messages-h" className="text-sm font-semibold text-foreground">
            Message Templates
          </h2>
          <Link
            href="/settings/messages"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
            data-testid="settings-message-templates"
          >
            <span aria-hidden="true" className="w-4 text-center text-xs">
              ✉
            </span>
            Edit Message Templates
          </Link>
        </section>
      ) : null}

      {/* Deletion Requests (§2) — the register of every requested and performed
          deletion. Admins see it to follow their own requests; the Approve /
          Reject controls, and the SQL behind them, are Super-Admin only. */}
      {isAdminOrAbove ? (
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="deletions-h"
        >
          <h2 id="deletions-h" className="text-sm font-semibold text-foreground">
            Administration
          </h2>
          <ul className="mt-2 space-y-1.5">
            <li>
              <Link
                href="/admin/deletions"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ⚠
                </span>
                Deletion Requests
              </Link>
            </li>
          </ul>
        </section>
      ) : null}

      {/* Administration — PRIMARY Super Admin only (Owner request). A second Super
          Admin does not see it; /admin/integrations enforces the same rule itself,
          so hiding the link is convenience, not the control. */}
      {isPrimary ? (
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="admin-h"
        >
          <h2 id="admin-h" className="text-sm font-semibold text-foreground">
            Administration
          </h2>
          <ul className="mt-2 space-y-1.5">
            <li>
              <Link
                href="/admin/integrations"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ⇄
                </span>
                Integration (Pancake)
              </Link>
            </li>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
