import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { IntegrationsView } from '@/components/integrations/integrations-view';
import { PageHeader } from '@/components/ui/page-primitives';
import { isPrimarySuperAdmin, requireActiveStaff } from '@/lib/authz/guard';
import { getPancakeLinkStatus, getSelectedPancakePage } from '@/lib/integrations/pancake';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';
// The Auto-link server action does a paced, multi-window Pancake fetch (429 backoff).
export const maxDuration = 60;

/**
 * Integrations (Bible §14.28) — Pancake Page management, reachable under
 * Settings → Administration. Primary Super Admin only.
 */
export default async function IntegrationsPage() {
  await requireActiveStaff();
  // PRIMARY Super Admin only (Owner request). Enforced HERE, not just by hiding the
  // Settings link, so typing the URL directly gets nothing either.
  if (!(await isPrimarySuperAdmin())) notFound();
  // Reaching this page already proves Primary Super Admin — Lalyn De Dios and any
  // Admin/Staff are stopped by the guard above, in both the UI and the backend.
  const [selectedPage, linkStatus] = await Promise.all([
    getSelectedPancakePage(),
    getPancakeLinkStatus(),
  ]);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Pancake / Facebook — load and select the Page this system posts as."
      />
      <IntegrationsView canManagePages selectedPage={selectedPage} linkStatus={linkStatus} />
    </div>
  );
}
