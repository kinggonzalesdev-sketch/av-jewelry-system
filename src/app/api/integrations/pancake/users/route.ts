import { NextResponse } from 'next/server';

import { getPancakePageUsers, type PancakePagesCode } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/pancake/users — the ACTIVE users of the connected Page
 * (pages.fm Get Users List), so the Owner can choose the authorized Private Reply
 * sender (`private_replies.sender_id` = an active `users[].id`).
 *
 * SECURITY: Primary Super Admin only (enforced in getPancakePageUsers). The Page
 * Access Token stays server-side and is never returned; only safe fields are sent
 * (id / name / status / statusInPage / isOnline / raw page_permissions for display).
 * `disabled_users[]` is never offered.
 */
const STATUS_BY_CODE: Record<PancakePagesCode, number> = {
  loaded: 200,
  none_found: 200,
  token_missing: 503,
  token_invalid: 401,
  permission_denied: 403,
  unavailable: 502,
  forbidden: 403,
};

export async function GET(): Promise<Response> {
  const result = await getPancakePageUsers();
  return NextResponse.json(
    {
      ok: result.ok,
      code: result.code,
      message: result.message,
      users: result.users,
    },
    { status: STATUS_BY_CODE[result.code] },
  );
}
