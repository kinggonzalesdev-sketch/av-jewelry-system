import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/states/placeholder-page';

export const metadata: Metadata = {
  title: 'Claims — A.V. Jewelry Operations',
};

/**
 * Claims navigation group placeholder.
 *
 * Pending Claims and Claim Review are delivered in Roadmap Phases 3–4.
 * Inventory reservation happens exactly once at Confirmed Claim (Invariant #5) —
 * that logic belongs to Phase 4 and is deliberately absent here.
 */
export default function ClaimsPage() {
  return (
    <PlaceholderPage
      title="Claims"
      description="Claim intake, review, and confirmation."
      phase="Phases 3–4 — Claim Intake, Review, Confirmation & Reservation"
    />
  );
}
