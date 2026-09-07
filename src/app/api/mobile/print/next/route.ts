import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/print/next — claim the next typed WEB print job (ORDER_STICKER) for this
 * device. The native MineFlow Capture app polls this for New Order stickers. The database
 * claims the oldest queued job with FOR UPDATE SKIP LOCKED, so two devices claiming at the
 * same time get DIFFERENT jobs — a sticker is never printed twice. Returns { claimed: false }
 * when empty; otherwise the job's `job_type` + pre-rendered `sticker` payload. The device
 * prints the sticker over native Bluetooth and reports to /print/next-result. Requires
 * confirm_claim_print_label (re-checked in the SECURITY DEFINER function).
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
    // An empty body is fine — the device id is optional attribution.
  }
  const device =
    typeof body.deviceInstallationId === 'string' && body.deviceInstallationId.trim()
      ? body.deviceInstallationId.trim()
      : null;

  const { data, error } = (await staff.supabase.rpc('claim_next_print_job', {
    p_device: device,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, ...(data ?? { claimed: false }) });
}
