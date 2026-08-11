import { NextResponse } from 'next/server';

import { ingestPancakeWebhookEvent } from '@/lib/integrations/pancake-webhook';

export const dynamic = 'force-dynamic';

/**
 * Pancake webhook (A.1) — realtime customer identity from live messages/comments.
 *
 * SECURITY: gated on PANCAKE_WEBHOOK_SECRET (a shared secret you set in the env AND in
 * the Pancake webhook config). Fails CLOSED: if the secret is unset the endpoint does
 * nothing (503). The write it performs is strictly NON-DESTRUCTIVE — it only fills a
 * missing link for a unique exact-name customer and refreshes the avatar; it never
 * resets an existing link and never creates a customer.
 *
 * Provide the secret as the `x-webhook-secret` header or a `?secret=` query param.
 * GET echoes a `challenge`/`hub.challenge` param (for providers that verify on setup).
 */
function checkSecret(
  request: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.PANCAKE_WEBHOOK_SECRET;
  if (!secret || !secret.trim()) {
    return { ok: false, status: 503, error: 'PANCAKE_WEBHOOK_SECRET is not configured.' };
  }
  const url = new URL(request.url);
  const provided =
    request.headers.get('x-webhook-secret') ?? url.searchParams.get('secret') ?? '';
  if (provided !== secret) return { ok: false, status: 401, error: 'Unauthorized.' };
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

  const result = await ingestPancakeWebhookEvent(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
