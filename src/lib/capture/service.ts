import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { sendPancakeConversationMessage } from '@/lib/integrations/pancake';

/** Stringify only JSON primitives — never an object (avoids "[object Object]"). */
function numText(v: unknown): string | null {
  if (typeof v === 'number' || typeof v === 'string') return String(v);
  return null;
}

/**
 * MineFlow Capture backend service.
 *
 * Pure server logic behind the mobile endpoints. Every function takes an
 * RLS-scoped Supabase client (from the caller's Bearer token) so the database's
 * row-level security and the SECURITY DEFINER functions remain the real
 * authority — nothing here trusts client-supplied identity or role.
 */

export type CaptureInventoryHit = {
  id: string;
  itemCode: string;
  itemName: string | null;
  grams: string | null;
  unitPrice: string | null;
  size: string | null;
};

/**
 * Search Active Inventory by code / name / type / grams / size. Returns only
 * items that are actually available (never one already committed to an order).
 */
export async function searchActiveInventory(
  supabase: SupabaseClient,
  query: string,
  limit = 25,
): Promise<CaptureInventoryHit[]> {
  const q = (query ?? '').trim();
  let request = supabase
    .from('inventory_items')
    .select('id, item_code, item_name, grams_per_piece, total_price_per_piece, size')
    .eq('is_archived', false)
    .in('availability_status', ['available', 'returned_to_available'])
    .order('item_code', { ascending: true })
    .limit(Math.min(Math.max(limit, 1), 50));

  if (q.length > 0) {
    // Match the code or the name; both are user-facing search keys.
    const safe = q.replace(/[%,]/g, ' ');
    request = request.or(`item_code.ilike.%${safe}%,item_name.ilike.%${safe}%`);
  }

  const { data, error } = (await request) as {
    data: Array<Record<string, unknown>> | null;
    error: unknown;
  };
  if (error || !data) return [];

  return data.map((r) => {
    const itemCode = (r.item_code as string) ?? '';
    const grams = numText(r.grams_per_piece) ?? parseInventoryCode(itemCode).grams;
    return {
      id: r.id as string,
      itemCode,
      itemName: (r.item_name as string | null) ?? null,
      grams,
      unitPrice: numText(r.total_price_per_piece),
      size: (r.size as string | null) ?? null,
    };
  });
}

export type CreateCaptureOrderInput = {
  deviceInstallationId: string;
  captureId: string;
  customerName: string;
  inventoryItemId: string;
  price: string;
  grams?: string | null;
  screenshotPath?: string | null;
  ocr?: unknown;
  pancakeConversationId?: string | null;
  pancakeCustomerId?: string | null;
};

export type CreateCaptureOrderResult =
  | {
      ok: true;
      officialOrderId: string;
      orderNumber: string;
      invoiceNumber: string;
      /** true when this exact capture was already processed — the SAME order. */
      idempotent: boolean;
      captureRecordId: string;
    }
  | { ok: false; error: string };

/**
 * Create (or return the existing) order for a capture. The database function is
 * idempotent on `capture:{device}:{capture}`, so a retried tap never duplicates.
 */
