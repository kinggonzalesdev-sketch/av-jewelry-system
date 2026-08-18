'use client';

import { useRouter } from 'next/navigation';

import { useDashboardSync } from '@/components/shell/dashboard-sync';
import {
  captureAppLabel,
  printerStatusLabel,
  type CaptureDeviceStatus,
} from '@/lib/live/capture-device-format';

/**
 * System Diagnostics (Super Admin only). COLLAPSED by default to a single summary line
 * (`<env> · Synced · Commit <commit>`); expanding shows the deployment/sync facts plus the
 * capture device's last-seen, app version/build commit, and printer state. Raw internal
 * identifiers (masked Supabase project, signed-in account UUID) are tucked into a nested
 * "Advanced technical detail" section, out of the normal summary. Shows NO secrets.
 *
 * Cross-device mismatches are almost always two devices on DIFFERENT deployments — compare the
 * Commit value across devices here.
 */
export function SystemDiagnostics({
  env,
  commit,
  projectMasked,
  accountId,
  business,
  device = null,
}: {
  env: string;
  commit: string;
  projectMasked: string;
  accountId: string;
  business: string;
  device?: CaptureDeviceStatus | null;
}) {
  const router = useRouter();
  const { lastSyncedAt, isSyncing, refresh } = useDashboardSync();

  const fmt = (iso: string | null): string =>
    iso
      ? new Date(iso).toLocaleString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '—';

  const lastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'not yet this session';

  const envLabel = env === 'production' ? 'Production' : env.charAt(0).toUpperCase() + env.slice(1);
  const syncLabel = isSyncing ? 'Syncing…' : 'Synced';

  const rows: Array<[string, string]> = [
    ['Deployment environment', envLabel],
    ['App version (commit)', commit],
    ['Live sync', isSyncing ? 'refreshing…' : 'active (realtime + reconnect)'],
    ['Last official data refresh', lastSync],
    ['Capture device last seen', fmt(device?.lastSeenAt ?? null)],
    ['Capture app version', captureAppLabel(device ?? null)],
    ['Capture printer', printerStatusLabel(device ?? null)],
  ];

  const advanced: Array<[string, string]> = [
    ['Supabase project (masked)', projectMasked],
    ['Business', business],
    ['Signed-in account ID', accountId],
  ];

  return (
    <details
      className="rounded-lg border border-border bg-card/40"
      data-testid="system-diagnostics"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm">
        <span className="font-medium text-foreground">System Diagnostics</span>
        <span
          className="truncate font-mono text-xs text-muted-foreground"
          title={`${envLabel} · ${syncLabel} · Commit ${commit}`}
        >
          {envLabel} · {syncLabel} · Commit {commit}
        </span>
      </summary>

      <div className="space-y-3 border-t border-border px-3 py-3">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono text-xs font-medium" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={() => {
            refresh();
            router.refresh();
          }}
          disabled={isSyncing}
          data-testid="refresh-official-data"
          className="rounded-md border border-gold bg-gold px-3 py-1.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-60"
        >
          {isSyncing ? 'Refreshing…' : '↻ Refresh Official Data'}
        </button>

        <details className="rounded-md border border-border/60">
          <summary className="cursor-pointer px-2 py-1 text-xs text-muted-foreground">
            Advanced technical detail
          </summary>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 px-2 py-2 sm:grid-cols-2">
            {advanced.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="truncate font-mono text-[11px]" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        <p className="text-[11px] text-muted-foreground">
          If two devices show different data, compare <strong>Commit</strong> above on each — they
          must match. Always open the shared address{' '}
          <span className="font-mono">av-jewelry.vercel.app</span>, not a one-off deployment URL.
        </p>
      </div>
    </details>
  );
}
