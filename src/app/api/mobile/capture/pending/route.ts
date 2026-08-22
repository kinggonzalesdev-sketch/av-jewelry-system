import { after, NextResponse } from 'next/server';

import { routePendingCapturesSystem } from '@/lib/capture/auto-router';
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
    // Technical-only direct-print diagnostic (no PII) — persisted to capture_records.print_diag.
    printDiag: body.printDiag ?? null,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  // IMMEDIATE server-side autosend attempt (Owner 2026-08-22): don't wait for the 1-minute cron —
  // AFTER the response (never blocking the phone's fast capture path), run one durable routing sweep
  // so a capture whose exact Live comment already arrived auto-sends within ~1s. Idempotent (atomic
  // DB claims + backoff), so this and the cron can never send a duplicate photo or Private Reply.
  after(async () => {
    try {
      await routePendingCapturesSystem();
    } catch {
      /* best-effort — the every-minute cron is the durable recovery fallback */
    }
  });

  return NextResponse.json(result);
}
