import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/print/result — report the outcome of a claimed label job.
 *
 * Body: { labelJobId, outcome: 'printed' | 'failed', reason? }. Both outcomes clear
 * the claim; a failure returns the job to the queue so it can be retried. Requires the
 * confirm_claim_print_label permission, re-checked in the database.
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

  const jobId = typeof body.labelJobId === 'string' ? body.labelJobId.trim() : '';
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'A label job id is required.' },
      { status: 400 },
    );
  }

  if (outcome === 'printed') {
    const { error } = (await staff.supabase.rpc('mark_label_job_printed', {
      p_job_id: jobId,
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
    const { error } = (await staff.supabase.rpc('mark_label_job_failed', {
      p_job_id: jobId,
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
