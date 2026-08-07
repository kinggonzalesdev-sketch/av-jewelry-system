import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';
import { normalizeName } from '@/lib/customers/matching';
import { findRecentPancakeConversationByName } from '@/lib/integrations/pancake';

export const dynamic = 'force-dynamic';

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
  const matches = rows.filter((c) => normalizeName(c.display_name ?? '') === norm);
  const withConv = matches.filter((c) => c.pancake_conversation_id);
  const conversationId = withConv.length === 1 ? (withConv[0]?.pancake_conversation_id ?? null) : null;

  // Tier 1 hit — a uniquely-named, pre-linked customer.
  if (conversationId) {
    return NextResponse.json({ ok: true, conversationId, matchCount: matches.length, source: 'customer' });
  }

  // A name shared by 2+ known customers is ambiguous — never guess a live conversation.
  if (matches.length > 1) {
    return NextResponse.json({ ok: true, conversationId: null, matchCount: matches.length });
  }

  // Tier 2 — LIVE lookup: the person may have just commented and not be a saved
  // customer yet. Returns an id only for a single unambiguous conversation.
  const live = await findRecentPancakeConversationByName(name);
  return NextResponse.json({
    ok: true,
    conversationId: live.conversationId,
    matchCount: matches.length || live.matchCount,
    source: live.conversationId ? 'pancake_live' : 'none',
  });
}
