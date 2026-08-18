import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { CaptureDeviceStatus } from '@/lib/live/capture-device-format';

/**
 * The latest capture-device heartbeat (RLS: readable by claim_capture holders). Returns null when
 * none exists or the caller can't read it. Best-effort — NEVER throws: observability must not break
 * the Settings page. Stores/returns no secret (no token, no Bluetooth key, no customer data).
 */
export async function getLatestCaptureDevice(): Promise<CaptureDeviceStatus | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('capture_device_heartbeats')
      .select(
        'last_seen_at, app_version_name, app_version_code, build_commit, printer_configured, printer_enabled, printer_connection_state, printer_name',
      )
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const r = data as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
    return {
      lastSeenAt: str(r.last_seen_at),
      appVersionName: str(r.app_version_name),
      appVersionCode: num(r.app_version_code),
      buildCommit: str(r.build_commit),
      printerConfigured: bool(r.printer_configured),
      printerEnabled: bool(r.printer_enabled),
      printerConnectionState: str(r.printer_connection_state),
      printerName: str(r.printer_name),
    };
  } catch {
    return null;
  }
}
