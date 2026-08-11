import { NextResponse } from 'next/server';

import { uploadCaptureScreenshot } from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/capture/upload — store a capture screenshot in the PRIVATE
 * attachments bucket (signed access only; never a public URL). Returns the storage
 * path to pass to POST /api/mobile/capture/order as `screenshotPath`.
 *
 * Body: { deviceInstallationId, captureId, contentType, base64 }
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

  const result = await uploadCaptureScreenshot(staff.supabase, staff.staffProfileId, {
    deviceInstallationId: str('deviceInstallationId'),
    captureId: str('captureId'),
    contentType: str('contentType'),
    base64: str('base64'),
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
