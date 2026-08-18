import 'server-only';

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { getClientEnv } from '@/lib/env';
import type { RoleKey } from '@/lib/authz/permissions';

/**
 * Mobile (MineFlow Capture app) authentication.
 *
 * The Android app signs in with the SAME MineFlow account and sends the Supabase
 * access token as `Authorization: Bearer <token>`. This never trusts a
 * client-supplied identity: it verifies the JWT with Supabase, then loads the
 * staff profile through an RLS-scoped client (so the caller can only ever see
 * their own row). No Supabase service-role key is used, and no Pancake token is
 * ever exposed to the device — every privileged action happens server-side.
 */

export type MobileStaff = {
  staffProfileId: string;
  authUserId: string;
  roleKey: RoleKey;
  fullName: string;
  /** A Supabase client bound to the caller's token — RLS applies to every query. */
  supabase: SupabaseClient;
};

/**
 * Throttle the best-effort "device active" heartbeat OFF the hot path. During a live,
 * a single capture makes several mobile calls (create pending → attach OCR → attach
 * screenshot), and each one authenticates — running the heartbeat RPC on every one adds
 * a needless Supabase round-trip to the latency-critical capture path. Once per window
 * per user (per warm instance) keeps the web System Check fresh at no per-call cost.
 */
const HEARTBEAT_WINDOW_MS = 25_000;
const lastHeartbeatByUser = new Map<string, number>();

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Best-effort capture-device metadata for the heartbeat, read from headers the Capture app sends.
 * OLD clients omit these → nulls → the RPC coalesce-preserves existing values (nothing breaks / is
 * wiped). NO secrets: device id, app version/build commit, and printer configured/enabled/
 * connection state only — never a token, Bluetooth key, screenshot, or customer data.
 */
function captureHeartbeatArgs(request: Request) {
  const h = request.headers;
  const str = (k: string): string | null => {
    const t = (h.get(k) ?? '').trim();
    return t ? t.slice(0, 120) : null;
  };
  const int = (k: string): number | null => {
    const v = h.get(k);
    const n = v ? Number.parseInt(v, 10) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  };
  const bool = (k: string): boolean | null => {
    const v = h.get(k);
    return v === '1' ? true : v === '0' ? false : null;
  };
  return {
    p_device: str('x-mineflow-device'),
    p_platform: 'android',
    p_app_version_name: str('x-mineflow-app-version'),
    p_app_version_code: int('x-mineflow-version-code'),
    p_build_commit: str('x-mineflow-commit'),
    p_printer_configured: bool('x-mineflow-printer-configured'),
    p_printer_enabled: bool('x-mineflow-printer-enabled'),
    p_printer_connection_state: str('x-mineflow-printer-conn'),
    p_printer_name: str('x-mineflow-printer-name'),
  };
}

/**
 * Why a mobile caller was rejected. Lets the session route return a precise,
 * non-sensitive reason the Capture app can turn into a clear message.
 *   - session_invalid  : no token, or the JWT is invalid/expired.
 *   - account_not_found: valid token, but no staff_profiles row for that user.
 *   - account_inactive : staff row exists but has been deactivated.
 */
export type MobileAuthFailure =
  'session_invalid' | 'account_not_found' | 'account_inactive';

export type MobileAuthResult =
  { ok: true; staff: MobileStaff } | { ok: false; reason: MobileAuthFailure };

/**
 * Verify the caller and return their staff context, or a typed failure reason.
 * The reason never leaks a secret — it only says why sign-in cannot proceed, so
 * the operator can be told to fix the right thing (wrong account vs deactivated).
 */
export async function resolveMobileStaff(request: Request): Promise<MobileAuthResult> {
  const token = bearerToken(request);
  if (!token) return { ok: false, reason: 'session_invalid' };

  const env = getClientEnv();
  const supabase = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return { ok: false, reason: 'session_invalid' };

  const { data } = await supabase
    .from('staff_profiles')
    .select('id, auth_user_id, role_key, is_active, full_name')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!data) return { ok: false, reason: 'account_not_found' };
  if (data.is_active !== true) return { ok: false, reason: 'account_inactive' };

  // Record a lightweight heartbeat so the web System Check can show a signed-in
  // capture device + active app. Best-effort AND throttled: skipped when this user was
  // seen within the window, so it never adds a round-trip to a rapid capture burst.
  const now = Date.now();
  if (now - (lastHeartbeatByUser.get(user.id) ?? 0) > HEARTBEAT_WINDOW_MS) {
    lastHeartbeatByUser.set(user.id, now);
    try {
      await supabase.rpc('record_capture_heartbeat', captureHeartbeatArgs(request));
    } catch {
      /* heartbeat is best-effort */
    }
  }

  return {
    ok: true,
    staff: {
      staffProfileId: data.id as string,
      authUserId: data.auth_user_id as string,
      roleKey: data.role_key as RoleKey,
      fullName: (data.full_name as string) ?? 'Staff member',
      supabase,
    },
  };
}

/**
 * Verify the caller and return their staff context, or null when the token is
 * missing / invalid / expired, or the account is not an active staff member.
 * Callers translate null into a 401 with a safe, generic message.
 */
export async function authenticateMobile(request: Request): Promise<MobileStaff | null> {
  const result = await resolveMobileStaff(request);
  return result.ok ? result.staff : null;
}
