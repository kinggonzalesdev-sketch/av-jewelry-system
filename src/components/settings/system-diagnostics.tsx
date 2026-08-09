'use client';

import { useRouter } from 'next/navigation';

import { useDashboardSync } from '@/components/shell/dashboard-sync';

/**
 * System Diagnostics (Super Admin only) — sanitized info to prove every device is on
 * the SAME deployment + database, and a one-tap "Refresh Official Data" that re-fetches
 * the shared server state. Shows NO secrets: the Supabase project is masked and no
 * key/token is ever rendered. Cross-device mismatches are almost always two devices on
 * DIFFERENT deployments — compare the Deployment / Commit values across devices here.
 */
export function SystemDiagnostics({
  env,
  commit,
  projectMasked,
  accountId,
  business,
}: {
  env: string;
  commit: string;
  projectMasked: string;
  accountId: string;
  business: string;
}) {
  const router = useRouter();
  const { lastSyncedAt, isSyncing, refresh } = useDashboardSync();

  const lastSync = lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet this session';

  const rows: Array<[string, string]> = [
    ['Deployment environment', env],
    ['App version (commit)', commit],
    ['Supabase project (masked)', projectMasked],
    ['Business', business],
    ['Signed-in account ID', accountId],
    ['Last official data refresh', lastSync],
    ['Live sync', isSyncing ? 'refreshing…' : 'active (realtime + reconnect)'],
  ];

  return (
    <div className="space-y-3">
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

      <p className="text-[11px] text-muted-foreground">
        If two devices show different data, compare <strong>Deployment</strong> and{' '}
        <strong>Commit</strong> above on each device — they must match. Always open the shared
        address <span className="font-mono">av-jewelry.vercel.app</span>, not a one-off deployment
        URL.
      </p>
    </div>
  );
}
