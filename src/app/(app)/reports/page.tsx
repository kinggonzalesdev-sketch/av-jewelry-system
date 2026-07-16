import type { Metadata } from 'next';

import { UnavailablePage } from '@/components/shell/unavailable';

export const metadata: Metadata = {
  title: 'Reports — A.V. Jewelry Operations',
};

/**
 * Approved nav item with no dedicated production screen yet (reporting currently
 * lives under the Dashboard). Renders an honest "not available yet" state —
 * never fabricated charts or totals.
 */
export default function ReportsPage() {
  return <UnavailablePage title="Reports" />;
}
