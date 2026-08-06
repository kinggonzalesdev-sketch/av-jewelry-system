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