export async function createCaptureOrder(
  supabase: SupabaseClient,
  input: CreateCaptureOrderInput,
): Promise<CreateCaptureOrderResult> {
  const price = (input.price ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
    return { ok: false, error: 'A unit price greater than zero is required.' };
  }
  if (!input.inventoryItemId)
    return { ok: false, error: 'An inventory item is required.' };
  if (!input.customerName?.trim())
    return { ok: false, error: 'A customer name is required.' };
  if (!input.deviceInstallationId?.trim() || !input.captureId?.trim()) {
    return { ok: false, error: 'A device id and capture id are required.' };
  }

  const { data, error } = (await supabase.rpc('create_capture_order', {
    p_device: input.deviceInstallationId.trim(),
    p_capture_id: input.captureId.trim(),
    p_customer_name: input.customerName.trim(),
    p_inventory_item_id: input.inventoryItemId,
    p_price: price,
    p_grams: input.grams?.trim() ? input.grams.trim() : null,
    p_screenshot_path: input.screenshotPath ?? null,
    p_ocr: input.ocr ?? null,
    p_pancake_conversation_id: input.pancakeConversationId ?? null,
    p_pancake_customer_id: input.pancakeCustomerId ?? null,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const d = data ?? {};
  return {
    ok: true,
    officialOrderId: d.official_order_id as string,
    orderNumber: (d.order_number as string) ?? '—',
    invoiceNumber: (d.invoice_number as string) ?? '—',
    idempotent: d.idempotent === true,
    captureRecordId: (d.capture_record_id as string) ?? '',
  };
}

export type EnqueueReviewResult =
  | { ok: true; review: true; reviewId: string; status: string; idempotent: boolean }
  | { ok: false; error: string };

/**
 * Whether the active live session is in Review Mode. In Review Mode a capture is
 * queued for a reviewer instead of directly creating an order (Automatic Mode keeps
 * the direct-create behaviour).
 */
export async function activeLiveModeIsReview(supabase: SupabaseClient): Promise<boolean> {
  const { data } = (await supabase
    .from('live_sessions')
    .select('mode')
    .eq('active', true)
    .maybeSingle()) as { data: { mode?: string } | null };
  return (data?.mode ?? '') === 'review';
}

/**
 * Enqueue a capture for review (Review Mode) instead of creating the order. Idempotent
 * on device+capture in the database, so a retried tap returns the same queue entry.
 */
export async function enqueueCaptureReview(
  supabase: SupabaseClient,
  input: CreateCaptureOrderInput,
): Promise<EnqueueReviewResult> {
  const price = (input.price ?? '').trim();
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(price) || Number(price) <= 0) {
    return { ok: false, error: 'A unit price greater than zero is required.' };
  }
  if (!input.inventoryItemId)
    return { ok: false, error: 'An inventory item is required.' };
  if (!input.customerName?.trim())
    return { ok: false, error: 'A customer name is required.' };
  if (!input.deviceInstallationId?.trim() || !input.captureId?.trim()) {
    return { ok: false, error: 'A device id and capture id are required.' };
  }

  const { data, error } = (await supabase.rpc('enqueue_capture_review', {
    p_device: input.deviceInstallationId.trim(),
    p_capture_id: input.captureId.trim(),
    p_customer_name: input.customerName.trim(),
    p_inventory_item_id: input.inventoryItemId,
    p_price: price,
    p_grams: input.grams?.trim() ? input.grams.trim() : null,
    p_screenshot_path: input.screenshotPath ?? null,
    p_ocr: input.ocr ?? null,
    p_pancake_conversation_id: input.pancakeConversationId ?? null,
    p_pancake_customer_id: input.pancakeCustomerId ?? null,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  const d = data ?? {};
  return {
    ok: true,
    review: true,
    reviewId: (d.review_id as string) ?? '',
    status: (d.status as string) ?? 'pending_review',
    idempotent: d.idempotent === true,
  };
}

export type PendingCaptureResult =
  | { ok: true; captureRecordId: string; idempotent: boolean }
  | { ok: false; error: string };

/**
 * Create a PENDING capture from the floating screenshot — the screenshot path + OCR
 * guess only (no order/item yet). The PC web app picks it up for operator review.
 * Idempotent per device+capture in the database, so a repeated tap is one row.
 */
export async function createPendingCapture(
  supabase: SupabaseClient,
  input: {
    deviceInstallationId: string;
    captureId: string;
    screenshotPath?: string | null;
    ocr?: unknown;
  },
): Promise<PendingCaptureResult> {
  if (!input.deviceInstallationId?.trim() || !input.captureId?.trim()) {
    return { ok: false, error: 'A device id and capture id are required.' };
  }
  const { data, error } = (await supabase.rpc('create_pending_capture', {
    p_device: input.deviceInstallationId.trim(),
    p_capture_id: input.captureId.trim(),
    p_screenshot_path: input.screenshotPath ?? null,
    p_ocr: input.ocr ?? null,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  const d = data ?? {};
  return {
    ok: true,
    captureRecordId: (d.capture_record_id as string) ?? '',
    idempotent: d.idempotent === true,
  };
}

const CAPTURE_BUCKET = 'attachments';
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** 12 MB — a generous cap for a high-quality still, blocking abuse. */
const MAX_SCREENSHOT_BYTES = 12 * 1024 * 1024;

export type UploadScreenshotResult =
  { ok: true; path: string } | { ok: false; error: string };

/**
 * Store a capture screenshot in the PRIVATE attachments bucket (signed access
 * only — never a public URL). The image arrives base64-encoded. Type and size are
 * validated; the path is namespaced by staff + capture so it is stable and
 * traceable. Returns the storage path to attach to the order/capture record.
 */
export async function uploadCaptureScreenshot(
  supabase: SupabaseClient,
  staffProfileId: string,
  input: {
    deviceInstallationId: string;
    captureId: string;
    contentType: string;
    base64: string;
  },
): Promise<UploadScreenshotResult> {
  const contentType = (input.contentType ?? '').trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    return { ok: false, error: 'Only PNG, JPEG, or WebP images are accepted.' };
  }
  const device = (input.deviceInstallationId ?? '').trim();
  const capture = (input.captureId ?? '').trim();
  if (!device || !capture)
    return { ok: false, error: 'A device id and capture id are required.' };

  let bytes: Buffer;
  try {
    // Accept a bare base64 string or a data: URL.
    const comma = input.base64.indexOf(',');
    const raw = comma >= 0 ? input.base64.slice(comma + 1) : input.base64;
    bytes = Buffer.from(raw, 'base64');
  } catch {
    return { ok: false, error: 'The image could not be decoded.' };
  }
  if (bytes.length === 0) return { ok: false, error: 'The image is empty.' };
  if (bytes.length > MAX_SCREENSHOT_BYTES) {
    return { ok: false, error: 'The image is too large (max 12 MB).' };
  }

  const ext =
    contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `captures/${staffProfileId}/${safe(device)}-${safe(capture)}.${ext}`;

  const { error } = await supabase.storage
    .from(CAPTURE_BUCKET)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    return { ok: false, error: 'The screenshot could not be uploaded.' };
  }
  return { ok: true, path };
}

export type DispatchResult =
  { ok: true; messageStatus: string; printStatus: string } | { ok: false; error: string };

/**
 * Record the outcome of sending (Pancake) / printing a capture, and/or attach the
 * uploaded screenshot path. Supports safe Retry Send / Retry Print — it updates
 * status only and never recreates the order.
 */
export async function updateCaptureDispatch(
  supabase: SupabaseClient,
  input: {
    deviceInstallationId: string;
    captureId: string;
    messageStatus?: string | null;
    printStatus?: string | null;
    pancakeMessageId?: string | null;
    screenshotPath?: string | null;
    /** Persist the resolved conversation on the capture so the order inherits it. */
    pancakeConversationId?: string | null;
  },
): Promise<DispatchResult> {
  const { data, error } = (await supabase.rpc('update_capture_dispatch', {
    p_device: input.deviceInstallationId.trim(),
    p_capture_id: input.captureId.trim(),
    p_message_status: input.messageStatus ?? null,
    p_print_status: input.printStatus ?? null,
    p_pancake_message_id: input.pancakeMessageId ?? null,
    p_screenshot_path: input.screenshotPath ?? null,
    p_pancake_conversation_id: input.pancakeConversationId ?? null,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  const d = data ?? {};
  return {
    ok: true,
    messageStatus: (d.message_status as string) ?? 'pending',
    printStatus: (d.print_status as string) ?? 'pending',
  };
}

export type SendCaptureMessageResult =
  | {
      ok: true;
      code: 'sent' | 'already_sent';
      pancakeMessageId: string | null;
      message: string;
    }
  | { ok: false; code: string; error: string };

/**
 * Send the screenshot + message to the customer's Pancake conversation, through
 * the MineFlow backend (the Android app never calls Pancake directly).
 *
 * Safety:
 *   - Requires an explicit conversation id — never sends by Facebook name.
 *   - Idempotent: if this capture's message is already 'sent', it does NOT resend;
 *     it returns the existing result. A failed send is retryable safely.
 *   - The order + screenshot are already saved; a send failure never undoes them.
 */
export async function sendCaptureMessage(
  supabase: SupabaseClient,
  input: {
    deviceInstallationId: string;
    captureId: string;
    conversationId: string;
    message: string;
    screenshotPath?: string | null;
  },
): Promise<SendCaptureMessageResult> {
  const device = (input.deviceInstallationId ?? '').trim();
  const capture = (input.captureId ?? '').trim();
  if (!device || !capture)
    return {
      ok: false,
      code: 'bad_request',
      error: 'A device id and capture id are required.',
    };
  if (!input.conversationId?.trim()) {
    return {
      ok: false,
      code: 'conversation_missing',
      error: 'Confirm a Pancake conversation before sending.',
    };
  }
  if (!input.message?.trim()) {
    return { ok: false, code: 'empty_message', error: 'The message is empty.' };
  }

  // Load the capture row: enforce idempotency + find the stored screenshot path.
  const key = `capture:${device}:${capture}`;
  const existing = (await supabase
    .from('capture_records')
    .select('id, message_status, pancake_message_id, screenshot_path')
    .eq('idempotency_key', key)
    .maybeSingle()) as { data: Record<string, unknown> | null };
  const row = existing.data;
  if (row && row.message_status === 'sent') {
    return {
      ok: true,
      code: 'already_sent',
      pancakeMessageId: (row.pancake_message_id as string | null) ?? null,
      message: 'This capture was already sent — not resent.',
    };
  }

  // Build a short-lived signed URL for the screenshot so Pancake can fetch it.
  const path =
    input.screenshotPath?.trim() || (row?.screenshot_path as string | null) || null;
  let attachmentUrl: string | null = null;
  if (path) {
    const signed = (await supabase.storage
      .from(CAPTURE_BUCKET)
      .createSignedUrl(path, 600)) as { data: { signedUrl?: string } | null };
    attachmentUrl = signed.data?.signedUrl ?? null;
  }

  const result = await sendPancakeConversationMessage({
    conversationId: input.conversationId.trim(),
    message: input.message.trim(),
    attachmentUrl,
  });

  // Record the outcome so the app can show status / offer a safe retry. Persist the
  // conversation even on a FAILED send: it was a confident, explicit target, so the
  // order still inherits the link and a Retry Send reuses the same chat.
  await supabase.rpc('update_capture_dispatch', {
    p_device: device,
    p_capture_id: capture,
    p_message_status: result.ok ? 'sent' : 'failed',
    p_print_status: null,
    p_pancake_message_id: result.pancakeMessageId,
    p_screenshot_path: path,
    p_pancake_conversation_id: input.conversationId.trim(),
  });

  if (!result.ok) return { ok: false, code: result.code, error: result.message };
  return {
    ok: true,
    code: 'sent',
    pancakeMessageId: result.pancakeMessageId,
    message: result.message,
  };
}

export type CaptureStatus = {
  captureRecordId: string;
  officialOrderId: string | null;
  orderNumber: string | null;
  messageStatus: string;
  printStatus: string;
  capturedAt: string;
};

/** The current status of a capture (order / message / print), for retry screens. */
export async function getCaptureStatus(
  supabase: SupabaseClient,
  deviceInstallationId: string,
  captureId: string,
): Promise<CaptureStatus | null> {
  const key = `capture:${deviceInstallationId.trim()}:${captureId.trim()}`;
  const response = (await supabase
    .from('capture_records')
    .select(
      'id, official_order_id, message_status, print_status, captured_at, official_orders ( order_number )',
    )
    .eq('idempotency_key', key)
    .maybeSingle()) as { data: Record<string, unknown> | null };
  const r = response.data;
  if (!r) return null;
  const order = Array.isArray(r.official_orders)
    ? (r.official_orders[0] as { order_number?: string } | undefined)
    : (r.official_orders as { order_number?: string } | null);

  return {
    captureRecordId: r.id as string,
    officialOrderId: (r.official_order_id as string | null) ?? null,
    orderNumber: order?.order_number ?? null,
    messageStatus: (r.message_status as string) ?? 'pending',
    printStatus: (r.print_status as string) ?? 'pending',
    capturedAt: r.captured_at as string,
  };
}
