import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/print/claim — claim the next label job for this device.
 *
 * The database claims the oldest unclaimed pending job with FOR UPDATE SKIP LOCKED,
 * so two devices claiming at the same time get DIFFERENT jobs — a label is never
 * printed twice. Returns { claimed: false } when the queue is empty. Requires the
 * confirm_claim_print_label permission, re-checked in the SECURITY DEFINER function.
 */
export async function POST(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Session invalid or expired.' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // An empty body is fine — printerId / device are optional.
  }

  const printerId =
    typeof body.printerId === 'string' && body.printerId.trim() ? body.printerId.trim() : null;
  const device =
    typeof body.deviceInstallationId === 'string' && body.deviceInstallationId.trim()
      ? body.deviceInstallationId.trim()
      : null;

  const { data, error } = (await staff.supabase.rpc('claim_next_label_job', {
    p_printer_id: printerId,
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
