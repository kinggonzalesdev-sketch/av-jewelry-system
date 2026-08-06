import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';
import { normalizeName } from '@/lib/customers/matching';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/customer/conversation?name=… — resolve the Pancake conversation id
 * for an OCR'd Facebook name so the capture app can auto-send the screenshot. Safe:
 * only returns an id when EXACTLY ONE active customer has that normalized name AND a
 * linked conversation — a shared/ambiguous name resolves to null (the operator links
 * it by hand). RLS-scoped via the caller's mobile session.
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

  return NextResponse.json({ ok: true, conversationId, matchCount: matches.length });
}
