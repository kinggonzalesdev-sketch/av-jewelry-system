import { NextResponse } from 'next/server';

import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/print/capture-claim — claim the next capture sticker for this device.
 *
 * The shared capture-sticker queue: the DB hands out each eligible capture (floating,
 * non-test, confident weight + name, not yet printed) to ONE device via FOR UPDATE SKIP
 * LOCKED, so a PC and a phone can both be set up and whoever is active prints each
 * sticker EXACTLY ONCE — never twice. Returns { claimed:false } when nothing is waiting.
 * The printing device adds its own price-per-gram + date (a per-device setting).
 *
 * FAST PATH: when the body carries a `captureRecordId`, the CAPTURING phone claims ITS
 * OWN sticker by id (claim_capture_sticker_by_id) so it can print locally in ~0.5-1s
 * without waiting for the poll — same atomic guards, so the PC / poller still can't
 * double-print it. Without an id it falls back to claiming the next one in the queue.
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
    // Empty body is fine — the device id is optional attribution.
  }
  const device =
    typeof body.deviceInstallationId === 'string' && body.deviceInstallationId.trim()
      ? body.deviceInstallationId.trim()
      : null;
  const captureRecordId =
    typeof body.captureRecordId === 'string' && body.captureRecordId.trim()
      ? body.captureRecordId.trim()
      : null;

  // Fast path: claim THIS capture by id (the capturing phone printing its own sticker);
  // otherwise claim the next one waiting in the shared queue. Both are atomic + exactly-once.
  const { data, error } = (await (captureRecordId
    ? staff.supabase.rpc('claim_capture_sticker_by_id', {
        p_capture_record_id: captureRecordId,
        p_device: device,
      })
    : staff.supabase.rpc('claim_next_capture_sticker', {
        p_device: device,
      }))) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() },
      { status: 422 },
    );
  }
  return NextResponse.json({ ok: true, ...(data ?? { claimed: false }) });
}
