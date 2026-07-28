import type { Metadata } from 'next';

import { CapabilitiesView } from '@/components/capabilities/capabilities-view';
import { requireActiveStaff } from '@/lib/authz/guard';
import { listCapabilities } from '@/lib/capabilities/service';

export const metadata: Metadata = {
};

/**
 * Conditional capabilities (Bible §27, §14, §13, §26). Roadmap Phase 10.
 *
 * ⚠️  NO INTEGRATION IS IMPLEMENTED OR VALIDATED. This screen is the GATE, not
 *     the integrations: it records what is switched off, why, and what evidence
 *     would be needed to switch it on.
 *
 * An admin surface, not part of the frozen operational UI. `isOwner` comes from
 * the verified session; the database refuses to enable anything without a
 * passing real-device validation regardless of what renders here.
 */
export default async function CapabilitiesPage() {
  const [staff, capabilities] = await Promise.all([
    requireActiveStaff(),
    listCapabilities(),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Conditional capabilities
        </h1>
        <p className="text-sm text-muted-foreground">
          Hardware and vendor integrations, and the evidence required to enable them.
        </p>
      </header>

      <CapabilitiesView capabilities={capabilities} isOwner={staff.roleKey === 'owner'} />
    </div>
  );
}
