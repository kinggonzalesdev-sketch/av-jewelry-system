import { NextResponse } from 'next/server';

import { syncPancakeConversationsSystem } from '@/lib/integrations/pancake-system';

export const dynamic = 'force-dynamic';
// The conversation fetch walks several 28-day windows with paced requests, so give it
// room (Vercel caps this at the plan's max; 60s matches the integrations page).
export const maxDuration = 60;

/**
 * GET /api/cron/pancake-sync — daily automatic Pancake→customer link sync.
 *
 * Vercel Cron (see vercel.json) calls this once a day and attaches
 * `Authorization: Bearer $CRON_SECRET` when the CRON_SECRET env var is set. We REQUIRE
 * that header to match, so nobody else can trigger a service-role sync. It fetches
 * recent Pancake conversations and links each uniquely-named one to its customer, so
 * Send Invoice and the one-tap auto-send reach more customers over time without anyone
 * clicking "Sync". Fails closed: if CRON_SECRET is unset, it does nothing.
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

  const result = await syncPancakeConversationsSystem();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
