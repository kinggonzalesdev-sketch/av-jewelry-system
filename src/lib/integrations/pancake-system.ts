import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildPancakeSyncMessage,
  fetchPancakeConversationsCore,
  getPancakeLinkCoverage,
  type PancakeSyncResult,
} from '@/lib/integrations/pancake';

/**
 * SYSTEM (no user session) Pancake→customer link sync — the daily cron path.
 *
 * The Owner-facing `syncPancakeConversationsToCustomers` runs under the signed-in
 * Owner and links via the role-gated `sync_pancake_conversations` RPC. The daily cron
 * has NO session, so this variant:
 *   1. fetches conversations with the un-gated core (server env token), and
 *   2. links via `sync_pancake_conversations_system`, a service-role-only RPC.
 *
 * Its authority comes from the CALLER: the cron route must verify `CRON_SECRET`
 * BEFORE calling this. The service-role client bypasses RLS, so this must never be
 * exposed to a user path.
 */
export async function syncPancakeConversationsSystem(): Promise<PancakeSyncResult> {
  const conv = await fetchPancakeConversationsCore();
  if (!conv.ok) {
    const detail = conv.debug ? `\n\nPancake response: ${conv.debug}` : '';
    return { ok: false, message: `${conv.message}${detail}`, matched: 0, total: 0 };
  }

  const pairs = conv.conversations
    .filter((c) => c.customerName && c.customerName.trim())
    .map((c) => ({ name: c.customerName, conversation_id: c.id }));

  if (pairs.length === 0) {
    return {
      ok: true,
      message: 'No named conversations to match.',
      matched: 0,
      total: conv.conversations.length,
    };
  }

  const admin = createAdminClient();
  const { data, error } = (await admin.rpc('sync_pancake_conversations_system', {
    p_pairs: pairs,
  })) as { data: { matched?: number } | null; error: { message: string } | null };

  if (error) {
    return {
      ok: false,
      message: error.message.replace(/^ERROR:\s*/i, '').trim(),
      matched: 0,
      total: conv.conversations.length,
    };
  }

  const matched = Number(data?.matched ?? 0);

  // Refresh profile photos for the just-linked customers too (best-effort, fill-only).
  const avatarPairs = conv.conversations
    .filter((c) => c.avatar && c.avatar.trim())
    .map((c) => ({ conversation_id: c.id, avatar: c.avatar }));
  if (avatarPairs.length > 0) {
    await admin.rpc('set_customer_pancake_avatars_system', { p_pairs: avatarPairs }).then(
      () => undefined,
      () => undefined,
    );
  }

  const { linked, total: totalCustomers } = await getPancakeLinkCoverage(admin);
  return {
    ok: true,
    message: buildPancakeSyncMessage(matched, linked, totalCustomers),
    matched,
    total: conv.conversations.length,
    linkedCustomers: linked,
    totalCustomers,
  };
}

export type WebhookPruneResult = { ok: boolean; deleted: number; message: string };

/**
 * SYSTEM webhook-events retention prune — the daily cron path. `pancake_webhook_events` grows
 * ~8.8k rows / ~17MB per day with no retention, so this deletes events older than the window
 * (default 30 days) via the service-role-only `prune_pancake_webhook_events` RPC (which itself
 * enforces a 7-day safety floor). SAFE: only RECENT events are read functionally (media-eligibility
 * window, conversation resolution) and the (page_id, comment_id) dedup only matters for near-term FB
 * re-deliveries. Authority comes from the CALLER: the cron route must verify CRON_SECRET first.
 */
export async function pruneWebhookEventsSystem(retentionDays = 30): Promise<WebhookPruneResult> {
  const admin = createAdminClient();
  const { data, error } = (await admin.rpc('prune_pancake_webhook_events', {
    retention_days: retentionDays,
  })) as { data: number | null; error: { message: string } | null };

  if (error) {
    return { ok: false, deleted: 0, message: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const deleted = Number(data ?? 0);
  return {
    ok: true,
    deleted,
    message: `Pruned ${deleted} webhook event(s) older than ${retentionDays} days.`,
  };
}
