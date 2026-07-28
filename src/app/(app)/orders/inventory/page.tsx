import type { Metadata } from 'next';

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';
import { getCurrentStaffProfile, getGrantedPermissions } from '@/lib/authz/guard';
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
export default async function InventoryPage() {
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
      />
    </div>
  );
}
