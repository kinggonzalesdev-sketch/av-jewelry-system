import { NextResponse } from 'next/server';

import { listPancakePages, type PancakePagesCode } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/pancake/pages — the managed Pages the configured Pancake
 * User Access Token can see.
 *
 * SECURITY:
 *   - Primary Super Admin only (enforced in listPancakePages, which reads the
 *     verified session — never a client-supplied identity).
 *   - The token stays server-side: it is read from PANCAKE_USER_ACCESS_TOKEN and
 *     sent to pages.fm as a query parameter. It is NEVER returned to the browser,
 *     and the token-bearing URL is NEVER logged.
 *   - The response is sanitised to id / name / platform / connected.
 */

/** Map a domain result code to the right HTTP status. */
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
  const result = await listPancakePages();
  return NextResponse.json(
    {
      ok: result.ok,
      code: result.code,
      message: result.message,
      pages: result.pages,
    },
    { status: STATUS_BY_CODE[result.code] },
  );
}
