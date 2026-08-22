import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isConversationMediaEligible, psidFromConversationId } from '@/lib/capture/media-window';
import { attemptSecureLinkPrivateReply } from '@/lib/capture/route-b';
import {
  conversationBelongsToPage,
  getActivePancakePageId,
  sendPancakeConversationMessage,
} from '@/lib/integrations/pancake';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * DURABLE, SERVER-SIDE capture auto-router (Owner 2026-08-22, P0-B).
 *
 * Healthy messaging must NOT depend on the Incoming Captures modal being open, a browser tab, an
 * operator click, or a client React retry loop. This runs from a Vercel Cron (see vercel.json →
 * /api/cron/capture-autosend) as the service_role, so a chat-linked capture is routed within a
 * minute whether or not anyone is looking. It reuses the EXACT verified send paths:
 *   • ROUTE A — the customer has a genuine recent Inbox DM (media-eligible) → the actual screenshot
 *     PHOTO via the existing reply_inbox flow. One-photo idempotency is enforced by the atomic DB
 *     claim (claim_capture_photo_send). Persists "AUTO SS Sent to Messenger ✓".
 *   • ROUTE B — not Inbox-eligible but an EXACT, privately-replyable Live comment resolves → ONE
 *     Pancake Private Reply TEXT with the secure /m link (the SAME verified sender Controlled Test B
 *     uses; resolved by the capture's exact PSID). One-reply idempotency is enforced by the atomic
 *     share-link claim. Persists "AUTO TEXT Sent to Messenger ✓". The customer STAYS "Photo waiting"
 *     — a TEXT reply never fakes Photo-ready.
 *   • NEITHER yet (comment webhook lag) → parked 'awaiting_inbox' for a BOUNDED, backed-off retry;
 *     after the budget the DB moves it to a FINITE 'failed' with a human-safe reason (never a
 *     permanent spinner). Needs-Review captures are never selected, so nothing is ever sent merely
 *     because a screenshot exists.
 *
 * Idempotency across overlapping cron runs / two PCs / two phones / duplicate webhooks is guaranteed
 * at the DB layer (claim_captures_to_route FOR UPDATE SKIP LOCKED + the atomic photo/share-link
 * claims). This function only orchestrates.
 */

const CAPTURE_BUCKET = 'attachments';

function ocrStr(ocr: unknown, ...keys: string[]): string | null {
  if (!ocr || typeof ocr !== 'object') return null;
  const o = ocr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

type RouterCapture = {
  id: string;
  ocr: unknown;
  screenshot_path: string | null;
  pancake_conversation_id: string | null;
  message_status: string | null;
};

export type RouteOutcome =
  | 'photo_sent'
  | 'photo_failed'
  | 'text_sent'
  | 'already_sent'
  | 'in_progress'
  | 'awaiting'
  | 'skipped';

/** Map a Route B result code to a FINITE, operator-safe reason (no tokens/PSIDs/ids). */
function routeBReason(code: string): string {
  switch (code) {
    case 'no_exact_comment':
    case 'no_replyable_comment':
    case 'no_match':
    case 'multiple_comments_no_value':
    case 'ambiguous_claim':
    case 'ambiguous_identity':
      return 'AUTO TEXT pending · awaiting comment context';
    case 'in_progress':
      return 'AUTO TEXT sending…';
    case 'outside_window':
      return 'AUTO TEXT Failed · outside the 7-day reply window';
    case 'no_key':
      return 'AUTO TEXT Failed · secure-link key not configured';
    case 'no_screenshot':
      return 'AUTO TEXT Failed · no screenshot';
    case 'revoked':
      return 'AUTO TEXT Failed · link revoked';
    default:
      return 'AUTO TEXT Failed · Pancake rejected';
  }
}

async function setRouteReason(
  admin: SupabaseClient,
  id: string,
  reason: string,
): Promise<void> {
  // Through the service-role-gated RPC (not a raw table mutation) — keeps every router write behind
  // a DEFINER guard, and satisfies the write-boundary invariant.
  await admin.rpc('set_capture_route_reason', { p_capture_id: id, p_reason: reason });
}

/** Route ONE claimed capture. Returns its outcome for the cron summary (no PII). */
async function routeOne(
  admin: SupabaseClient,
  activePage: string,
  cap: RouterCapture,
): Promise<{ outcome: RouteOutcome; reason: string }> {
  const id = cap.id;
  const conversationId = (cap.pancake_conversation_id ?? '').trim();
  const path = (cap.screenshot_path ?? '').trim();
  const fbName = ocrStr(cap.ocr, 'fbName', 'fb_name', 'name') ?? '';
  const value = ocrStr(cap.ocr, 'itemQuery', 'grams', 'weight');

  if (!path) {
    await admin.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'awaiting_inbox' });
    await setRouteReason(admin, id, 'AUTO not sent · no screenshot');
    return { outcome: 'awaiting', reason: 'no_screenshot' };
  }

  // A real on-page inbox conversation enables Route A (photo eligibility) + resolution by exact PSID.
  const onPageConv =
    conversationId && conversationBelongsToPage(conversationId, activePage) ? conversationId : null;

  // ROUTE A — genuine media eligibility → actual screenshot PHOTO (never a secure link instead).
  if (onPageConv) {
    const eligible = await isConversationMediaEligible(admin, onPageConv);
    if (eligible) {
      const signed = (await admin.storage
        .from(CAPTURE_BUCKET)
        .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
      const attachmentUrl = signed.data?.signedUrl ?? null;
      if (!attachmentUrl) {
        await admin.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'awaiting_inbox' });
        await setRouteReason(admin, id, 'AUTO SS pending · screenshot URL unavailable');
        return { outcome: 'awaiting', reason: 'no_signed_url' };
      }
      const claim = (
        await admin.rpc('claim_capture_photo_send', {
          p_capture_id: id,
          p_conversation_id: onPageConv,
        })
      ).data as string;
      if (claim === 'already_sent') {
        await setRouteReason(admin, id, 'AUTO SS Sent to Messenger ✓');
        return { outcome: 'already_sent', reason: 'already_sent' };
      }
      if (claim !== 'claimed') return { outcome: 'in_progress', reason: 'photo_in_progress' };

      const res = await sendPancakeConversationMessage({
        conversationId: onPageConv,
        message: '',
        attachmentUrl,
      });
      await admin.rpc('finalize_capture_photo_send', {
        p_capture_id: id,
        p_ok: res.ok,
        p_pancake_message_id: res.pancakeMessageId,
        p_conversation_id: onPageConv,
      });
      await setRouteReason(
        admin,
        id,
        res.ok ? 'AUTO SS Sent to Messenger ✓' : `AUTO SS Failed · ${res.code}`,
      );
      return { outcome: res.ok ? 'photo_sent' : 'photo_failed', reason: res.code };
    }
  }

  // ROUTE B — secure-link Private Reply TEXT to the EXACT resolved Live comment (verified Test-B
  // contract). Keyed off the exact PSID when we have the conversation, else resolved BY NAME
  // (resolve_exact_live_comment gates unique-PSID + can_reply_privately, else Needs Review) — so a
  // capture the PC never opened still auto-sends, fully server-side.
  const psid = onPageConv ? psidFromConversationId(onPageConv) : null;
  if (!psid && !fbName) {
    await admin.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'awaiting_inbox' });
    await setRouteReason(admin, id, 'AUTO TEXT pending · awaiting comment context');
    return { outcome: 'awaiting', reason: 'no_identity' };
  }
  const rb = await attemptSecureLinkPrivateReply({
    supabase: admin,
    captureRecordId: id,
    fbName,
    value,
    screenshotPath: path,
    psid,
  });
  if (rb.ok) {
    await admin.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'link_sent' });
    await setRouteReason(admin, id, 'AUTO TEXT Sent to Messenger ✓');
    return { outcome: rb.code === 'already_sent' ? 'already_sent' : 'text_sent', reason: rb.code };
  }
  // Not sendable yet (comment webhook lag) OR a finite failure — keep 'awaiting_inbox' for the
  // bounded retry; the DB moves it to 'failed' once the attempt budget/age is spent.
  await admin.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'awaiting_inbox' });
  await setRouteReason(admin, id, routeBReason(rb.code));
  return { outcome: 'awaiting', reason: rb.code };
}

