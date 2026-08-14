import { NextResponse } from 'next/server';

import {
  logLiveCommentReceipt,
  parsePancakeLiveComment,
  storePancakeLiveComment,
} from '@/lib/integrations/pancake-webhook';

export const dynamic = 'force-dynamic';

/**
 * Pancake webhook — PRODUCTION endpoint, MILESTONE 1: receive Facebook Live comments.
 *
 * SECURITY: gated on PANCAKE_WEBHOOK_SECRET (a shared secret set in the env AND in the
 * Pancake webhook config, passed as `?secret=` or the `x-webhook-secret` header). Fails
 * CLOSED: unset secret → 503; wrong/missing secret → 401. The secret is NEVER logged.
 *
 * WHAT IT DOES (this phase): validate → detect a Live comment (`data.post.type ===
 * 'livestream'`) → store its exact identity fields ONCE (idempotent on page_id +
 * comment_id) in `pancake_webhook_events` → log a sanitized summary → return 200 fast.
 * It creates NO orders, runs NO Capture auto-match, and changes NO existing customer
 * links / conversations / production records — those are later phases. Any other
 * messaging event is acknowledged (200) and ignored. GET echoes a `challenge` /
 * `hub.challenge` param for providers that verify on setup.
 */
function checkSecret(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  // ZERO-DOWNTIME ROTATION: accept EITHER the current secret OR a "next" secret, so the
  // secret can be rotated without a window where Pancake's calls are rejected. To rotate:
  //   1. set PANCAKE_WEBHOOK_SECRET_NEXT to the new value in Vercel + redeploy (both work),
  //   2. change Pancake's webhook ?secret= to the new value (still accepted — no break),
  //   3. confirm comments still flow, then promote NEXT → PANCAKE_WEBHOOK_SECRET, clear NEXT.
  // The secret is NEVER logged; a blank provided secret is never accepted.
  const secrets = [
    process.env.PANCAKE_WEBHOOK_SECRET,
    process.env.PANCAKE_WEBHOOK_SECRET_NEXT,
  ]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0);
  if (secrets.length === 0) {
    return { ok: false, status: 503, error: 'PANCAKE_WEBHOOK_SECRET is not configured.' };
  }
  const url = new URL(request.url);
  const provided = (
    request.headers.get('x-webhook-secret') ??
    url.searchParams.get('secret') ??
    ''
  ).trim();
  if (provided.length === 0 || !secrets.includes(provided)) {
    return { ok: false, status: 401, error: 'Unauthorized.' };
  }
  return { ok: true };
}

export function GET(request: Request): Response {
  const gate = checkSecret(request);
  if (!gate.ok)
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
  const url = new URL(request.url);
  const challenge =
    url.searchParams.get('challenge') ?? url.searchParams.get('hub.challenge');
  if (challenge) return new NextResponse(challenge, { status: 200 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request): Promise<Response> {
  const gate = checkSecret(request);
  if (!gate.ok)
    return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body.' },
      { status: 400 },
    );
  }

  // MILESTONE 1: ONLY receive → validate → store Facebook Live comments → log → 200,
  // fast. No orders, no Capture auto-match, no customer-link changes yet (later phases).
  // We never call a slow Pancake API before acknowledging — just one fast idempotent
  // insert — so the 200 returns well within Pancake's window.
  const live = parsePancakeLiveComment(body);
  if (!live) {
    // Any other messaging event: acknowledge and ignore safely for now.
    logLiveCommentReceipt({ isLive: false, http: 200 });
    return NextResponse.json({ ok: true, ignored: true }, { status: 200 });
  }

  const res = await storePancakeLiveComment(live, body);
  if (!res.ok) {
    // A store failure returns non-200 so Pancake RETRIES; the (page_id, comment_id)
    // unique key makes that retry idempotent (no duplicate row).
    logLiveCommentReceipt({ isLive: true, live, stored: false, http: 500 });
    return NextResponse.json({ ok: false, error: 'store_failed' }, { status: 500 });
  }

  logLiveCommentReceipt({ isLive: true, live, stored: res.stored, http: 200 });
  return NextResponse.json(
    { ok: true, live_comment: true, stored: res.stored },
    { status: 200 },
  );
}
