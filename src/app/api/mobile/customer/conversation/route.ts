import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';
import { nameKey, normalizeName } from '@/lib/customers/matching';
import { findRecentPancakeConversationByName } from '@/lib/integrations/pancake';

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
    return NextResponse.json({ ok: false, error: 'Session invalid or expired.' }, { status: 401 });
  }

  const name = (new URL(request.url).searchParams.get('name') ?? '').trim();
  if (name.length < 2) {
    return NextResponse.json({ ok: true, conversationId: null, matchCount: 0 });
  }

  const norm = normalizeName(name);
  const firstToken = name.split(/\s+/)[0] ?? name;
  const { data } = await staff.supabase
    .from('customers')
    .select('display_name, pancake_conversation_id')
    .eq('is_active', true)
    .ilike('display_name', `%${firstToken.replace(/[%,]/g, ' ')}%`)
    .limit(50);

  const rows = (data ?? []) as Array<{
    display_name: string | null;
    pancake_conversation_id: string | null;
  }>;

  // Tier 1a — EXACT full-name (strongest). A unique linked customer wins.
  const exact = rows.filter((c) => normalizeName(c.display_name ?? '') === norm);
  const exactLinked = exact.filter((c) => c.pancake_conversation_id);
  if (exactLinked.length === 1) {
    return NextResponse.json({
      ok: true,
      conversationId: exactLinked[0]?.pancake_conversation_id ?? null,
      matchCount: exact.length,
      source: 'customer',
    });
  }
  // A name shared by 2+ known customers is ambiguous — never guess.
  if (exact.length > 1) {
    return NextResponse.json({ ok: true, conversationId: null, matchCount: exact.length });
  }

  // Tier 1b — FIRST+LAST (middle-name tolerant), matching the sync's smart linking, so
  // "King Gonzales" resolves the customer stored as "KING FRANCHESCO GONZALES". Unique
  // linked customer only.
  const key = nameKey(name);
  const flLinked = rows.filter(
    (c) => nameKey(c.display_name ?? '') === key && c.pancake_conversation_id,
  );
  if (flLinked.length === 1) {
    return NextResponse.json({
      ok: true,
      conversationId: flLinked[0]?.pancake_conversation_id ?? null,
      matchCount: 1,
      source: 'customer_first_last',
    });
  }
  if (flLinked.length > 1) {
    return NextResponse.json({ ok: true, conversationId: null, matchCount: flLinked.length });
  }

  // Tier 2 — LIVE lookup: the person may have just commented and not be a saved
  // customer yet. Returns an id only for a single unambiguous conversation (the id is
  // per-person, {page_id}_{psid}, so two matches = two different people — never guessed).
  // Search a WIDE-but-recent window with early-stop so a commenter who is past page 1
  // during a busy live is still found (this is what makes the one-tap auto-send land).
  const live = await findRecentPancakeConversationByName(name, { sinceDays: 7, maxPages: 8 });
  return NextResponse.json({
    ok: true,
    conversationId: live.conversationId,
    matchCount: exact.length || live.matchCount,
    source: live.conversationId ? 'pancake_live' : 'none',
  });
}
