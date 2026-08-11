import { NextResponse } from 'next/server';

import { sendCaptureMessage } from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/capture/send — send the screenshot + message to the customer's
 * Pancake conversation THROUGH the MineFlow backend (the app never calls Pancake
 * directly; the token stays server-side).
 *
 * Safety: requires an explicit `conversationId` (never sends by Facebook name),
 * is idempotent (won't resend an already-sent capture), and records the result so
 * a failed send can be retried without recreating the order.
 *
 * Body: { deviceInstallationId, captureId, conversationId, message, screenshotPath? }
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
  const optStr = (k: string): string | null => {
    const v = body[k];
    return typeof v === 'string' && v.trim() ? v : null;
  };

  const result = await sendCaptureMessage(staff.supabase, {
    deviceInstallationId: str('deviceInstallationId'),
    captureId: str('captureId'),
    conversationId: str('conversationId'),
    message: str('message'),
    screenshotPath: optStr('screenshotPath'),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, code: result.code, error: result.error },
      { status: 422 },
    );
  }
  return NextResponse.json(result);
}
