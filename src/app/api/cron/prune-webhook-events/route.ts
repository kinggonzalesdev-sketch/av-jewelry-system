import { NextResponse } from 'next/server';

import { pruneWebhookEventsSystem } from '@/lib/integrations/pancake-system';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/prune-webhook-events — daily retention prune for `pancake_webhook_events`.
 *
 * The table takes ~8.8k Live-comment webhook rows / ~17MB per day with NO retention, so left alone it
 * balloons into GBs of Supabase DB storage + compute pressure. This deletes events older than 30 days
 * via the service-role-only `prune_pancake_webhook_events` RPC. SAFE: only RECENT events are read
 * functionally (media-eligibility window, conversation resolution); the (page_id, comment_id) dedup
 * only matters for near-term FB re-deliveries. Nothing is deleted until data actually ages past the
 * window.
 *
 * Vercel Cron (see vercel.json) calls this once a day with `Authorization: Bearer $CRON_SECRET`. We
 * REQUIRE that header, so nobody else can trigger a service-role delete. Fails closed: if CRON_SECRET
 * is unset, it does nothing.
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

  const result = await pruneWebhookEventsSystem(30);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
