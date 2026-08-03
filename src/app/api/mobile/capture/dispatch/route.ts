import { NextResponse } from 'next/server';

import { updateCaptureDispatch } from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/capture/dispatch — record the send (Pancake) / print outcome of
 * a capture, and/or attach the uploaded screenshot path. Supports safe Retry Send /
 * Retry Print: it updates status only and NEVER recreates the order.
 *
 * Body: { deviceInstallationId, captureId, messageStatus?, printStatus?,
 *         pancakeMessageId?, screenshotPath? }
 */
export async function POST(request: Request): Promise<Response> {
  const staff = await authenticateMobile(request);
  if (!staff) {
    return NextResponse.json({ ok: false, error: 'Session invalid or expired.' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body.' }, { status: 400 });
  }

  const str = (k: string): string => {
    const v = body[k];
    return typeof v === 'string' ? v : '';
  };
  const optStr = (k: string): string | null => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v : null;
  };

  const result = await updateCaptureDispatch(staff.supabase, {
    deviceInstallationId: str('deviceInstallationId'),
    captureId: str('captureId'),
    messageStatus: optStr('messageStatus'),
    printStatus: optStr('printStatus'),
    pancakeMessageId: optStr('pancakeMessageId'),
    screenshotPath: optStr('screenshotPath'),
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
