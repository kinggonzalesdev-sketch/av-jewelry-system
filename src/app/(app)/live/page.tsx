import type { Metadata } from 'next';

import { LiveBatchesView } from '@/components/live/live-batches-view';
import { getGrantedPermissions } from '@/lib/authz/guard';
import { listLiveBatches } from '@/lib/live/batches';

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
  const [batches, permissions] = await Promise.all([
    listLiveBatches(),
    getGrantedPermissions(),
  ]);

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
        canOperate={permissions.has('live_batch_operation')}
        canClose={permissions.has('live_batch_closure')}
      />
    </div>
  );
}
