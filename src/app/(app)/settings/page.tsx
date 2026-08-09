import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { SystemDiagnostics } from '@/components/settings/system-diagnostics';
import { TeamMembersPanel } from '@/components/settings/team-members-panel';
import { PageHeader } from '@/components/ui/page-primitives';
import { canOpenPage, isPrimarySuperAdmin, requireActiveStaff } from '@/lib/authz/guard';
import { listTeamMembers } from '@/lib/authz/team-accounts';

/** Mask a Supabase project ref (keeps the first 3 + last 4, hides the middle). */
function maskProject(url: string | undefined): string {
  const ref = (url ?? '').match(/https?:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1];
  if (!ref) return '—';
  return ref.length > 8 ? `${ref.slice(0, 3)}…${ref.slice(-4)}` : ref;
}

/** Compact top summary card (Settings redesign): icon, big number, label, supporting
 *  text. Presentation only. */
function SummaryCard({
  icon,
  value,
  label,
  hint,
}: {
  icon: string;
  value: number;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/10 text-lg text-gold-strong"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular-nums text-foreground">{value}</p>
        <p className="mt-1 text-sm font-medium text-foreground">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

/** A collapsed-by-default settings section (progressive disclosure). Native
 *  <details>, so it needs no client JS and stays keyboard-accessible; the chevron
 *  rotates on open. */
function SettingsSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-xl border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <span
          aria-hidden="true"
          className="text-muted-foreground transition-transform group-open:rotate-180"
        >
          ⌄
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

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
  const members = isOwner ? await listTeamMembers() : [];
  // Summary-card counts — all derived from the already-loaded roster.
  const tempPasswordCount = members.filter((m) => m.passwordIsTemp).length;
  const adminCount = members.filter((m) => m.roleKey === 'selected_admin').length;
  const superAdminCount = members.filter((m) => m.roleKey === 'owner').length;

  const diagnostics = isPrimary
    ? {
        env: process.env.VERCEL_ENV ?? 'development',
        commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'local',
        projectMasked: maskProject(process.env.NEXT_PUBLIC_SUPABASE_URL),
        accountId: staff.staffProfileId,
        business: 'A.V. Jewelry (single-tenant)',
      }
    : null;

  return (
    <div className="space-y-3">
      <PageHeader
        title="Settings"
        description="Manage portal access, teams, and system configuration."
      />

      {/* Top summary cards — 3 compact KPIs derived from the team roster. */}
      {isOwner ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard icon="👥" value={members.length} label="Team Members" hint="Active members" />
          <SummaryCard
            icon="🔑"
            value={tempPasswordCount}
            label="Temp Passwords"
            hint="Need attention"
          />
          <SummaryCard
            icon="🛡"
            value={adminCount}
            label="Admins"
            hint={`${superAdminCount} Super Admin${superAdminCount === 1 ? '' : 's'}`}
          />
        </div>
      ) : null}

      {/* Team Members — the primary visible section. */}
      {isOwner ? (
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="portal-h"
        >
          <h2 id="portal-h" className="text-sm font-semibold text-foreground">
            Team Members
          </h2>
          <TeamMembersPanel members={members} isPrimary={isPrimary} />
        </section>
      ) : null}

      {/* Collapsed-by-default sections (progressive disclosure). */}
      {diagnostics ? (
        <SettingsSection
          icon="⌁"
          title="System Diagnostics"
          subtitle="Environment, deployment, and sync status"
        >
          <SystemDiagnostics {...diagnostics} />
        </SettingsSection>
      ) : null}

      {isOwner ? (
        <SettingsSection
          icon="▶"
          title="Live Operations"
          subtitle="Run system checks and operational tools"
        >
          <Link
            href="/settings/live-operations"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
            data-testid="settings-live-operations"
          >
            <span aria-hidden="true" className="w-4 text-center text-xs">
              ✓
            </span>
            Run System Check
          </Link>
        </SettingsSection>
      ) : null}

      {isOwner ? (
        <SettingsSection
          icon="💬"
          title="Message Templates"
          subtitle="Manage system and notification templates"
        >
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
        </SettingsSection>
      ) : null}

      {/* Integration — renamed from "Administration" (Owner request). PRIMARY Super
          Admin only; /admin/integrations re-checks the rule itself. */}
      {isPrimary ? (
        <SettingsSection
          icon="⇄"
          title="Integration"
          subtitle="Data connections and system integrations"
        >
          <Link
            href="/admin/integrations"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
          >
            <span aria-hidden="true" className="w-4 text-center text-xs">
              ⇄
            </span>
            Integration (Pancake)
          </Link>
        </SettingsSection>
      ) : null}

    </div>
  );
}
