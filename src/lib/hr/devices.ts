import 'server-only';

import { randomBytes } from 'node:crypto';

import { cookies } from 'next/headers';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Approved-device gating for attendance (Team Management Phase 2a).
 *
 * ONE admin-approved shop phone may clock in/out. Security model:
 *   - The Owner registers THIS browser/phone: the server mints a random token,
 *     stores only its sha256 HASH (register_attendance_device), and sets it in an
 *     httpOnly cookie on that device. The raw token never leaves the server except
 *     as that cookie — it is never in localStorage and never readable by JS.
 *   - Clock-in/out verify the cookie token against the active device server-side
 *     (verify_attendance_device). An unregistered device is refused AND logged.
 *   - Gating is NON-BREAKING: until a device is registered, `attendance_gating_active`
 *     is false and clock-in behaves exactly as before — no one is locked out.
 *   - Register/revoke are Owner-only (re-checked in the SECURITY DEFINER functions
 *     AND here); the device roster is Owner-read via RLS.
 */

const COOKIE = 'av_att_device';

export type DeviceRow = {
  id: string;
  label: string;
  isActive: boolean;
  createdAt: string;
  revokedAt: string | null;
};

/** True once at least one device is registered — i.e. gating is switched on. */
export async function isAttendanceGatingActive(): Promise<boolean> {
  const supabase = await createClient();
  const response = await supabase.rpc('attendance_gating_active');
  return response.data === true;
}

/** The active device id if THIS device's cookie matches an active device, else null. */
export async function verifyDeviceCookie(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const supabase = await createClient();
  const response = await supabase.rpc('verify_attendance_device', { p_token: token });
  return typeof response.data === 'string' && response.data.length > 0
    ? response.data
    : null;
}

/** True when THIS device is the approved shop phone (for the UI status). */
export async function isThisDeviceApproved(): Promise<boolean> {
  return (await verifyDeviceCookie()) !== null;
}

/**
 * Owner registers THIS browser/phone as the approved device. Mints a token, stores
 * its hash, and sets the httpOnly cookie on this device. Must be called from a
 * server action (cookie write).
 */
export async function registerThisDevice(
  label: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const token = randomBytes(32).toString('hex');
  const supabase = await createClient();
  const { error } = await supabase.rpc('register_attendance_device', {
    p_label: label,
    p_token: token,
  });
  if (error) return { ok: false, error: 'The device could not be registered.' };

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  await recordAuditEvent({
    action: 'attendance.device_register',
    entityType: 'attendance_device',
    context: { label: label || 'Shop phone' },
  });
  return { ok: true };
}

/** Owner revokes a device — it can no longer clock in. */
export async function revokeDevice(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('revoke_attendance_device', { p_id: id });
  if (error) return { ok: false, error: 'The device could not be revoked.' };

  await recordAuditEvent({
    action: 'attendance.device_revoke',
    entityType: 'attendance_device',
    entityId: id,
  });
  return { ok: true };
}

/** The device roster (Owner-read via RLS). Newest first. */
export async function listDevices(): Promise<DeviceRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('attendance_devices')
    .select('id, label, is_active, created_at, revoked_at')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    isActive: r.is_active === true,
    createdAt: r.created_at as string,
    revokedAt: (r.revoked_at as string | null) ?? null,
  }));
}
