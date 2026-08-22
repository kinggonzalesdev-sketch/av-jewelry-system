import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { isConversationMediaEligible } from '@/lib/capture/media-window';
import { sanitizeLeadingNameGlyph } from '@/lib/capture/name-sanitize';
import { attemptSecureLinkPrivateReply } from '@/lib/capture/route-b';
import {
  conversationBelongsToPage,
  getActivePancakePageId,
  resolveConversationForName,
  sendPancakeConversationMessage,
} from '@/lib/integrations/pancake';

/**
 * PC "Send to Messenger" for a pending Incoming Capture — a SCREENSHOT delivery. It resolves the
 * customer's REAL Pancake conversation (a stored id ON THE ACTIVE PAGE, else the OCR'd Facebook
 * name via the SAME unique-match resolver the mobile route uses — never a name-only guess, never
 * a synthesized {page_id}_{psid}), signs the screenshot, and sends it THROUGH the MineFlow
 * backend so the Pancake token never reaches the browser.
 *
 * Hardening (Owner request 2026-08-18):
 *   - NO text fallback. A screenshot delivery is PHOTO or NO-SEND/REVIEW — it is NEVER silently
 *     downgraded to "Reserved"/"Reserved ✔️"/arbitrary text. A missing screenshot, an unavailable
 *     signed URL, or an upload failure marks the capture 'failed' (reviewable/retryable) and
 *     sends NOTHING.
 *   - Media window: BOTH the automatic and the manual Send gate on the SAME check
 *     (`requireMediaWindow` → isConversationMediaEligible). A normal reply_inbox PHOTO is only
 *     attempted when the customer already has a customer-initiated inbox interaction ("Photo
 *     ready"). A silent/comment-only/outside-24h customer ("Photo waiting") is parked
 *     'awaiting_inbox' and NOTHING is sent — no doomed attempt, no "Pancake rejected"; the
 *     operator uses Open FB Chat instead. The function still supports an ungated call, but the
 *     only manual entry point (`sendCaptureToMessengerAction`) now passes requireMediaWindow:true,
 *     so manual and auto stay consistent (Owner request 2026-08-20).
 *   - One capture = one photo: an atomic DB claim/finalize (message_status 'sending' → 'sent' /
 *     'failed') rejects a concurrent auto/manual/double-click/repeat-resolver duplicate.
 */

const CAPTURE_BUCKET = 'attachments';

