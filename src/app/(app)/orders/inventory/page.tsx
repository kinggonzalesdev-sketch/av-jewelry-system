import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';
import {
  canOpenPage,
  getCurrentStaffProfile,
  getGrantedPermissions,
} from '@/lib/authz/guard';
import { listInventoryActivePage } from '@/lib/inventory/service';

export const metadata: Metadata = {};

/**
 * Inventory Ops, Returned-to-Stock, Customers & Migration (Bible §19, §10).
 * Roadmap Phase 8.
 *
 * Real, database-backed. A sub-route of the Orders group, not a sixth bottom-nav
 * item: the approved navigation is exactly five items (§8.2) and is frozen.
 *
 * Availability is derived by the database on every read — never a stored counter
 * this page could show stale.
 */
// Always render fresh from Supabase (never a cached route) so every device sees
// the same official data on load. The page already reads auth cookies (dynamic);
// this makes the intent explicit and guards against future caching.
export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('nav_inventory'))) notFound();
  // Completed Items (900+ rows with order/customer/fulfillment joins) is NO LONGER loaded
  // here — that heavy read made opening Inventory slow even though the page lands on the
  // Active tab. The workspace lazy-loads it the first time the Completed Items tab is opened.
  const [initialPage, permissions, profile] = await Promise.all([
    listInventoryActivePage({ page: 1, size: 25 }),
    getGrantedPermissions(),
    getCurrentStaffProfile(),
  ]);
  // Bulk "Delete All" is the one irreversible, everything-at-once action, so it is
  // SUPER ADMIN (owner) only — an Admin or Staff never sees it (Owner request). The
  // same Owner-only rule guards the layaway ledger's Delete All.
  const isOwner = profile.roleKey === 'owner';
  // ALL valid Admins (and the Owner) may INITIATE an inventory Edit/Delete (Owner request
  // 2026-08-17). Role-based, not a per-user grant. An Admin's action becomes an approval
  // REQUEST; only a Super Admin (owner) executes it (directly or via /approvals).
  const canInitiate = isOwner || profile.roleKey === 'selected_admin';
  const canDeleteAll = isOwner;

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
      </header>

      <InventoryWorkspace
        initialPage={initialPage}
        canMonitor={permissions.has('inventory_monitoring')}
        // Each per-row action follows its OWN permission (the Owner holds all
        // implicitly); the server re-checks the same key on every write.
        canCreate={permissions.has('post_live_item_entry')}
        canEdit={canInitiate}
        canDelete={canInitiate}
        isOwner={isOwner}
        canDeleteAll={canDeleteAll}
        // SUPER ADMIN (owner) only — the per-row "Force delete" override for an
        // item held only by resolved records; the DB still protects real links.
        canForceDelete={canDeleteAll}
        // Per-row "return to inventory" on Completed Items is the Super Admin's
        // mistake-fix tool (removes order info, keeps the item; money-protected in
        // the DB); never shown to an Admin or Staff.
        canReturnCompleted={canDeleteAll}
        canImportExport={profile.roleKey === 'owner'}
      />
    </div>
  );
}
