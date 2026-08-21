'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { isConversationMediaEligible } from '@/lib/capture/media-window';
import { listPendingCaptures } from '@/lib/capture/pending';
import {
  sendPendingCaptureToMessenger,
  type SendCaptureToMessengerResult,
} from '@/lib/capture/pc-send';
import {
  resolveAndPersistCaptureLink,
  persistCaptureLink,
  listCaptureCandidates,
  resolveChosenCustomer,
  type CaptureLink,
} from '@/lib/capture/pending-link';
import { autoSendCaptureForOrder } from '@/lib/orders/for-invoice';
import type {
  CaptureCandidateOption,
  CaptureLinkResult,
  PendingCaptureRow,
} from '@/lib/capture/pending-types';

/** Load the floating captures waiting to be turned into orders (realtime-refreshed). */
export async function loadPendingCapturesAction(): Promise<PendingCaptureRow[]> {
  return listPendingCaptures();
}

/** Attach a pending capture to the order the operator just created from it, so Send
 *  Invoice auto-attaches the mined-item screenshot. */
export async function linkCaptureToOrderAction(
  captureRecordId: string,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!captureRecordId || !orderId) return { ok: false, error: 'Missing ids.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { error } = await supabase.rpc('link_capture_to_order', {
    p_capture_record_id: captureRecordId,
    p_order_id: orderId,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  // Deliver the mined screenshot to the buyer NOW — if the order (via inheritance) or
  // the customer already has a Pancake conversation, it sends immediately, so no Send
  // Invoice click is needed. Idempotent: a capture already sent (phone / prior link)
  // is skipped. Best-effort so linking always succeeds.
  await autoSendCaptureForOrder(orderId).catch(() => undefined);
  revalidatePath('/orders');
  return { ok: true };
}

/**
 * Manually send a pending capture's screenshot to the customer's Messenger from the
 * PC station — the backup/retry entry point for a "Photo ready" capture (an eligible
 * customer normally auto-sends without any click). Resolves the conversation from the
 * OCR'd Facebook name, sends through the backend (token stays server-side), and is
 * idempotent. It gates on the SAME media window as the auto path (`requireMediaWindow:
 * true`): a "Photo waiting" (silent/comment-only/outside-24h) capture is parked
 * 'awaiting_inbox' and sends NOTHING — no doomed reply_inbox PHOTO, no "Pancake
 * rejected" — so the operator uses Open FB Chat instead (Owner request 2026-08-20).
 */
export async function sendCaptureToMessengerAction(
  captureRecordId: string,
): Promise<SendCaptureToMessengerResult> {
  const result = await sendPendingCaptureToMessenger(captureRecordId, {
    requireMediaWindow: true,
  });
  if (result.ok) revalidatePath('/orders');
  return result;
}