/** Read one string field off the (untyped) OCR JSON, tolerating shape/casing. */
function ocrStr(ocr: unknown, ...keys: string[]): string | null {
  if (!ocr || typeof ocr !== 'object') return null;
  const o = ocr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export type SendCaptureToMessengerResult =
  | { ok: true; code: 'sent' | 'already_sent'; message: string }
  | { ok: false; code: string; error: string };

export async function sendPendingCaptureToMessenger(
  captureRecordId: string,
  opts?: { requireMediaWindow?: boolean },
): Promise<SendCaptureToMessengerResult> {
  // Same gate as viewing captures — a claim_capture holder operating the PC station.
  await requirePermission('claim_capture');
  const supabase = await createClient();

  const id = (captureRecordId ?? '').trim();
  if (!id) return { ok: false, code: 'bad_request', error: 'A capture is required.' };

  const { data, error } = await supabase
    .from('capture_records')
    .select('id, screenshot_path, ocr, message_status, pancake_conversation_id')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, code: 'not_found', error: 'That capture could not be found.' };
  }

  const row = data as {
    screenshot_path: string | null;
    ocr: unknown;
    message_status: string | null;
    pancake_conversation_id: string | null;
  };

  // Idempotent for the ACTUAL PHOTO: never resend once a photo has gone out ('sent'). A capture that
  // only got the Route B secure-link TEXT ('link_sent') is NOT blocked here (Owner 2026-08-22): if
  // the customer later becomes Photo-ready, the operator may still deliver the actual screenshot
  // PHOTO. One-photo-per-capture is still guaranteed downstream by claim_capture_photo_send (it
  // claims only from a non-'sent' state), and Route B re-entry stays idempotent (the existing link is
  // already 'sent' → no second Private Reply).
  if (row.message_status === 'sent') {
    return {
      ok: true,
      code: 'already_sent',
      message: 'Already sent — not resent.',
    };
  }

  // Strip a phantom leading O/0/° so name-based conversation matching + Route B use the real name.
  const fbName = sanitizeLeadingNameGlyph(ocrStr(row.ocr, 'fbName', 'fb_name', 'name')) || null;

  // Resolve the conversation: prefer a stored one — but ONLY if it lives on the active send page
  // (a link on another page is undeliverable). Otherwise resolve from the OCR'd Facebook name
  // (page-aware, UNIQUE match only — never guessing an ambiguous name, never a synthetic id).
  const activePage = await getActivePancakePageId();
  let conversationId = (row.pancake_conversation_id ?? '').trim() || null;
  if (conversationId && !conversationBelongsToPage(conversationId, activePage)) {
    conversationId = null;
  }
  if (!conversationId) {
    if (!fbName) {
      return {
        ok: false,
        code: 'name_missing',
        error: 'No Facebook name was read — open it with Use and pick the customer.',
      };
    }
    const resolved = await resolveConversationForName(supabase, fbName, {
      sinceDays: 14,
      maxPages: 12,
    });
    conversationId = resolved.conversationId;
    if (!conversationId) {
      if (resolved.matchCount > 1) {
        return {
          ok: false,
          code: 'ambiguous',
          error: `"${fbName}" matches ${resolved.matchCount} people — link the customer first, then send.`,
        };
      }
      return {
        ok: false,
        code: 'conversation_missing',
        error: `No Messenger chat found for "${fbName}". Link the customer in Customers, then try again.`,
      };
    }
  }

  // SCREENSHOT REQUIRED — no text fallback. A missing screenshot or an unavailable signed URL is
  // marked reviewable; NOTHING is sent (never "Reserved").
  const path = (row.screenshot_path ?? '').trim() || null;
  if (!path) {
    await supabase.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'failed' });
    return {
      ok: false,
      code: 'no_screenshot',
      error: 'No screenshot on this capture — marked for review (no text was sent).',
    };
  }
  const signed = (await supabase.storage
    .from(CAPTURE_BUCKET)
    .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
  const attachmentUrl = signed.data?.signedUrl ?? null;
  if (!attachmentUrl) {
    await supabase.rpc('mark_capture_photo_state', { p_capture_id: id, p_status: 'failed' });
    return {
      ok: false,
      code: 'screenshot_unavailable',
      error: 'Screenshot URL unavailable — marked for review (no text was sent).',
    };
  }

  // MEDIA WINDOW — a normal reply_inbox PHOTO is only attempted when the customer already has a
  // customer-initiated inbox interaction ("Photo ready"). Otherwise park 'awaiting_inbox' and send
  // NOTHING ("Photo waiting" → Open FB Chat). BOTH auto and manual pass requireMediaWindow:true, so
  // neither fires a doomed send / "Pancake rejected" for a known-ineligible customer.
  if (opts?.requireMediaWindow) {
    const eligible = await isConversationMediaEligible(supabase, conversationId);
    if (!eligible) {
      // ROUTE B — not Inbox-media-eligible ("Photo waiting"): if MineFlow can prove the EXACT Live
      // comment identity, create/reuse a secure screenshot link and send ONE Pancake Private Reply
      // TEXT (idempotent, atomic — never two replies). No exact comment / outside the 7-day window
      // → Route C: park 'awaiting_inbox' for Open FB Chat. Never a doomed reply_inbox PHOTO here.
      const rb = await attemptSecureLinkPrivateReply({
        supabase,
        captureRecordId: id,
        fbName: fbName ?? '',
        value: ocrStr(row.ocr, 'itemQuery', 'grams', 'weight'),
        screenshotPath: path,
      });
      if (rb.ok) {
        await supabase.rpc('mark_capture_photo_state', {
          p_capture_id: id,
          p_status: 'link_sent',
        });
        return {
          ok: true,
          code: rb.code === 'already_sent' ? 'already_sent' : 'sent',
          message:
            rb.code === 'already_sent'
              ? 'Secure link already sent — not resent.'
              : 'Sent a secure screenshot link via Private Reply ✓',
        };
      }
      await supabase.rpc('mark_capture_photo_state', {
        p_capture_id: id,
        p_status: 'awaiting_inbox',
      });
      return { ok: false, code: 'awaiting_inbox', error: rb.message };
    }
  }

  // ONE CAPTURE = ONE PHOTO — atomic claim; a concurrent auto/manual/double-click duplicate is
  // rejected here (DB compare-and-set), not merely by a disabled UI button.
  const claimRes = (await supabase.rpc('claim_capture_photo_send', {
    p_capture_id: id,
    p_conversation_id: conversationId,
  })) as { data?: unknown };
  const claim = claimRes.data;
  if (claim === 'already_sent') {
    return {
      ok: true,
      code: 'already_sent',
      message: 'Already sent to Messenger — not resent.',
    };
  }
  if (claim !== 'claimed') {
    // 'in_progress' (another send holds the claim) or 'not_found' → do NOT send a duplicate.
    return {
      ok: false,
      code: typeof claim === 'string' ? claim : 'claim_failed',
      error: 'Another send for this capture is already in progress.',
    };
  }

  // Send the SCREENSHOT as a PHOTO (message intentionally EMPTY — reply_inbox carries the photo
  // via content_ids; a failed upload early-returns and NEVER falls back to text).
  const result = await sendPancakeConversationMessage({
    conversationId,
    message: '',
    attachmentUrl,
  });

  // Finalize the claim: 'sent' on confirmed Pancake success, else 'failed' (reviewable/retryable).
  await supabase.rpc('finalize_capture_photo_send', {
    p_capture_id: id,
    p_ok: result.ok,
    p_pancake_message_id: result.pancakeMessageId,
    p_conversation_id: conversationId,
  });

  if (!result.ok) {
    // Persist the EXACT Pancake response (token-free `debug`) so a rejected send is diagnosable.
    const debug = (result as { debug?: string }).debug ?? null;
    await recordAuditEvent({
      action: 'capture.send_failed',
      entityType: 'capture_record',
      entityId: id,
      outcome: 'failed',
      reason: `INBOX_PHOTO:${result.code}`,
      context: { stage: 'INBOX_PHOTO', code: result.code, conversationId, hadAttachment: true, debug },
    }).catch(() => undefined);
    return { ok: false, code: result.code, error: result.message };
  }
  return { ok: true, code: 'sent', message: 'Sent to Messenger ✓' };
}
