import type { Metadata } from 'next';

import { InvoiceWorkspace } from '@/components/invoicing/invoice-workspace';
import { getGrantedPermissions } from '@/lib/authz/guard';
import { computeEligibility, listInvoiceDrafts } from '@/lib/invoicing/drafts';

export const metadata: Metadata = {
  title: 'Invoice — A.V. Jewelry Operations',
};

/**
 * Invoice workspace (Bible §15, §22.8–22.9). Delivered by Roadmap Phase 5.
 *
 * Deliberately a SUB-ROUTE of the Orders group, not a sixth bottom-nav item:
 * the approved navigation is exactly five items (§8.2) and is frozen. Invoice
 * Draft and Official Orders belong to the Orders group per the screen map.
 *
 * Eligibility is recomputed from stored data on every render — the previous
 * page's opinion of what was eligible is never reused.
 */
export default async function InvoicePage() {
  const [drafts, eligibility, permissions] = await Promise.all([
    listInvoiceDrafts(),
    computeEligibility(),
    getGrantedPermissions(),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Invoice</h1>
        <p className="text-sm text-muted-foreground">
          Group Confirmed Claims into drafts, then approve to create one Official Order.
        </p>
      </header>

      <InvoiceWorkspace
        drafts={drafts}
        excluded={eligibility.excluded}
        canPrepare={permissions.has('invoice_preparation')}
      />
    </div>
  );
}
