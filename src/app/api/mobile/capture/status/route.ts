import { NextResponse } from 'next/server';

import { getCaptureStatus } from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/capture/status?device=...&capture=... — the current order /
 * message / print status of a capture, for the app's history and retry screens.
 * A missing record simply reports "not_found" so the app can offer to (re)create.
 */
export async function GET(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Session invalid or expired.' }, { status: 401 });
  }

  const url = new URL(request.url);
  const device = url.searchParams.get('device') ?? '';
  const capture = url.searchParams.get('capture') ?? '';
  if (!device.trim() || !capture.trim()) {
    return NextResponse.json(
      { ok: false, error: 'device and capture are required.' },
      { status: 400 },
    );
  }

  const status = await getCaptureStatus(staff.supabase, device, capture);
  if (!status) {
    return NextResponse.json({ ok: true, found: false });
  }
  return NextResponse.json({ ok: true, found: true, status });
}
