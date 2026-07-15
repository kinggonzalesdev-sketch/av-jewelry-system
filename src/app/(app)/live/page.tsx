import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/states/placeholder-page';

export const metadata: Metadata = {
  title: 'Live — A.V. Jewelry Operations',
};

/**
 * Live navigation group placeholder (Bible §8.4).
 *
 * Live Batches, Live Batch Detail, Quick Add Item, and Current Flex Item are
 * delivered in Roadmap Phase 3. None of that exists here.
 */
export default function LivePage() {
  return (
    <PlaceholderPage
      title="Live"
      description="Live selling batches and item entry."
      phase="Phase 3 — Live Selling & Claim Intake"
    />
  );
}
