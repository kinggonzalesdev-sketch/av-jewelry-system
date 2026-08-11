import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';
import { resolveConversationForName } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';
// The live lookup may page through a busy live's conversation list (with early-stop),
// so give it room beyond the default serverless budget.
export const maxDuration = 25;

/**
 * GET /api/mobile/customer/conversation?name=… — resolve the Pancake conversation id
 * for an OCR'd Facebook name so the capture app can auto-send the screenshot. Safe:
 * only returns an id when EXACTLY ONE person carries that normalized name.
 *
 * Two tiers:
 *   1. A pre-linked ACTIVE customer with that unique name (RLS-scoped, offline-fast).
 *   2. LIVE fallback — if no unique customer match, look the name up directly in the
 *      most recent Pancake interactions (messages + comments). This is what makes the
 *      LIVE work: a person who just commented is auto-sent to even before they are a
 *      saved customer. A name shared by 2+ customers is never guessed (tier-2 is
 *      skipped), and tier-2 itself only returns a single unambiguous conversation.
 */
export async function GET(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json(
      { ok: false, error: 'Session invalid or expired.' },
      { status: 401 },
    );
  }

  const name = (new URL(request.url).searchParams.get('name') ?? '').trim();
  if (name.length < 2) {
    return NextResponse.json({ ok: true, conversationId: null, matchCount: 0 });
  }

  // One source of truth for name → conversation (shared with the PC's Incoming
  // Captures "Send to Messenger"). Never guesses when 2+ people share the name.
  const resolved = await resolveConversationForName(staff.supabase, name, {
    sinceDays: 7,
    maxPages: 8,
  });
  return NextResponse.json({
    ok: true,
    conversationId: resolved.conversationId,
    matchCount: resolved.matchCount,
    source: resolved.source,
  });
}
