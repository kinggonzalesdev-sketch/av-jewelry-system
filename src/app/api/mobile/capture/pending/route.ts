import { NextResponse } from 'next/server';

import { createPendingCapture } from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/capture/pending — the floating screenshot uploads a PENDING
 * capture: the stored screenshot path (from POST /capture/upload) + the on-device
 * OCR guess. No order or item is created here; the PC web app picks it up for the
 * operator to confirm/correct, then creates the order (which prints + reserves) and
 * links this capture so Send Invoice attaches the screenshot.
 *
 * Body: { deviceInstallationId, captureId, screenshotPath?, ocr? }
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

  const str = (k: string): string => {
    const v = body[k];
    return typeof v === 'string' ? v : '';
  };

  const result = await createPendingCapture(staff.supabase, {
    deviceInstallationId: str('deviceInstallationId'),
    captureId: str('captureId'),
    screenshotPath: str('screenshotPath') || null,
    ocr: body.ocr ?? null,
    // 'printed' when the phone printed the sticker locally before this row existed.
    printStatus: str('printStatus') || null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
