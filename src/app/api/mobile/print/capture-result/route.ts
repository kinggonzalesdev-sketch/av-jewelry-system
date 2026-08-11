import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/print/capture-result — report a claimed capture sticker.
 *
 * Body: { captureRecordId, outcome: 'printed' | 'failed' }. 'printed' stamps it done
 * (so no device reprints it); 'failed' releases the claim so another device can pick it
 * up. Part of the shared PC+phone capture-sticker queue.
 */
export async function POST(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json(
      { ok: false, error: 'Session invalid or expired.' },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    );
  }

  const id = typeof body.captureRecordId === 'string' ? body.captureRecordId.trim() : '';
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  if (!id) {
    return NextResponse.json(
      { ok: false, error: 'A capture id is required.' },
      { status: 400 },
    );
  }

  const fn =
    outcome === 'printed' ? 'mark_capture_sticker_printed' : 'release_capture_sticker';
  const { error } = (await staff.supabase.rpc(fn, { p_capture_record_id: id })) as {
    error: { message: string } | null;
  };
  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() },
      { status: 422 },
    );
  }
  return NextResponse.json({
    ok: true,
    status: outcome === 'printed' ? 'printed' : 'released',
  });
}
