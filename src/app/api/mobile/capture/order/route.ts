import { NextResponse } from 'next/server';

import {
  activeLiveModeIsReview,
  createCaptureOrder,
  enqueueCaptureReview,
} from '@/lib/capture/service';
import { authenticateMobile } from '@/lib/mobile/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/mobile/capture/order — create the order for a confirmed capture.
 *
 * Idempotent on `capture:{device}:{capture_id}` (enforced in the database), so a
 * retried tap or a network re-send returns the SAME order instead of creating a
 * duplicate. The order lands in For Invoice. Requires the claim_capture
 * permission — re-checked in the SECURITY DEFINER function, never trusted here.
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

  const input = {
    deviceInstallationId: str('deviceInstallationId'),
    captureId: str('captureId'),
    customerName: str('customerName'),
    inventoryItemId: str('inventoryItemId'),
    price: str('price'),
    grams: optStr('grams'),
    screenshotPath: optStr('screenshotPath'),
    ocr: body.ocr ?? null,
    pancakeConversationId: optStr('pancakeConversationId'),
    pancakeCustomerId: optStr('pancakeCustomerId'),
  };

  // In Review Mode the capture is QUEUED for a reviewer instead of creating the order
  // directly. Automatic Mode (or no live session) keeps the direct-create behaviour.
  if (await activeLiveModeIsReview(staff.supabase)) {
    const queued = await enqueueCaptureReview(staff.supabase, input);
    if (!queued.ok) {
      return NextResponse.json({ ok: false, error: queued.error }, { status: 422 });
    }
    return NextResponse.json(queued);
  }

  const result = await createCaptureOrder(staff.supabase, input);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
