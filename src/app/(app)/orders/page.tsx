import type { Metadata } from 'next';

import { PlaceholderPage } from '@/components/states/placeholder-page';

export const metadata: Metadata = {
  title: 'Orders — A.V. Jewelry Operations',
};

/**
 * Orders navigation group placeholder.
 *
 * Invoice Draft, Official Orders, payment, layaway, and fulfillment are delivered
 * in Roadmap Phases 5–7.
 */
export default function OrdersPage() {
  return (
    <PlaceholderPage
      title="Orders"
      description="Invoicing, official orders, payment, and fulfillment."
      phase="Phases 5–7 — Invoicing, Payment & Fulfillment"
    />
  );
}
