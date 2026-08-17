import { NextResponse } from 'next/server';

import { listPrivateReplyTestCandidates } from '@/lib/integrations/private-reply-test';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/pancake/private-reply-candidates — recent Live/video COMMENT
 * events that are privately-replyable (can_reply_privately = true) and carry the full
 * identity, so the Primary Super Admin can pick ONE approved test comment for the
 * controlled Test B harness. Primary Super Admin only (enforced in the domain);
 * returns only safe, display-masked fields.
 */
export async function GET(): Promise<Response> {
  const candidates = await listPrivateReplyTestCandidates();
  return NextResponse.json({ ok: true, candidates });
}