export type AutoRouteSummary = {
  ok: boolean;
  claimed: number;
  exhausted: number;
  outcomes: Record<string, number>;
};

/**
 * ONE durable routing sweep: atomically claim a bounded batch of chat-linked, unsent captures and
 * route each (A photo / B text), then move any budget-exhausted/aged capture to a finite 'failed'.
 * Service-role; safe to run concurrently (DB claims prevent double-processing). Returns a PII-free
 * summary for the cron log.
 */
export async function routePendingCapturesSystem(limit = 15): Promise<AutoRouteSummary> {
  const admin = createAdminClient();
  const activePage = await getActivePancakePageId();
  const claimRes = (await admin.rpc('claim_captures_to_route', { p_limit: limit })) as {
    data: RouterCapture[] | null;
  };
  const caps = claimRes.data ?? [];

  const outcomes: Record<string, number> = {};
  for (const cap of caps) {
    let outcome: RouteOutcome = 'skipped';
    try {
      ({ outcome } = await routeOne(admin, activePage, cap));
    } catch {
      outcome = 'skipped';
    }
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  const exhaustedRes = (await admin.rpc('mark_captures_route_exhausted')) as {
    data: number | null;
  };
  const exhausted = exhaustedRes.data;
  return {
    ok: true,
    claimed: caps.length,
    exhausted: typeof exhausted === 'number' ? exhausted : 0,
    outcomes,
  };
}
