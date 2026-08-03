import { NextResponse } from 'next/server';

import { resolveMobileStaff, type MobileAuthFailure } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * Map a typed auth failure to an HTTP status + safe message. A missing/expired
 * token is a 401 (re-authenticate); a valid token whose account is unknown or
 * deactivated is a 403 (nothing to re-authenticate — the operator must fix the
 * account). The `code` lets the Capture app show a precise, non-sensitive reason.
 */
const FAILURE: Record<MobileAuthFailure, { status: number; error: string }> = {
  session_invalid: { status: 401, error: 'Session invalid or expired. Please sign in again.' },
  account_not_found: {
    status: 403,
    error: 'This account isn’t registered as MineFlow staff.',
  },
  account_inactive: { status: 403, error: 'This MineFlow account has been deactivated.' },
};

/**
 * GET /api/mobile/session — verify the mobile session and return the signed-in
 * staff identity (name, role) plus a connection-ok signal. The Capture app calls
 * this on launch and after reauthentication. Never returns any secret.
 */
export async function GET(request: Request): Promise<Response> {
  const result = await resolveMobileStaff(request);
  if (!result.ok) {
    const { status, error } = FAILURE[result.reason];
    return NextResponse.json({ ok: false, code: result.reason, error }, { status });
  }
  const { staff } = result;
  return NextResponse.json({
    ok: true,
    connection: 'ok',
    staff: {
      id: staff.staffProfileId,
      name: staff.fullName,
      role: staff.roleKey,
    },
  });
}
