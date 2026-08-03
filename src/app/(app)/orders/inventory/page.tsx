import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';
import { canOpenPage, getCurrentStaffProfile, getGrantedPermissions } from '@/lib/authz/guard';
import { listCompletedInventory } from '@/lib/inventory/completed';
import { listInventory } from '@/lib/inventory/service';

export const metadata: Metadata = {
};

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
  const [inventory, completed, permissions, profile] = await Promise.all([
    listInventory(),
    listCompletedInventory(),
    getGrantedPermissions(),
    getCurrentStaffProfile(),
  ]);
  const canDeleteAll = profile.roleKey === 'owner' || profile.roleKey === 'selected_admin';

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
      </header>

      <InventoryWorkspace
        inventory={inventory}
        completed={completed}
        canMonitor={permissions.has('inventory_monitoring')}
        canDeleteAll={canDeleteAll}
        canImportExport={profile.roleKey === 'owner'}
      />
    </div>
  );
}
