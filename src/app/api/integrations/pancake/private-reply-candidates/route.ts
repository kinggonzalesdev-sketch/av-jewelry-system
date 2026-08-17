import { NextResponse } from 'next/server';

import {
  listPrivateReplyTestCandidates,
  searchPrivateReplyTestCandidates,
} from '@/lib/integrations/private-reply-test';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/pancake/private-reply-candidates[?q=TEXT] — Live/video COMMENT
 * events that are privately-replyable (can_reply_privately = true) and carry the full
 * identity, so the Primary Super Admin can pick ONE approved test comment for the
 * controlled Test B harness. With ?q= it NARROWS those eligible candidates by exact/
 * partial comment text (e.g. the consented token) — it NEVER widens the gate, so
 * inbox/null or can_reply_privately=false events are never selectable. Primary Super
 * Admin only (enforced in the domain); returns only safe, display-masked fields.
 */
export async function GET(request: Request): Promise<Response> {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  const candidates = q
    ? await searchPrivateReplyTestCandidates(q)
    : await listPrivateReplyTestCandidates();
  return NextResponse.json({ ok: true, candidates, query: q || null });
}
