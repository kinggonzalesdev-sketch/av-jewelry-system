import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-primitives';

import { ClaimReviewView } from '@/components/claims/claim-review-view';
import { getGrantedPermissions } from '@/lib/authz/guard';
import { listClaimReviewQueue } from '@/lib/claims/review';

export const metadata: Metadata = {
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
    <div>
      <PageHeader
        title="Claim Review"
        description="Pending Claims awaiting confirmation. Confirming reserves stock exactly once."
      />

      <ClaimReviewView
        claims={claims}
        canConfirm={permissions.has('confirm_claim_print_label')}
      />
    </div>
  );
}
