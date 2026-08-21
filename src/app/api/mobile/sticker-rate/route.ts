import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/sticker-rate — a capture phone pushes its explicit Save Rate up to the ONE
 * shared web Sticker Settings so other phones sync it later (background only; never on the phone's
 * print path). Returns the new revision (updated_at epoch ms) the phone records so a stale server
 * copy can't later revert a newer save. Active-staff gated by the RPC. An empty rate clears it.
 */
export async function POST(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json(
      { ok: false, error: 'Session invalid or expired.' },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body → treated as clearing the rate.
  }
  const rate = typeof body.pricePerGram === 'string' ? body.pricePerGram.trim() : '';

  const { data, error } = (await staff.supabase.rpc('mobile_set_sticker_rate', {
    p_rate: rate,
  })) as { data: number | string | null; error: { message: string } | null };

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() },
      { status: 422 },
    );
  }
  const rev = typeof data === 'number' ? data : typeof data === 'string' ? Number(data) : NaN;
  return NextResponse.json({
    ok: true,
    pricePerGramRev: Number.isFinite(rev) ? rev : null,
  });
}
