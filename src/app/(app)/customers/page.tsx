import type { Metadata } from 'next';

import { UnavailablePage } from '@/components/shell/unavailable';

export const metadata: Metadata = {
  title: 'Customers — A.V. Jewelry Operations',
};

/**
 * Approved nav item with no production screen yet. Renders an honest
 * "not available yet" state — never sample customers, never a 404.
 */
export default function CustomersPage() {
  return <UnavailablePage title="Customers" />;
}
