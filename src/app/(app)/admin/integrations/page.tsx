import type { Metadata } from 'next';

import { IntegrationsView } from '@/components/integrations/integrations-view';
import { PageHeader } from '@/components/ui/page-primitives';
import { requireActiveStaff } from '@/lib/authz/guard';
import { getPancakeStatus } from '@/lib/integrations/pancake';

export const metadata: Metadata = {
  title: 'Integrations — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

/**
 * Integrations (Bible §14.28) — honest connection status for Pancake/Facebook and
 * the Bluetooth printer. Neither is faked as connected. Reachable under
 * Settings → Administration.
 */
export default async function IntegrationsPage() {
  const [staff, pancake] = await Promise.all([requireActiveStaff(), getPancakeStatus()]);

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="Pancake / Facebook and the Bluetooth printer — honest connection status, never a faked one."
      />
      <IntegrationsView pancake={pancake} canTest={staff.roleKey === 'owner'} />
    </div>
  );
}
