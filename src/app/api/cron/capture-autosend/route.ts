import { NextResponse } from 'next/server';

import { secretMatches } from '@/lib/security/secret-compare';

import {
  routePendingCapturesSystem,
  runWaitingTextReplyFallbackSystem,
} from '@/lib/capture/auto-router';

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
  if (!secretMatches(auth ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  // ONE deadline for everything this run does, well inside maxDuration (60s): no step starts an
  // attempt that could be killed mid-send.
  const deadlineAt = Date.now() + 50_000;
  const result = await routePendingCapturesSystem(15, { deadlineAt });
  // Screenshot-first (Owner 2026-09-24): the once-a-minute safety net for a missed reply webhook.
  // It runs here only (not per Live comment) and regardless of the sweep guard. Best-effort.
  let replyFallback = { sent: 0, considered: 0 };
  try {
    replyFallback = await runWaitingTextReplyFallbackSystem({ deadlineAt });
  } catch {
    /* best-effort — the reply webhook is the primary path */
  }
  return NextResponse.json({ ...result, replyFallback }, { status: 200 });
}
