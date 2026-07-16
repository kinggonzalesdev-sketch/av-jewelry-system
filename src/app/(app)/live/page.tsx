import type { Metadata } from 'next';

import { LiveBatchesView } from '@/components/live/live-batches-view';
import { getGrantedPermissions } from '@/lib/authz/guard';
import {
  listCaptureCustomers,
  listLiveBatchItems,
  listLiveBatches,
  type LiveBatchItemRow,
} from '@/lib/live/batches';

export const metadata: Metadata = {
  title: 'Live — A.V. Jewelry Operations',
};

/**
 * Live Batches (Bible §8.4, §12). Delivered by Roadmap Phase 3.
 *
 * Real, database-backed — this is no longer a placeholder. RLS narrows the batch
 * list to the caller's scope, so this page does not re-implement that filter; it
 * relies on it.
 *
 * The permission flags decide what RENDERS. They are not the security control:
 * every action re-checks permission and state server-side at execution time
 * (ADR §7, Bible §29.8).
 */
export default async function LivePage() {
  const [batches, customers, permissions] = await Promise.all([
    listLiveBatches(),
    listCaptureCustomers(),
    getGrantedPermissions(),
  ]);

  // Items are loaded for the batches that can still be captured against — a
  // closed batch cannot take a claim, so it needs no item list.
  const openBatches = batches.filter((b) => b.status !== 'closed');
  const itemLists = await Promise.all(
    openBatches.map((b) =>
      listLiveBatchItems(b.id).then((items) => [b.id, items] as const),
    ),
  );
  const batchItems: Record<string, LiveBatchItemRow[]> = Object.fromEntries(itemLists);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Live</h1>
        <p className="text-sm text-muted-foreground">
          Live selling batches and item entry.
        </p>
      </header>

      <LiveBatchesView
        batches={batches}
        batchItems={batchItems}
        customers={customers}
        canOperate={permissions.has('live_batch_operation')}
        canClose={permissions.has('live_batch_closure')}
        canControlFlex={permissions.has('current_flex_item_control')}
        canCapture={permissions.has('claim_capture')}
      />
    </div>
  );
}
