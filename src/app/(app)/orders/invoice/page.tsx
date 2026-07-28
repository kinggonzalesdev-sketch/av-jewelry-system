import type { Metadata } from 'next';

import { InvoiceWorkspace } from '@/components/invoicing/invoice-workspace';
import { getGrantedPermissions } from '@/lib/authz/guard';
import { listInvoiceDrafts } from '@/lib/invoicing/drafts';
import { PageHeader } from '@/components/ui/page-primitives';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Invoice preparation — a STANDALONE page again (Owner request 2026-07-23:
 * remove the panel folded into Orders → For Invoice). Group Confirmed Claims into
 * drafts, review, then Approve & Send to create the Official Order. No invoice
 * logic, data, or DB functions changed — only the location: it is here, not on
 * the Orders list.
 */
export default async function InvoicePage() {
  const [drafts, permissions] = await Promise.all([
    listInvoiceDrafts(),
    getGrantedPermissions(),
  ]);

  return (
    <div>
      <PageHeader
        title="Invoice preparation"
        description="Group Confirmed Claims into drafts, review, then Approve & Send to create the Official Order."
      />
      <InvoiceWorkspace
        drafts={drafts}
        canPrepare={permissions.has('invoice_preparation')}
      />
    </div>
  );
}
