import { NextResponse } from 'next/server';

import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import { resolveConversationForName } from '@/lib/integrations/pancake';
import { createClient } from '@/lib/supabase/server';

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

  // Resolve via the SAME source-of-truth resolver the capture + Send-Invoice flows use:
  // a pre-linked customer, then the WEBHOOK fast-match (every recent commenter/messager —
  // this is what finds video-live commenters the conversations API omits), then a bounded
  // live lookup. Unique-gated, so a shared name never auto-fills the wrong chat.
  const supabase = await createClient();
  const res = await resolveConversationForName(supabase, name, {
    sinceDays: 120,
    maxPages: 12,
  });
  return NextResponse.json({
    ok: true,
    conversationId: res.conversationId,
    matchCount: res.matchCount,
  });
}
