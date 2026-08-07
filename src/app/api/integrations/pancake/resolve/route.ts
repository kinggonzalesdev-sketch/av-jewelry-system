import { NextResponse } from 'next/server';

import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import { findRecentPancakeConversationByName } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/integrations/pancake/resolve?name=… — FAST auto-match for the order's
 * Linked Facebook Customer panel. Unlike "Load conversations" (the full 6-month walk
 * that can take minutes), this looks the name up in a BOUNDED recent window (a few
 * paged calls, seconds) and returns a conversation id only when it uniquely matches
 * (exact or first+last). Primary-Super-Admin gated like the conversations endpoint.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      // Non-Owner: no auto-match (they can still paste an id) — not an error.
      return NextResponse.json({ ok: true, conversationId: null, matchCount: 0 });
    }
    throw cause;
  }

  const name = (new URL(request.url).searchParams.get('name') ?? '').trim();
  if (name.length < 2) {
    return NextResponse.json({ ok: true, conversationId: null, matchCount: 0 });
  }

  // Search deep but with early-stop: up to ~4 months, up to 12 pages — the lookup stops
  // the moment the name is found, so a recent person is instant and an older one is
  // still reachable (instead of being missed after only a few pages).
  const res = await findRecentPancakeConversationByName(name, { sinceDays: 120, maxPages: 12 });
  return NextResponse.json({
    ok: true,
    conversationId: res.conversationId,
    matchCount: res.matchCount,
  });
}
