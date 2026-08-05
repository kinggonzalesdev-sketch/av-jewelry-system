import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { SystemCheckPanel } from '@/components/live/system-check-panel';
import { TestModeControls } from '@/components/live/test-mode-controls';
import { PageHeader } from '@/components/ui/page-primitives';
import { canOpenPage, requireActiveStaff } from '@/lib/authz/guard';
import { getTestMode } from '@/lib/live/test-mode';

export const metadata: Metadata = {};

export const dynamic = 'force-dynamic';

/**
 * Settings → Live Operations. SUPER ADMIN only — the pre-live readiness surface.
 *
 * Phase 1 is the read-only "Run System Check": one sweep that proves the
 * connections a live depends on (database, Pancake, inventory, messaging, Real-time,
 * internet, Bluetooth) and reports each as Ready / Warning / Failed / Not Configured.
 * It touches no production data. Later phases (Test Mode, live sessions, print
 * queue, error-recovery centre) hang off this same page.
 */
export default async function LiveOperationsPage() {
  if (!(await canOpenPage('view_settings'))) notFound();
  const staff = await requireActiveStaff();
  // Super Admin = the owner role. Nobody else reaches the live-readiness controls.
  if (staff.roleKey !== 'owner') notFound();

  const testMode = await getTestMode();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Live Operations"
        description="Pre-live system check and live-session controls."
      />
      <Link
        href="/settings"
        className="inline-block text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        ← Back to Settings
      </Link>

      {/* Test Mode — Super Admin marks a private test session; a banner shows on
          every device while it is active. */}
      <section
        className="rounded-xl border border-border bg-card p-4"
        aria-labelledby="testmode-h"
      >
        <h2 id="testmode-h" className="mb-1 text-sm font-semibold text-foreground">
          Test Mode
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Start a test session before a private live so a persistent TEST MODE banner
          shows on every device. Only the Super Admin can change it.
        </p>
        <TestModeControls initial={testMode} />
      </section>

      <section
        className="rounded-xl border border-border bg-card p-4"
        aria-labelledby="syscheck-h"
      >
        <h2 id="syscheck-h" className="mb-1 text-sm font-semibold text-foreground">
          Pre-Live System Check
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Run one complete check before every live session. Resolve anything marked
          Failed before starting Automatic Mode.
        </p>
        <SystemCheckPanel />
      </section>
    </div>
  );
}
