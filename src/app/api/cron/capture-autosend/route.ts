import { NextResponse } from 'next/server';

import { routePendingCapturesSystem } from '@/lib/capture/auto-router';

export const dynamic = 'force-dynamic';
// Each capture does at most one Pancake round-trip; a bounded batch fits comfortably in 60s.
export const maxDuration = 60;

/**
 * GET /api/cron/capture-autosend — the DURABLE, server-side capture auto-router (Owner 2026-08-22).
 *
 * Vercel Cron (see vercel.json) calls this every minute with `Authorization: Bearer $CRON_SECRET`.
 * It routes chat-linked, unsent captures with NO dependency on any browser tab / operator click /
 * React retry loop: Route A (actual PHOTO when Inbox-eligible) or Route B (ONE secure-link Private
 * Reply TEXT via the verified Test-B contract), with bounded backoff retries and finite states.
 * Fails closed: if CRON_SECRET is unset, it does nothing.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secret.trim()) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured — set it in the environment.' },
      { status: 503 },
    );
  }
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const result = await routePendingCapturesSystem();
  return NextResponse.json(result, { status: 200 });
}
