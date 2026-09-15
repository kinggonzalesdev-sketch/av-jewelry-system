import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-primitives';

import { ClaimReviewView } from '@/components/claims/claim-review-view';
import { notFound } from 'next/navigation';

import { getGrantedPermissions } from '@/lib/authz/guard';
import { listClaimReviewQueue } from '@/lib/claims/review';

export const metadata: Metadata = {};

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
  // Page gate (system audit 2026-09-16): the review queue is for members in the claim flow.
  // RLS already scopes the rows; this keeps the page itself out of reach by URL.
  const permissions = await getGrantedPermissions();
  if (
    !['claim_capture', 'claim_review', 'confirm_claim_print_label'].some((k) =>
      permissions.has(k as never),
    )
  ) {
    notFound();
  }
  const claims = await listClaimReviewQueue();

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
