/**
 * Pure formatting of the capture device's heartbeat metadata — shared by System Diagnostics and
 * its unit tests. No Android / DB / secret access: it only presents already-sanitized fields.
 */

export type CaptureDeviceStatus = {
  lastSeenAt: string | null;
  appVersionName: string | null;
  appVersionCode: number | null;
  buildCommit: string | null;
  printerConfigured: boolean | null;
  printerEnabled: boolean | null;
  printerConnectionState: string | null;
  printerName: string | null;
};

/** "1.0.12 (build 13 · abc1234)" | "1.0.12" | "—" */
export function captureAppLabel(d: CaptureDeviceStatus | null): string {
  if (!d) return '—';
  const name = (d.appVersionName ?? '').trim();
  if (!name) return '—';
  const bits: string[] = [];
  if (d.appVersionCode != null) bits.push(`build ${d.appVersionCode}`);
  const commit = (d.buildCommit ?? '').trim();
  if (commit) bits.push(commit);
  return bits.length ? `${name} (${bits.join(' · ')})` : name;
}

/**
 * "Configured · ON · connected" | "Configured · OFF" | "Not configured" | "—".
 * Keeps the configured / enabled / connection facts DISTINCT — a configured-but-OFF printer reads
 * differently from a configured-and-connected one.
 */
export function printerStatusLabel(d: CaptureDeviceStatus | null): string {
  if (!d || d.printerConfigured == null) return '—';
  if (!d.printerConfigured) return 'Not configured';
  const enabled = d.printerEnabled === true ? 'ON' : d.printerEnabled === false ? 'OFF' : '—';
  const conn = (d.printerConnectionState ?? '').trim();
  return conn ? `Configured · ${enabled} · ${conn}` : `Configured · ${enabled}`;
}
