import type { Metadata } from 'next';

import { ClaimReviewView } from '@/components/claims/claim-review-view';
import { getGrantedPermissions } from '@/lib/authz/guard';
import { listClaimReviewQueue } from '@/lib/claims/review';

export const metadata: Metadata = {
  title: 'Claims — A.V. Jewelry Operations',
};

/**
 * Claim Review (Bible §6.4, §22.6). Delivered by Roadmap Phase 4.
 *
 * Real, database-backed — no longer a placeholder. Claim Review is mandatory:
 * a Pending Claim becomes a Confirmed Claim only through a human decision here.
 *
 * Inventory is reserved EXACTLY ONCE, at Confirm Claim & Print Label, inside a
 * single atomic transaction. The permission flag decides what renders and
 * nothing more — every action re-checks server-side (ADR §7, Bible §29.8).
 */
export default async function ClaimsPage() {
  const [claims, permissions] = await Promise.all([
    listClaimReviewQueue(),
    getGrantedPermissions(),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Claim Review</h1>
        <p className="text-sm text-muted-foreground">
          Pending Claims awaiting confirmation. Confirming reserves stock exactly once.
        </p>
      </header>

      <ClaimReviewView
        claims={claims}
        canConfirm={permissions.has('confirm_claim_print_label')}
      />
    </div>
  );
}
