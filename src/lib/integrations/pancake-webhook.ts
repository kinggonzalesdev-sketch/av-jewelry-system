import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Pancake webhook ingest (A.1). The route gates on PANCAKE_WEBHOOK_SECRET, then hands
 * the raw event here. We parse the person's identity TOLERANTLY (pages.fm event shapes
 * vary) and enrich the customer NON-DESTRUCTIVELY via a service-role RPC: fill a missing
 * link for a unique exact-name customer and refresh the avatar. It never resets an
 * existing link and never creates a customer. Inert until the secret is configured.
 */

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return '';
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export type WebhookIdentity = { conversationId: string; name: string; avatar: string };

/**
 * Pull the conversation id + person name + avatar from an unknown Pancake event.
 * Checks the common envelopes (root, data, message, conversation, payload) and the
 * common person shapes (customer / from / sender / page_customer / recent_sender /
 * customers[0]) so a new payload shape still resolves instead of silently dropping.
 */
export function parsePancakeWebhookIdentity(body: unknown): WebhookIdentity {
  const root = obj(body) ?? {};
  const layers = [root, obj(root.data), obj(root.message), obj(root.conversation), obj(root.payload)]
    .filter((l): l is Record<string, unknown> => l !== null);

  let conversationId = '';
  for (const l of layers) {
    conversationId =
      conversationId ||
      str(l.conversation_id) ||
      str(l.conversationId) ||
      str(l.thread_id) ||
      (l === root ? '' : str(l.id));
  }
  if (!conversationId) conversationId = str(root.id);

  const people: Record<string, unknown>[] = [];
  for (const l of layers) {
    for (const key of ['customer', 'from', 'sender', 'page_customer', 'recent_sender']) {
      const p = obj(l[key]);
      if (p) people.push(p);
    }
    const arr = Array.isArray(l.customers) ? l.customers : [];
    const first = obj(arr[0]);
    if (first) people.push(first);
  }

  let name = '';
  for (const p of people) name = name || str(p.name);
  for (const l of layers) name = name || str(l.customer_name) || str(l.name) || str(l.title);

  let avatar = '';
  for (const p of people) avatar = avatar || str(p.avatar) || str(p.avatar_url) || str(p.picture);

  return { conversationId, name, avatar };
}

export type WebhookIngestResult = { ok: boolean } & Record<string, unknown>;

export async function ingestPancakeWebhookEvent(body: unknown): Promise<WebhookIngestResult> {
  const id = parsePancakeWebhookIdentity(body);
  if (!id.conversationId) return { ok: true, skipped: 'no_conversation' };

  const admin = createAdminClient();
  const { data, error } = (await admin.rpc('webhook_upsert_conversation_identity', {
    p_conversation_id: id.conversationId,
    p_name: id.name || null,
    p_avatar: id.avatar || null,
  })) as { data: unknown; error: { message: string } | null };

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  return { ok: true, result: data };
}
