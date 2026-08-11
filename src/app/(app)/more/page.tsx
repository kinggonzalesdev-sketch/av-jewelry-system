import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/states/placeholder-page';

export const metadata: Metadata = {};

/**
 * More navigation group placeholder.
 *
 * Secondary destinations — customers, inventory operations, the Owner Approval
 * Center, reports, and administration — are delivered across Roadmap Phases 7–9.
 */
export default function MorePage() {
  return (
    <PlaceholderPage
      title="More"
      description="Customers, inventory operations, approvals, reports, and administration."
      phase="Phases 7–9 — Approvals, Inventory Ops, Customers & Reporting"
    />
  );
}
