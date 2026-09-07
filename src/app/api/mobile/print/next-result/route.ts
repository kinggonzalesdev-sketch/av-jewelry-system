import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/print/next-result — report the outcome of a claimed web print job.
 *
 * Body: { printJobId, outcome: 'printed' | 'failed', reason? }. 'printed' is terminal and
 * guarded (only a claimed job flips to printed), so a duplicate result or an app/realtime
 * reconnect can never make a printed sticker print again. 'failed' parks the job as failed
 * with the claim cleared (a human Retry re-queues it) — never auto-requeued. Requires
 * confirm_claim_print_label.
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
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const jobId = typeof body.printJobId === 'string' ? body.printJobId.trim() : '';
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'A print job id is required.' },
      { status: 400 },
    );
  }

  if (outcome === 'printed') {
    const { error } = (await staff.supabase.rpc('mark_print_job_printed', {
      p_id: jobId,
    })) as { error: { message: string } | null };
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, status: 'printed' });
  }

  if (outcome === 'failed') {
    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    const { error } = (await staff.supabase.rpc('mark_print_job_failed', {
      p_id: jobId,
      p_reason: reason,
    })) as { error: { message: string } | null };
    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, status: 'failed' });
  }

  return NextResponse.json(
    { ok: false, error: "outcome must be 'printed' or 'failed'." },
    { status: 400 },
  );
}
