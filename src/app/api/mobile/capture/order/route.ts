import { NextResponse } from 'next/server';

import { createCaptureOrder } from '@/lib/capture/service';
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

  const result = await createCaptureOrder(staff.supabase, {
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
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json(result);
}
