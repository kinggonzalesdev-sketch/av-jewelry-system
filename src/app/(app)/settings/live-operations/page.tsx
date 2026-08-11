import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { SystemCheckPanel } from '@/components/live/system-check-panel';
import { PrinterTestCard } from '@/components/print/printer-test-card';
import { StickerSettingsCard } from '@/components/print/sticker-settings-card';
import { TestModeControls } from '@/components/live/test-mode-controls';
import { ErrorRecoveryPanel } from '@/components/live/error-recovery-panel';
import { RecentActivityPanel } from '@/components/live/recent-activity-panel';
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
          Run one complete check before every live session. Resolve anything marked Failed
          before starting Automatic Mode.
        </p>
        <SystemCheckPanel />
      </section>

      {/* Test Print — print a REAL sample sticker to confirm the XP-236B prints the
          live's exact layout before going live (the biggest hardware unknown). */}
      <section
        className="rounded-xl border border-border bg-card p-4"
        aria-labelledby="testprint-h"
      >
        <h2 id="testprint-h" className="mb-1 text-sm font-semibold text-foreground">
          Test Print
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Print one sample sticker in the exact live format to confirm the printer works
          before the live. Connect the printer here (same connection every print uses),
          then Print sample sticker — or use the browser dialog if Bluetooth isn’t
          reachable.
        </p>
        <PrinterTestCard />
      </section>

      {/* Sticker Settings — choose which lines print on the 40x30 label, with a live
          preview. Applies to New Order, Test Print, and the auto-print. */}
      <section
        className="rounded-xl border border-border bg-card p-4"
        aria-labelledby="stickerfields-h"
      >
        <h2 id="stickerfields-h" className="mb-1 text-sm font-semibold text-foreground">
          Sticker Settings
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Pick which lines appear on the sticker and see a live preview. Saved on this
          device; every print uses these fields.
        </p>
        <StickerSettingsCard />
      </section>

      {/* Error Recovery Center — the failures a live can hit (a message that failed
          to auto-send, a label that failed to print), surfaced in one place with a
          one-click Retry for the sends. */}
      <section
        className="rounded-xl border border-border bg-card p-4"
        aria-labelledby="errrecovery-h"
      >
        <h2 id="errrecovery-h" className="mb-1 text-sm font-semibold text-foreground">
          Error Recovery Center
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Any invoice/reminder that failed to send or label that failed to print shows
          here. Retry a failed send in one click; reprint a failed label from the order on
          the capturing device.
        </p>
        <ErrorRecoveryPanel />
      </section>

      {/* Recent Activity — a read-only window on the audit trail so the Super Admin
          can watch what is happening during a live and spot anything unexpected. */}
      <section
        className="rounded-xl border border-border bg-card p-4"
        aria-labelledby="activity-h"
      >
        <h2 id="activity-h" className="mb-1 text-sm font-semibold text-foreground">
          Recent Activity
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          The latest recorded actions — who did what, on what, and the outcome. Refresh
          during a live to watch it update.
        </p>
        <RecentActivityPanel />
      </section>
    </div>
  );
}
