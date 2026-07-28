import type { Metadata } from 'next';
import Link from 'next/link';

import { SupplierCodesPanel } from '@/components/settings/supplier-codes-panel';
import { TeamMembersPanel } from '@/components/settings/team-members-panel';
import { PageHeader } from '@/components/ui/page-primitives';
import { requireActiveStaff } from '@/lib/authz/guard';
import { listTeamMembers } from '@/lib/authz/team-accounts';
import { listSupplierCodes } from '@/lib/inventory/suppliers';

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
  const staff = await requireActiveStaff();
  const isOwner = staff.roleKey === 'owner';
  const canManageSuppliers = isOwner || staff.roleKey === 'selected_admin';
  const [members, supplierCodes] = await Promise.all([
    isOwner ? listTeamMembers() : Promise.resolve([]),
    canManageSuppliers ? listSupplierCodes() : Promise.resolve([]),
  ]);

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
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
            Add team members and set a temporary password. Owner-only.
          </p>
          <TeamMembersPanel members={members} />
        </section>
      ) : null}

      {/* Supplier Codes — configurable supplier-initial → name mapping (Owner/Admin). */}
      {canManageSuppliers ? (
        <section
          className="rounded-xl border border-border bg-card p-4"
          aria-labelledby="supplier-h"
        >
          <h2 id="supplier-h" className="text-sm font-semibold text-foreground">
            Inventory — Supplier Codes
          </h2>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">
            Map the supplier initial in an inventory code (e.g. the{' '}
            <span className="font-mono">A</span> in{' '}
            <span className="font-mono">SBA-N-2683</span>) to a supplier name.
          </p>
          <SupplierCodesPanel codes={supplierCodes} />
        </section>
      ) : null}

      {/* Administration — links to existing admin routes. */}
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
    </div>
  );
}
