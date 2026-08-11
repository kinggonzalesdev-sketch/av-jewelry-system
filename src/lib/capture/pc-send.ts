import 'server-only';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  conversationBelongsToPage,
  getActivePancakePageId,
  resolveConversationForName,
  sendPancakeConversationMessage,
} from '@/lib/integrations/pancake';

/**
 * PC "Send to Messenger" for a pending Incoming Capture.
 *
 * The phone's one-tap flow auto-sends the screenshot; this is the PC operator's
 * MANUAL button for when it didn't (no token yet at capture time, an unlinked
 * customer, or a deliberate resend). It resolves the customer's Pancake
 * conversation from the OCR'd Facebook name (the SAME resolver the mobile route
 * uses — never a guess when a name is shared), signs the screenshot, and sends it
 * THROUGH the MineFlow backend so the Pancake token never reaches the browser.
 *
 * Safety: idempotent (a capture already 'sent' is never resent), never sends by an
 * ambiguous name, and records the outcome so a failed send is safely retryable.
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
  messageOverride?: string | null,
): Promise<SendCaptureToMessengerResult> {
  // Same gate as viewing captures — a claim_capture holder operating the PC station.
  await requirePermission('claim_capture');
  const supabase = await createClient();

  const id = (captureRecordId ?? '').trim();
  if (!id) return { ok: false, code: 'bad_request', error: 'A capture is required.' };

  const { data, error } = await supabase
    .from('capture_records')
    .select(
      'id, device_installation_id, capture_id, screenshot_path, ocr, message_status, pancake_message_id, pancake_conversation_id',
    )
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, code: 'not_found', error: 'That capture could not be found.' };
  }

  const row = data as {
    device_installation_id: string | null;
    capture_id: string | null;
    screenshot_path: string | null;
    ocr: unknown;
    message_status: string | null;
    pancake_conversation_id: string | null;
  };

  // Idempotent: never resend a capture that already went out.
  if (row.message_status === 'sent') {
    return {
      ok: true,
      code: 'already_sent',
      message: 'Already sent to Messenger — not resent.',
    };
  }

  const fbName = ocrStr(row.ocr, 'fbName', 'fb_name', 'name');

  // Resolve the conversation: prefer one already stored on the capture — but ONLY if it
  // lives on the active send page (a link on another page is undeliverable). Otherwise
  // resolve from the OCR'd Facebook name (page-aware, never guessing an ambiguous name).
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
      sinceDays: 7,
      maxPages: 8,
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

  // Sign the screenshot (short-lived) so Pancake can fetch it.
  let attachmentUrl: string | null = null;
  const path = (row.screenshot_path ?? '').trim() || null;
  if (path) {
    const signed = (await supabase.storage
      .from(CAPTURE_BUCKET)
      .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
    attachmentUrl = signed.data?.signedUrl ?? null;
  }

  const message = (messageOverride ?? '').trim() || 'Reserved ✔️';
  const result = await sendPancakeConversationMessage({
    conversationId,
    message,
    attachmentUrl,
  });

  // Record the outcome + persist the resolved conversation on the capture (even on a
  // failed send: the target was explicit, so a Retry reuses the same chat). Only when
  // this capture carries the device/capture keys the dispatch function locates by.
  const device = (row.device_installation_id ?? '').trim();
  const capture = (row.capture_id ?? '').trim();
  if (device && capture) {
    await supabase.rpc('update_capture_dispatch', {
      p_device: device,
      p_capture_id: capture,
      p_message_status: result.ok ? 'sent' : 'failed',
      p_print_status: null,
      p_pancake_message_id: result.pancakeMessageId,
      p_screenshot_path: path,
      p_pancake_conversation_id: conversationId,
    });
  }

  if (!result.ok) return { ok: false, code: result.code, error: result.message };
  return { ok: true, code: 'sent', message: 'Sent to Messenger ✓' };
}