/** OCR'd Facebook name off a capture's stored OCR JSON. */
function ocrName(ocr: unknown): string {
  if (ocr && typeof ocr === 'object') {
    const o = ocr as Record<string, unknown>;
    for (const k of ['fbName', 'fb_name', 'name']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return '';
}

const FAIL_LINK: CaptureLinkResult = {
  ok: false,
  linkStatus: null,
  linkedCustomerId: null,
  linkedCustomerName: null,
  conversationAvailable: false,
  fbUrl: null,
  matchCount: 0,
  sent: false,
  photoEligible: false,
};

function toLinkResult(
  link: CaptureLink,
  sent: boolean,
  photoEligible: boolean,
): CaptureLinkResult {
  return {
    ok: true,
    linkStatus: link.linkStatus,
    linkedCustomerId: link.customerId,
    linkedCustomerName: link.customerName,
    conversationAvailable: link.conversationAvailable,
    fbUrl: link.fbUrl,
    matchCount: link.matchCount,
    sent,
    photoEligible,
  };
}

/** Genuine-Inbox-DM photo eligibility for a resolved link (false unless it's a `linked`
 *  conversation with a real customer Inbox DM in the window). Never throws. */
async function linkPhotoEligible(
  supabase: SupabaseClient,
  link: CaptureLink,
): Promise<boolean> {
  const conv = (link.conversationId ?? '').trim();
  if (link.linkStatus !== 'linked' || !conv) return false;
  return isConversationMediaEligible(supabase, conv).catch(() => false);
}

type PendingCaptureLite = {
  is_test?: boolean | null;
  message_status?: string | null;
  source?: string | null;
  official_order_id?: string | null;
  ocr?: unknown;
  pancake_conversation_id?: string | null;
};

/**
 * Auto-send the screenshot for a freshly-'linked' capture — ONLY when a unique customer +
 * conversation is confirmed (never an ambiguous name), never for a Test capture, and never twice.
 * Gated on the MEDIA WINDOW (`requireMediaWindow`): an automatic screenshot PHOTO is attempted
 * only when the customer already has a customer-initiated inbox interaction (Controlled Test B);
 * a comment-only customer is parked 'awaiting_inbox' and NOT auto-sent. One-capture-one-photo is
 * enforced atomically in the DB, not by this guard. Best-effort: the manual 📨 Send remains.
 */
async function maybeAutoSend(
  captureRecordId: string,
  link: CaptureLink,
  cap: PendingCaptureLite,
): Promise<boolean> {
  if (
    link.linkStatus !== 'linked' ||
    cap.is_test === true ||
    cap.message_status === 'sent'
  ) {
    return false;
  }
  try {
    const res = await sendPendingCaptureToMessenger(captureRecordId, {
      requireMediaWindow: true,
    });
    return res.ok && res.code === 'sent';
  } catch {
    return false;
  }
}

/**
 * Capture-time linking: resolve WHO this capture is (customer + Pancake conversation)
 * from the detected Facebook name, persist it on the pending capture, and — when it
 * uniquely resolves — auto-send the screenshot. Called once per capture by the strip
 * the first time it sees an unresolved one. Never guesses an ambiguous name.
 */
export async function resolveCaptureLinkAction(
  captureRecordId: string,
): Promise<CaptureLinkResult> {
  if (!captureRecordId) return { ...FAIL_LINK, error: 'Missing capture.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { data } = await supabase
    .from('capture_records')
    .select(
      'id, ocr, pancake_conversation_id, is_test, message_status, source, official_order_id',
    )
    .eq('id', captureRecordId)
    .maybeSingle();
  const cap = (data as PendingCaptureLite | null) ?? null;
  if (!cap || cap.source !== 'floating' || cap.official_order_id) {
    return { ...FAIL_LINK, error: 'That capture is no longer pending.' };
  }

  const link = await resolveAndPersistCaptureLink(
    supabase,
    captureRecordId,
    ocrName(cap.ocr),
    cap.pancake_conversation_id ?? null,
  );
  const sent = await maybeAutoSend(captureRecordId, link, cap);
  const photoEligible = await linkPhotoEligible(supabase, link);
  revalidatePath('/orders');
  return toLinkResult(link, sent, photoEligible);
}

/** The operator explicitly links this capture to a chosen customer (confirm / Change). */
export async function setCaptureCustomerAction(
  captureRecordId: string,
  customerId: string,
): Promise<CaptureLinkResult> {
  if (!captureRecordId || !customerId) return { ...FAIL_LINK, error: 'Missing ids.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { data } = await supabase
    .from('capture_records')
    .select('id, is_test, message_status, source, official_order_id')
    .eq('id', captureRecordId)
    .maybeSingle();
  const cap = (data as PendingCaptureLite | null) ?? null;
  if (!cap || cap.source !== 'floating' || cap.official_order_id) {
    return { ...FAIL_LINK, error: 'That capture is no longer pending.' };
  }
  const link = await resolveChosenCustomer(supabase, customerId);
  await persistCaptureLink(supabase, captureRecordId, link);
  const sent = await maybeAutoSend(captureRecordId, link, cap);
  const photoEligible = await linkPhotoEligible(supabase, link);
  revalidatePath('/orders');
  return toLinkResult(link, sent, photoEligible);
}

/** Remove the customer link from a capture (operator says "not this person"). */
export async function clearCaptureLinkAction(
  captureRecordId: string,
): Promise<CaptureLinkResult> {
  if (!captureRecordId) return { ...FAIL_LINK, error: 'Missing capture.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  await persistCaptureLink(supabase, captureRecordId, {
    linkStatus: 'no_match',
    customerId: null,
    conversationId: null,
  });
  revalidatePath('/orders');
  return {
    ok: true,
    linkStatus: 'no_match',
    linkedCustomerId: null,
    linkedCustomerName: null,
    conversationAvailable: false,
    fbUrl: null,
    matchCount: 0,
    sent: false,
    photoEligible: false,
  };
}

/** Same-name customers the operator can pick from (needs-confirmation / Change). */
export async function listCaptureCandidatesAction(
  captureRecordId: string,
): Promise<CaptureCandidateOption[]> {
  if (!captureRecordId) return [];
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { data } = await supabase
    .from('capture_records')
    .select('ocr')
    .eq('id', captureRecordId)
    .maybeSingle();
  const name = ocrName((data as { ocr?: unknown } | null)?.ocr);
  if (!name) return [];
  const candidates = await listCaptureCandidates(supabase, name);
  return candidates.map((c) => ({
    customerId: c.customerId,
    displayName: c.displayName,
    contactNumber: c.contactNumber,
    hasConversation: c.hasConversation,
    avatarUrl: c.avatarUrl,
  }));
}

/** One claimed capture sticker to print (shared PC+phone queue), or nothing waiting. */
export type CaptureStickerClaim =
  | {
      claimed: true;
      captureRecordId: string;
      fbName: string;
      grams: string | null;
      /** The RAW captured value ("11.5" / "15k" / "15,000") for grams-vs-fixed classification. */
      value: string | null;
    }
  | { claimed: false };

/**
 * Claim the next capture sticker for THIS PC (shared PC+phone print queue). The DB
 * hands each eligible capture to ONE device (FOR UPDATE SKIP LOCKED), so a PC and a
 * phone can both be set up and whoever is active prints each sticker exactly once —
 * never twice. The caller prints it via Bluetooth, then marks it printed / released.
 */
export async function claimCaptureStickerAction(): Promise<CaptureStickerClaim> {
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { data } = (await supabase.rpc('claim_next_capture_sticker', {
    p_device: 'pc-web',
  })) as {
    data: {
      claimed?: boolean;
      capture_record_id?: string;
      fb_name?: string;
      grams?: string;
      value?: string;
    } | null;
  };
  if (!data || data.claimed !== true || !data.capture_record_id)
    return { claimed: false };
  return {
    claimed: true,
    captureRecordId: data.capture_record_id,
    fbName: (data.fb_name ?? '').trim(),
    grams: (data.grams ?? '').trim() || null,
    value: (data.value ?? '').trim() || null,
  };
}

/** Mark a claimed capture sticker printed (so no device reprints it). */
export async function markCaptureStickerPrintedAction(
  captureRecordId: string,
): Promise<void> {
  if (!captureRecordId) return;
  await requirePermission('claim_capture');
  const supabase = await createClient();
  await supabase.rpc('mark_capture_sticker_printed', {
    p_capture_record_id: captureRecordId,
  });
}

/** Release a claimed capture sticker (print failed) so another device can take it. */
export async function releaseCaptureStickerAction(
  captureRecordId: string,
): Promise<void> {
  if (!captureRecordId) return;
  await requirePermission('claim_capture');
  const supabase = await createClient();
  await supabase.rpc('release_capture_sticker', { p_capture_record_id: captureRecordId });
}

/** Discard a junk pending capture (no order created from it). */
export async function dismissPendingCaptureAction(
  captureRecordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!captureRecordId) return { ok: false, error: 'Missing id.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { error } = await supabase.rpc('dismiss_pending_capture', {
    p_capture_record_id: captureRecordId,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  revalidatePath('/orders');
  return { ok: true };
}
