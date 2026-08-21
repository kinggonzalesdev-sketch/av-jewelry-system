import 'server-only';

import { hashShareToken } from '@/lib/capture/share-link';
import { createAdminClient } from '@/lib/supabase/admin';

const BUCKET = 'attachments';

/**
 * Resolve a raw /m token to a short-lived signed screenshot URL, or null when the link is invalid /
 * expired / revoked / missing its screenshot. The public /m page has NO user session, so this uses
 * the service-role client (server-only boundary) — but returns ONLY the signed image URL, never the
 * token, the storage path, or any customer/order/comment identifier. The private bucket stays
 * private; the signed URL lives 5 minutes.
 */
export async function resolveSharedScreenshotUrl(rawToken: string): Promise<string | null> {
  const raw = (rawToken ?? '').trim();
  if (!raw) return null;
  try {
    const admin = createAdminClient();
    const { data } = (await admin.rpc('resolve_capture_share_link', {
      p_token_hash: hashShareToken(raw),
    })) as { data: { valid?: boolean; screenshot_path?: string } | null };
    if (!data?.valid || !data.screenshot_path) return null;
    const signed = await admin.storage.from(BUCKET).createSignedUrl(data.screenshot_path, 300);
    return signed.data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
