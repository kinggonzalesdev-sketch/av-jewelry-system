import type { Metadata } from 'next';

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';
import { getGrantedPermissions } from '@/lib/authz/guard';
import {
  listDuplicateReferences,
  listInventory,
  listMigrationBatches,
  listRtsReviews,
} from '@/lib/inventory/service';

export const metadata: Metadata = {
  title: 'Inventory — A.V. Jewelry Operations',
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
  const [inventory, reviews, duplicates, batches, permissions] = await Promise.all([
    listInventory(),
    listRtsReviews(),
    listDuplicateReferences(),
    listMigrationBatches(),
    getGrantedPermissions(),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Inventory monitoring, Returned-to-Stock Review, duplicate review, and migration.
        </p>
      </header>

      <InventoryWorkspace
        inventory={inventory}
        reviews={reviews}
        duplicates={duplicates}
        batches={batches}
        canMonitor={permissions.has('inventory_monitoring')}
        canReview={permissions.has('claim_review')}
        canMigrate={permissions.has('existing_record_entry')}
      />
    </div>
  );
}
