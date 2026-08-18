import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { nameKey, normalizeName } from '@/lib/customers/matching';

/**
 * Pancake (pages.fm) integration — server-only. The User/Page access tokens are
 * read from the environment and NEVER returned to the browser or logged. This
 * module manages the connected Page, lists conversations and links them to
 * customers, sends messages, and reports the persistent link status — all gated to
 * the Primary Super Admin / Owner. No service-role key or token ever reaches a
 * device. See [[av-jewelry-pancake-api-contract]] for the pages.fm contract.
 */

/* ==========================================================================
 * Load Pancake Pages — the managed Pages the User Access Token can see.
 *
 * SECURITY (Owner request):
 *   - Server-side ONLY. The token (PANCAKE_USER_ACCESS_TOKEN) is read from the
 *     server environment and passed to pages.fm as the documented `access_token`
 *     QUERY parameter. It NEVER reaches the browser and is NEVER returned.
 *   - The full request URL is NEVER logged — it carries the token.
 *   - Only the Primary Super Admin may call this (enforced here AND in the route).
 *   - The response is SANITISED to id / name / platform / connected — nothing else
 *     from Pancake is forwarded.
 *   - A hard request timeout guards against a hung Pancake API.
 * ======================================================================== */

/** The official Pancake managed-pages endpoint (pages.fm public v1). */
const PANCAKE_PAGES_ENDPOINT = 'https://pages.fm/api/v1/pages';

/** Only these fields ever leave the server — never the token, never raw Pancake. */
export type PancakePageInfo = {
  id: string;
  name: string;
  platform: string | null;
  /** true = connected/activated, false = disconnected, null = not reported. */
  connected: boolean | null;
};

export type PancakePagesCode =
  | 'loaded' // pages returned
  | 'none_found' // token valid, but no managed pages
  | 'token_missing' // PANCAKE_USER_ACCESS_TOKEN not set
  | 'token_invalid' // missing/invalid/expired token
  | 'permission_denied' // token lacks page permission
  | 'unavailable' // Pancake API unreachable / errored
  | 'forbidden'; // caller is not the Primary Super Admin

export type PancakePagesResult = {
  ok: boolean;
  code: PancakePagesCode;
  message: string;
  pages: PancakePageInfo[];
};

/** Stringify only JSON primitives — never an object (avoids "[object Object]"). */
function asText(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
}

/** One raw Pancake page → the sanitised shape, or null when it has no id. */
function sanitizePage(raw: unknown, connected: boolean | null): PancakePageInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const id = asText(p.id) || asText(p.page_id) || asText(p.pageId);
  if (!id) return null;
  const name =
    asText(p.name) || asText(p.page_name) || asText(p.pageName) || `Page ${id}`;
  const platform = asText(p.platform) || asText(p.page_type) || asText(p.type) || null;
  // Prefer an explicit boolean if Pancake gives one; otherwise use the bucket.
  const explicit =
    typeof p.connected === 'boolean'
      ? p.connected
      : typeof p.is_activated === 'boolean'
        ? p.is_activated
        : null;
  return { id, name, platform, connected: explicit ?? connected };
}

/**
 * Extract pages from Pancake's response WITHOUT assuming one exact shape.
 * pages.fm has returned both a top-level `pages` array and a `categorized`
 * object of `{ activated: [...], inactivated: [...] }`. We handle both, dedupe
 * by id, and derive connected-status from the bucket when present.
 */
function extractPages(body: unknown): PancakePageInfo[] {
  const out = new Map<string, PancakePageInfo>();
  const add = (raw: unknown, connected: boolean | null) => {
    const page = sanitizePage(raw, connected);
    if (page && !out.has(page.id)) out.set(page.id, page);
  };

  const root =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null;

  const categorized = root?.categorized;
  if (categorized && typeof categorized === 'object') {
    for (const [bucket, list] of Object.entries(categorized as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const key = bucket.toLowerCase();
      const connected = key.includes('inactiv')
        ? false
        : key.includes('activ')
          ? true
          : null;
      for (const item of list) add(item, connected);
    }
  }

  if (Array.isArray(root?.pages)) {
    for (const item of root.pages as unknown[]) add(item, null);
  }

  if (out.size === 0 && Array.isArray(body)) {
    for (const item of body as unknown[]) add(item, null);
  }

  return [...out.values()];
}

/**
 * Load the managed Pages for the configured User Access Token. Primary Super
 * Admin only. Returns a sanitised, typed result — never the token, never the raw
 * Pancake payload, and it never logs the token-bearing URL.
 */
export async function listPancakePages(): Promise<PancakePagesResult> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, code: 'forbidden', message: cause.message, pages: [] };
    }
    throw cause;
  }

  const token = process.env.PANCAKE_USER_ACCESS_TOKEN;
  if (!token || !token.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message:
        'User Access Token missing. Set PANCAKE_USER_ACCESS_TOKEN in the server environment and redeploy.',
      pages: [],
    };
  }

  let res: Response;
  try {
    const endpoint = `${PANCAKE_PAGES_ENDPOINT}?access_token=${encodeURIComponent(token.trim())}`;
    res = await fetch(endpoint, {
      // Never cache a token-bearing request; always ask Pancake fresh.
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // Deliberately generic — and we never echo the endpoint (it carries the token).
    return {
      ok: false,
      code: 'unavailable',
      message: 'Pancake API unavailable. Please try again in a moment.',
      pages: [],
    };
  }

  if (res.status === 401) {
    return {
      ok: false,
      code: 'token_invalid',
      message: 'Invalid or expired User Access Token. Generate a new token and redeploy.',
      pages: [],
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      code: 'permission_denied',
      message: 'Permission denied. This token cannot list managed Pages.',
      pages: [],
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Pancake API unavailable. Please try again in a moment.',
      pages: [],
    };
  }

  const body = (await res.json().catch(() => null)) as unknown;
  // pages.fm returns HTTP 200 with { success: false } for a rejected token.
  if (
    body &&
    typeof body === 'object' &&
    (body as { success?: boolean }).success === false
  ) {
    return {
      ok: false,
      code: 'token_invalid',
      message: 'Invalid or expired User Access Token. Generate a new token and redeploy.',
      pages: [],
    };
  }

  const pages = extractPages(body);
  if (pages.length === 0) {
    return {
      ok: false,
      code: 'none_found',
      message: 'No managed Pages found for this token.',
      pages: [],
    };
  }

  return {
    ok: true,
    code: 'loaded',
    message: `Pages loaded successfully — ${pages.length} Page(s).`,
    pages,
  };
}

/* ---- Save / read the selected Page ---------------------------------------
 * The selected Page ID is persisted with an audit trail (who / when). The token
 * is NEVER stored — only the non-secret Page ID. Read is RLS-gated to the
 * Primary Super Admin; the write goes through a SECURITY DEFINER function. */

export type SelectedPancakePage = {
  pageId: string;
  pageName: string | null;
  platform: string | null;
  selectedByName: string | null;
  selectedAt: string | null;
};

/** The currently-saved Page selection, or null when none has been chosen. */
export async function getSelectedPancakePage(): Promise<SelectedPancakePage | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('pancake_integration_config')
    .select('page_id, page_name, platform, selected_by, selected_at')
    .maybeSingle();
  if (!data || !data.page_id) return null;

  let selectedByName: string | null = null;
  if (data.selected_by) {
    const { data: staff } = await supabase
      .from('staff_profiles')
      .select('full_name')
      .eq('id', data.selected_by as string)
      .maybeSingle<{ full_name: string }>();
    selectedByName = staff?.full_name ?? null;
  }

  return {
    pageId: data.page_id as string,
    pageName: (data.page_name as string | null) ?? null,
    platform: (data.platform as string | null) ?? null,
    selectedByName,
    selectedAt: (data.selected_at as string | null) ?? null,
  };
}

/**
 * The Facebook Page every send goes out from. pages.fm conversation ids are
 * `{page_id}_{psid}`, so a conversation only exists on ITS page — a message to a
 * conversation on any other page is rejected ("conversation_id not found", code 120).
 *
 * ENV is primary (the send has always used `PANCAKE_PAGE_ID`, and it is validated in
 * prod), with the UI-selected Page as a fallback for environments that never set the
 * env. The SAME id is used by both the sender and the conversation resolver below, so
 * the page-filter can only ever skip a link the send could not have delivered anyway.
 */
export async function getActivePancakePageId(): Promise<string> {
  const fromEnv = (process.env.PANCAKE_PAGE_ID || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const selected = await getSelectedPancakePage();
    return (selected?.pageId ?? '').trim();
  } catch {
    return '';
  }
}

/**
 * True when `conversationId` belongs to `pageId` (i.e. we can actually message it).
 * Pure + exported so it is unit-testable. When the active page is unknown ('') we do
 * NOT filter — being permissive there preserves the old behaviour rather than dropping
 * every link. A null/empty conversation id is never usable.
 */
export function conversationBelongsToPage(
  conversationId: string | null | undefined,
  pageId: string,
): boolean {
  const id = (conversationId ?? '').trim();
  if (!id) return false;
  if (!pageId) return true;
  return id.startsWith(`${pageId}_`);
}

/** How many active customers already have a Pancake conversation linked. This is the
 *  PERSISTENT proof that Send Invoice / Reminder can auto-deliver — the links live in
 *  the database, so they survive refreshes and never need re-linking unless customers
 *  are added. */
export type PancakeLinkStatus = { linked: number; total: number };

export async function getPancakeLinkStatus(): Promise<PancakeLinkStatus> {
  const supabase = await createClient();
  const [{ count: total }, { count: linked }] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('pancake_conversation_id', 'is', null),
  ]);
  return { linked: linked ?? 0, total: total ?? 0 };
}

/** One active customer already linked to a Pancake conversation. */
export type LinkedPancakeCustomer = {
  id: string;
  displayName: string;
  conversationId: string;
};

/**
 * The active customers already linked to a Pancake conversation — so the operator can
 * SEE who is linked, not just the count. Ordered by name. Read-only; the conversation
 * id is not sensitive (it is only meaningful with the server-held Page token).
 */
export async function listLinkedPancakeCustomers(): Promise<LinkedPancakeCustomer[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('customers')
    .select('id, display_name, pancake_conversation_id')
    .eq('is_active', true)
    .not('pancake_conversation_id', 'is', null)
    .order('display_name', { ascending: true })
    .limit(2000);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    displayName: (r.display_name as string | null) ?? 'Unknown',
    conversationId: (r.pancake_conversation_id as string | null) ?? '',
  }));
}

export type SavePancakePageResult =
  { ok: true; message: string; pageId: string } | { ok: false; error: string };

/**
 * Persist the selected Page ID. Primary Super Admin only. Stores the non-secret
 * Page ID plus an audit trail (who/when) via a SECURITY DEFINER function — never
 * a token. The message reminds the operator to also copy PANCAKE_PAGE_ID into
 * Vercel if the deployment expects it as an env var.
 */
export async function saveSelectedPancakePage(input: {
  pageId: string;
  pageName?: string | null;
  platform?: string | null;
}): Promise<SavePancakePageResult> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const pageId = (input.pageId ?? '').trim();
  if (!pageId) return { ok: false, error: 'Select a Page before saving.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_pancake_page_selection', {
    p_page_id: pageId,
    p_page_name: input.pageName ?? null,
    p_platform: input.platform ?? null,
  });
  if (error) {
    return {
      ok: false,
      error: 'The Page selection could not be saved. Please try again.',
    };
  }

  return {
    ok: true,
    pageId,
    message: `Page selected successfully. Selected Page ID: ${pageId}. If this deployment expects PANCAKE_PAGE_ID as a Vercel environment variable, copy this exact Page ID into Vercel → Settings → Environment Variables and redeploy.`,
  };
}

/**
 * Resolve the pages.fm public API base, self-correcting a common misconfiguration.
 * The public API lives under `/api/public_api/v1`; a bare `https://pages.fm/api`
 * (or the host root) returns the PancakeV2 web app HTML, not JSON. So when the
 * configured base points at pages.fm but is missing the `public_api` segment, we
 * append it — making the integration work even if the env var is slightly off.
 */
function resolvePancakeApiBase(): string {
  let base = (
    process.env.PANCAKE_SEND_BASE ||
    process.env.PANCAKE_API_BASE_URL ||
    'https://pages.fm/api/public_api/v1'
  ).replace(/\/+$/, '');
  if (/pages\.fm/i.test(base) && !/public_api/i.test(base)) {
    base = `${base.replace(/\/api$/i, '').replace(/\/+$/, '')}/api/public_api/v1`;
  }
  return base;
}

/* ==========================================================================
 * Send a message (optionally with a screenshot) to a Pancake conversation.
 *
 * SECURITY / SAFETY:
 *   - Server-side ONLY. Token (PANCAKE_USER_ACCESS_TOKEN) + page id
 *     (PANCAKE_PAGE_ID) are read from the server environment and never returned;
 *     the token-bearing URL is NEVER logged.
 *   - Sends to ONE explicit conversation id — never by Facebook name.
 *   - A hard timeout guards a hung Pancake API.
 *
 * The exact pages.fm path is ENV-CONFIGURABLE so it can be corrected without a
 * code change:
 *   - PANCAKE_SEND_BASE  (default "https://pages.fm/api/public_api/v1")
 *   - PANCAKE_SEND_PATH  (default "/pages/{page_id}/conversations/{conversation_id}/messages")
 * `{page_id}` and `{conversation_id}` are substituted; `access_token` is appended.
 * ======================================================================== */

export type PancakeSendCode =
  | 'sent'
  | 'token_missing'
  | 'page_missing'
  | 'conversation_missing'
  | 'unavailable'
  | 'outside_window'
  | 'failed';

export type PancakeSendResult = {
  ok: boolean;
  code: PancakeSendCode;
  message: string;
  /** Pancake's message id, when it returns one. */
  pancakeMessageId: string | null;
  /** Diagnostic: the raw HTTP status + response snippet + the endpoint template
   *  used (token stripped). Surfaced by the Test-send tool to debug the contract. */
  debug?: string;
  /** SANITIZED `upload_contents` diagnostics when a photo was attached (token/PII stripped). */
  uploadDiagnostics?: PancakeUploadDiagnostics;
  /** SANITIZED reconstruction of the exact send form keys (token stripped, content id masked). */
  sentForm?: string;
  /** SANITIZED send-endpoint outcome (for durable Controlled-Photo diagnostics). */
  sendHttpStatus?: number | null;
  sendSuccess?: boolean;
  sendMessageCode?: string | null;
};

/** Pull a message id out of Pancake's response without assuming one exact shape. */
function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const candidates = [
    b.message_id,
    b.id,
    (b.data as Record<string, unknown> | undefined)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number') return String(c);
  }
  return null;
}

/**
 * SANITIZED diagnostics for ONE `upload_contents` attempt. NEVER contains the access
 * token, the image bytes, or any customer PII — only the endpoint TEMPLATE (page id shown
 * as a `{page_id}` placeholder), the API version, and the parsed response shape. Surfaced
 * so a controlled Photo attempt proves exactly where the pipeline first fails.
 */
export type PancakeUploadDiagnostics = {
  /** Endpoint template actually used — token stripped, page id shown as `{page_id}`. */
  endpoint: string;
  /** `/public_api/vN` tag parsed from the base (the v1↔v2 reconciliation lever). */
  apiVersion: string | null;
  httpStatus: number | null;
  /** UPLOAD_HTTP_OK — transport-level 2xx. NEVER, on its own, treated as upload success. */
  httpOk: boolean;
  /** UPLOAD_SUCCESS — parsed body `success === true` (strict). */
  success: boolean;
  /** UPLOAD_CONTENT_ID_PRESENT — a non-empty `id` came back. */
  contentIdPresent: boolean;
  /** Last-6 suffix of the returned content id (never the whole value). */
  contentIdSuffix: string | null;
  /** UPLOAD_TYPE — the EXACT `type` the upload returned (e.g. `PHOTO`), or null. */
  type: string | null;
  /** Sanitized `message_code`/`error` from the response, when present. */
  messageCode: string | null;
};

/** Last-6 suffix of an id for diagnostics; never the whole value. */
function idSuffix(v: unknown): string | null {
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  if (!s) return null;
  return s.length <= 6 ? `…${s}` : `…${s.slice(-6)}`;
}

/** Extract the `/public_api/vN` version tag from an API base, or null. */
function apiVersionOf(base: string): string | null {
  const m = /public_api\/(v\d+)/i.exec(base);
  return m?.[1] ?? null;
}

/**
 * Build SANITIZED upload diagnostics from a parsed `upload_contents` response. Pure +
 * exported for unit testing. Preserves the FULL semantic distinction an operator needs:
 * UPLOAD_HTTP_OK (transport) vs UPLOAD_SUCCESS (`body.success === true`) vs
 * UPLOAD_CONTENT_ID_PRESENT vs UPLOAD_TYPE. HTTP 200 alone is NEVER upload success.
 */
export function summarizeUploadResponse(args: {
  endpoint: string;
  apiVersion: string | null;
  httpStatus: number | null;
  httpOk: boolean;
  body: unknown;
}): PancakeUploadDiagnostics {
  const obj =
    args.body && typeof args.body === 'object'
      ? (args.body as Record<string, unknown>)
      : null;
  const rawId = obj?.id;
  const contentId =
    typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
  const rawType = obj?.type;
  const type =
    typeof rawType === 'string'
      ? rawType
      : typeof rawType === 'number'
        ? String(rawType)
        : null;
  const rawCode =
    obj?.message_code ??
    obj?.error_code ??
    obj?.error ??
    (obj?.success === false ? obj?.message : undefined);
  const messageCode =
    typeof rawCode === 'string' && rawCode.trim()
      ? rawCode.trim().slice(0, 200)
      : typeof rawCode === 'number'
        ? String(rawCode)
        : null;
  return {
    endpoint: args.endpoint,
    apiVersion: args.apiVersion,
    httpStatus: args.httpStatus,
    httpOk: args.httpOk,
    success: obj ? obj.success === true : false,
    contentIdPresent: Boolean(contentId),
    contentIdSuffix: idSuffix(contentId),
    type,
    messageCode,
  };
}

/**
 * Upload a screenshot's BYTES to Pancake and return its `content_id` (Pancake's confirmed
 * image flow, replacing the old `content_url` reference which reply_inbox rejects together
 * with everything). Endpoint: `POST /pages/{page_id}/upload_contents` (env-overridable),
 * multipart/form-data, field name `file`, token as `?page_access_token=`. Response:
 * `{ success: true, id: "<content_id>", type: "PHOTO" }`. The image is read server-side
 * from its short-lived signed URL. Never logs the token.
 */
async function uploadPancakeImageContent(
  imageUrl: string,
): Promise<
  | { ok: true; contentId: string; diag: PancakeUploadDiagnostics }
  | {
      ok: false;
      code: PancakeSendCode;
      message: string;
      debug?: string;
      diag?: PancakeUploadDiagnostics;
    }
> {
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN;
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  if (!token || !token.trim()) {
    return { ok: false, code: 'token_missing', message: 'Access token missing.' };
  }
  const pageId = await getActivePancakePageId();
  if (!pageId) {
    return { ok: false, code: 'page_missing', message: 'No Page selected.' };
  }

  // Read the screenshot bytes from its short-lived signed URL (server-side).
  let imgBlob: Blob;
  try {
    const imgRes = await fetch(imageUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!imgRes.ok) {
      return {
        ok: false,
        code: 'unavailable',
        message: `Could not read the screenshot (HTTP ${imgRes.status}).`,
      };
    }
    imgBlob = await imgRes.blob();
  } catch {
    return { ok: false, code: 'unavailable', message: 'Could not read the screenshot.' };
  }

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_UPLOAD_PATH || '/pages/{page_id}/upload_contents';
  const path = template.replace('{page_id}', encodeURIComponent(pageId.trim()));
  const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}`;

  const fd = new FormData();
  // undici/Node sets the multipart boundary + content-type from the FormData automatically.
  fd.set('file', imgBlob, 'capture.jpg');

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      body: fd,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, code: 'unavailable', message: 'Pancake upload unavailable.' };
  }

  const rawText = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }
  const debug = `HTTP ${res.status} · upload_contents · ${rawText.slice(0, 300)}`;
  const obj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const rawId = obj?.id;
  const contentId =
    typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : '';
  // SANITIZED diagnostics (token/PII/image-free) — captured on BOTH paths so a controlled
  // retry records the previously-discarded success response (id/type/version), not just failures.
  const diag = summarizeUploadResponse({
    endpoint: `${base}${template}`,
    apiVersion: apiVersionOf(base),
    httpStatus: res.status,
    httpOk: res.ok,
    body,
  });
  const failed = !res.ok || (obj ? obj.success === false : true) || !contentId;
  if (failed) {
    return {
      ok: false,
      code: 'failed',
      message: 'Pancake rejected the image upload.',
      debug,
      diag,
    };
  }
  return { ok: true, contentId, diag };
}

export async function sendPancakeConversationMessage(input: {
  conversationId: string;
  message: string;
  /** A publicly-fetchable (signed) URL to the screenshot, or null for text only. */
  attachmentUrl?: string | null;
}): Promise<PancakeSendResult> {
  // Prefer the PAGE access token when configured (page-scoped operations like
  // sending REQUIRE it), falling back to the user access token.
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN;
  // pages.fm page-scoped endpoints authenticate with `page_access_token`, not
  // `access_token`. Use the right param for the token in play; overridable.
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  if (!token || !token.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message:
        'Access token missing. Set PANCAKE_PAGE_ACCESS_TOKEN (or PANCAKE_USER_ACCESS_TOKEN) and redeploy.',
      pancakeMessageId: null,
    };
  }
  const pageId = await getActivePancakePageId();
  if (!pageId) {
    return {
      ok: false,
      code: 'page_missing',
      message:
        'No Page selected. Set PANCAKE_PAGE_ID (from Save Selected Page) and redeploy.',
      pancakeMessageId: null,
    };
  }
  const conversationId = (input.conversationId ?? '').trim();
  if (!conversationId) {
    return {
      ok: false,
      code: 'conversation_missing',
      message: 'A confirmed Pancake conversation is required before sending.',
      pancakeMessageId: null,
    };
  }

  // Use the explicit send base, else the account's configured API base, else the
  // pages.fm public v1 default — self-correcting a missing /public_api/v1 segment.
  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_SEND_PATH ||
    '/pages/{page_id}/conversations/{conversation_id}/messages';
  const path = template
    .replace('{page_id}', encodeURIComponent(pageId.trim()))
    .replace('{conversation_id}', encodeURIComponent(conversationId));

  // When a screenshot is attached, upload its BYTES to Pancake first to obtain a
  // content_id (the confirmed flow), then attach it as a PHOTO below. reply_inbox forbids a
  // text `message` alongside content, so with an image we send the photo alone.
  let contentId: string | null = null;
  let uploadDiagnostics: PancakeUploadDiagnostics | undefined;
  let sentForm: string | undefined;
  if (input.attachmentUrl) {
    const up = await uploadPancakeImageContent(input.attachmentUrl);
    uploadDiagnostics = up.diag;
    if (!up.ok) {
      return {
        ok: false,
        code: up.code,
        message:
          'The screenshot could not be uploaded to Pancake. The reminder is saved — retry, or send it via Open FB Chat.',
        pancakeMessageId: null,
        ...(up.debug ? { debug: up.debug } : {}),
        ...(up.diag ? { uploadDiagnostics: up.diag } : {}),
      };
    }
    contentId = up.contentId;
  }

  let res: Response;
  try {
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}`;
    // pages.fm's public API is FORM/QUERY based (a JSON body is rejected), so we send
    // `application/x-www-form-urlencoded`. `action=reply_inbox` is the reply mode. An image
    // is sent as its uploaded `content_ids` + `attachment_type=PHOTO` (Pancake's confirmed
    // flow); a text `message` is used ONLY when there is no image — the two are mutually
    // exclusive (sending both returns error_code 100).
    const form = new URLSearchParams();
    form.set('action', 'reply_inbox');
    if (contentId) {
      form.set('content_ids[]', contentId);
      form.set('attachment_type', 'PHOTO');
      // SANITIZED echo of the EXACT keys sent (content id masked to its last-6 suffix).
      sentForm = `action=reply_inbox&content_ids[]=${idSuffix(contentId) ?? '—'}&attachment_type=PHOTO`;
    } else {
      form.set('message', input.message);
      sentForm = `action=reply_inbox&message=<text:${input.message.length}c>`;
    }
    // NOTE ON THE 24-HOUR WINDOW: Facebook blocks a message sent >24h after the
    // customer's last message (error #10, subcode 2018278). The old order tags
    // (POST_PURCHASE_UPDATE / CONFIRMED_EVENT_UPDATE / ACCOUNT_UPDATE) were RETIRED by
    // Facebook on 2026-04-27 (they now return error 100), and pages.fm's reply_inbox
    // ignores tag fields anyway — so there is NO reliable way to auto-send a plain
    // reminder outside 24h through this API. We therefore send NO tag by default. It
    // stays env-configurable ONLY for a Page specifically approved for a surviving tag
    // (e.g. HUMAN_AGENT): set PANCAKE_MESSAGE_TAG to opt in.
    const tag = (process.env.PANCAKE_MESSAGE_TAG ?? '').trim();
    if (tag) {
      form.set('tag', tag);
      form.set('messaging_type', 'MESSAGE_TAG');
    }

    res = await fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Pancake API unavailable. Please try again in a moment.',
      pancakeMessageId: null,
      ...(uploadDiagnostics ? { uploadDiagnostics } : {}),
      ...(sentForm ? { sentForm } : {}),
    };
  }

  // Read the RAW response so we can both parse it and surface a diagnostic snippet.
  const rawText = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }
  // Diagnostic string (no token) — reveals whether pages.fm accepted or ignored it.
  const debug = `HTTP ${res.status} · path ${template} · ${rawText.slice(0, 400)}`;
  // SANITIZED send message_code (Facebook/pages.fm error slug), for durable diagnostics.
  const sendMessageCode = ((): string | null => {
    const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const c = b?.message_code ?? b?.error_code ?? b?.error;
    return typeof c === 'string' && c.trim()
      ? c.trim().slice(0, 200)
      : typeof c === 'number'
        ? String(c)
        : null;
  })();

  const rejected =
    !res.ok ||
    (body &&
      typeof body === 'object' &&
      (body as { success?: boolean }).success === false);
  if (rejected) {
    // Facebook's 24-hour rule: error #10 / subcode 2018278 = the customer last
    // messaged >24h ago. This is a Facebook POLICY block, not a system fault — and
    // the order tags that used to bypass it were retired on 2026-04-27. So we report
    // it plainly and route the operator to send it themselves in Messenger (a human
    // agent may reply for up to 7 days).
    const outsideWindow =
      /outside of allowed window/i.test(rawText) || /2018278/.test(rawText);
    if (outsideWindow) {
      return {
        ok: false,
        code: 'outside_window',
        message:
          "Facebook won't auto-send this — the customer last messaged over 24 hours ago (Facebook's messaging policy). The reminder is saved; open the chat and send it yourself (allowed for up to 7 days).",
        pancakeMessageId: null,
        debug,
        ...(uploadDiagnostics ? { uploadDiagnostics } : {}),
        ...(sentForm ? { sentForm } : {}),
        sendHttpStatus: res.status,
        sendSuccess: false,
        sendMessageCode,
      };
    }
    return {
      ok: false,
      code: 'failed',
      message:
        'Pancake rejected the message. The reminder is saved — you can retry, or send it via Open FB Chat.',
      pancakeMessageId: null,
      debug,
      ...(uploadDiagnostics ? { uploadDiagnostics } : {}),
      ...(sentForm ? { sentForm } : {}),
      sendHttpStatus: res.status,
      sendSuccess: false,
      sendMessageCode,
    };
  }

  return {
    ok: true,
    code: 'sent',
    message: 'Sent to the customer through Pancake.',
    pancakeMessageId: extractMessageId(body),
    debug,
    ...(uploadDiagnostics ? { uploadDiagnostics } : {}),
    ...(sentForm ? { sentForm } : {}),
    sendHttpStatus: res.status,
    sendSuccess: true,
    sendMessageCode,
  };
}

/* ==========================================================================
 * Load Pancake Conversations — list the Page's conversations so the operator can
 * find a conversation ID (for a test send) and, later, auto-link FB names to
 * customers. Primary Super Admin only; server-side; token never returned/logged.
 * Path/base are ENV-CONFIGURABLE (PANCAKE_CONVERSATIONS_PATH / the API base).
 * ======================================================================== */

export type PancakeConversation = {
  id: string;
  customerName: string | null;
  snippet: string | null;
  updatedAt: string | null;
  /** Best-effort avatar URL for the person, when the API includes one. */
  avatar: string | null;
  /** True when the latest activity is a post COMMENT rather than an inbox message.
   *  Still per-person and messageable, but an inbox thread is preferred over a comment
   *  when the same person has both (so a stored conversation id stays messageable). */
  isComment?: boolean;
};

export type PancakeConversationsResult = {
  ok: boolean;
  code: PancakePagesCode;
  message: string;
  conversations: PancakeConversation[];
  /** Diagnostic: the endpoint template used + raw HTTP status + response snippet
   *  (token stripped). Surfaced so the exact conversations contract can be debugged. */
  debug?: string;
};

function asConvText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

/** Extract conversations from Pancake's response without assuming one exact shape.
 *  Returns the kept inbox conversations plus how many raw rows and comments we saw,
 *  so the caller can report an honest breakdown. */
function extractConversations(body: unknown): {
  conversations: PancakeConversation[];
  rawCount: number;
  skippedComments: number;
} {
  const root =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const list =
    (Array.isArray(root?.conversations) && root.conversations) ||
    (Array.isArray(root?.data) && root.data) ||
    (Array.isArray(body) ? (body as unknown[]) : []);
  const out: PancakeConversation[] = [];
  let rawCount = 0;
  let skippedComments = 0;
  for (const raw of list as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    rawCount += 1;
    const c = raw as Record<string, unknown>;
    const id = asConvText(c.id) ?? asConvText(c.conversation_id);
    if (!id) continue;
    // Post COMMENTs are INCLUDED now (Owner request 2026-08-07): a pages.fm conversation
    // is per-person (id {page_id}_{psid}) and messageable regardless of whether the
    // latest activity was a comment or an inbox message, so a commenter can be linked to
    // their customer just like a messager — this is what lifts coverage past the handful
    // who happened to DM. Flag comments so an inbox thread wins over a comment for the
    // same person (below). RATING/REVIEW/FEED items are not per-person chats — skip them.
    const convType = (
      asConvText(c.type) ??
      asConvText(c.conversation_type) ??
      ''
    ).toUpperCase();
    const isComment = /COMMENT/.test(convType);
    if (/RATING|REVIEW|FEED/.test(convType)) {
      skippedComments += 1;
      continue;
    }
    const from = c.from as Record<string, unknown> | undefined;
    const cust = c.customer as Record<string, unknown> | undefined;
    const pageCust = c.page_customer as Record<string, unknown> | undefined;
    // pages.fm usually carries the person in a `customers` ARRAY (the participants),
    // not a single `customer`. Fall back through every shape we've seen so names show
    // instead of "Unknown".
    const custArr = Array.isArray(c.customers)
      ? (c.customers as Record<string, unknown>[])
      : [];
    const firstCust = custArr.find((x) => x && typeof x === 'object');
    const recentSender = c.recent_sender as Record<string, unknown> | undefined;
    const customerName =
      asConvText(cust?.name) ??
      asConvText(firstCust?.name) ??
      asConvText(from?.name) ??
      asConvText(pageCust?.name) ??
      asConvText(recentSender?.name) ??
      asConvText(c.customer_name) ??
      asConvText(c.name) ??
      asConvText(c.title);
    const snippet =
      asConvText(c.snippet) ?? asConvText(c.recent_phrase) ?? asConvText(c.last_message);
    const updatedAt =
      asConvText(c.updated_at) ?? asConvText(c.last_sent_at) ?? asConvText(c.inserted_at);
    const avatar =
      asConvText(cust?.avatar) ??
      asConvText(firstCust?.avatar) ??
      asConvText(from?.avatar) ??
      asConvText(pageCust?.avatar) ??
      asConvText(recentSender?.avatar) ??
      asConvText(c.avatar) ??
      asConvText(c.avatar_url);
    out.push({ id, customerName, snippet, updatedAt, avatar, isComment });
  }
  return { conversations: out, rawCount, skippedComments };
}

export type PancakeMessage = {
  id: string;
  fromPage: boolean;
  from: string | null;
  text: string | null;
  at: string | null;
};
export type PancakeMessagesResult =
  { ok: true; messages: PancakeMessage[] } | { ok: false; message: string };

/**
 * Recent messages of ONE Pancake conversation (oldest→newest, capped). Super-Admin
 * only; the token stays server-side. Best-effort shape parsing, like the conversations
 * feed — pages.fm's public API varies, so we never assume one exact structure.
 */
export async function getPancakeConversationMessages(
  conversationId: string,
): Promise<PancakeMessagesResult> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, message: 'Recent messages are available to the Super Admin.' };
    }
    throw cause;
  }

  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN;
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  const pageId = process.env.PANCAKE_PAGE_ID;
  if (!token?.trim() || !pageId?.trim()) {
    return { ok: false, message: 'Pancake is not configured.' };
  }
  const convId = (conversationId ?? '').trim();
  if (!convId) return { ok: false, message: 'No conversation is linked.' };

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_MESSAGES_PATH ||
    '/pages/{page_id}/conversations/{conversation_id}/messages';
  const path = template
    .replace('{page_id}', encodeURIComponent(pageId.trim()))
    .replace('{conversation_id}', encodeURIComponent(convId));

  try {
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}`;
    const res = await fetch(endpoint, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const rawText = await res.text().catch(() => '');
    let body: unknown = null;
    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      body = null;
    }
    if (!res.ok || !body) {
      return { ok: false, message: `Pancake returned HTTP ${res.status}.` };
    }
    const root = typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const list: unknown[] = Array.isArray(body)
      ? (body as unknown[])
      : (Array.isArray(root?.messages) && (root.messages as unknown[])) ||
        (Array.isArray(root?.data) && (root.data as unknown[])) ||
        [];
    const messages: PancakeMessage[] = list
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
      .slice(-15)
      .map((m, i) => {
        const fromObj =
          m.from && typeof m.from === 'object'
            ? (m.from as Record<string, unknown>)
            : null;
        const fromPage = m.is_page === true || m.from_page === true;
        return {
          id: asConvText(m.id) ?? String(i),
          fromPage,
          from:
            asConvText(fromObj?.name) ??
            asConvText(m.from_name) ??
            asConvText(m.sender_name) ??
            (fromPage ? 'You' : null),
          text:
            asConvText(m.message) ??
            asConvText(m.text) ??
            asConvText(m.original_message) ??
            asConvText(m.content),
          at:
            asConvText(m.inserted_at) ??
            asConvText(m.created_at) ??
            asConvText(m.updated_at),
        };
      });
    return { ok: true, messages };
  } catch {
    return { ok: false, message: 'Pancake API is unavailable right now.' };
  }
}

/** Normalize a customer/FB name for de-duplication: lower-case, strip punctuation,
 *  collapse whitespace. Mirrors the SQL app_private.normalize_name used by auto-link. */
function normalizeConvName(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function listPancakeConversations(): Promise<PancakeConversationsResult> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, code: 'forbidden', message: cause.message, conversations: [] };
    }
    throw cause;
  }
  return fetchPancakeConversationsCore();
}

/**
 * The raw pages.fm conversation fetch — reads the page token/id from SERVER ENV and
 * has NO auth gate of its own. Only callers that have ALREADY authorized the request
 * may call it: `listPancakeConversations` (Owner session) or the CRON_SECRET-guarded
 * daily sync ([lib/integrations/pancake-system.ts]). Never reach this from the client.
 */
export async function fetchPancakeConversationsCore(): Promise<PancakeConversationsResult> {
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN;
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  const pageId = process.env.PANCAKE_PAGE_ID;
  if (!token || !token.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message:
        'Access token missing. Set PANCAKE_USER_ACCESS_TOKEN / PANCAKE_PAGE_ACCESS_TOKEN.',
      conversations: [],
    };
  }
  if (!pageId || !pageId.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message:
        'No Page selected. Set PANCAKE_PAGE_ID (from Save Selected Page) and redeploy.',
      conversations: [],
    };
  }

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_CONVERSATIONS_PATH || '/pages/{page_id}/conversations';
  const path = template.replace('{page_id}', encodeURIComponent(pageId.trim()));
  const tokenKind = pageToken ? 'page_access_token' : 'user_access_token';

  // pages.fm requires a `since`/`until` window AND caps each request at < 1 month,
  // AND paginates with a required `page_number`. So we walk back in ~28-day windows
  // over the configured look-back, paging through each window, and merge the results
  // (deduped by id) so a full history of chats can be linked. pages.fm also RATE
  // LIMITS (HTTP 429), so we pace requests and back off / retry on 429, keeping what
  // we already collected instead of failing outright.
  const now = Math.floor(Date.now() / 1000);
  const WINDOW = 28 * 86400; // < 1 month per pages.fm's limit
  const monthsRaw = Number(process.env.PANCAKE_CONVERSATIONS_MONTHS || '6');
  const months =
    Number.isFinite(monthsRaw) && monthsRaw > 0 ? Math.min(monthsRaw, 24) : 6;
  const earliest = now - months * 30 * 86400;
  const MAX_PAGES = 30; // safety cap per window
  const delayRaw = Number(process.env.PANCAKE_REQUEST_DELAY_MS || '350');
  const REQUEST_DELAY = Number.isFinite(delayRaw) && delayRaw >= 0 ? delayRaw : 350;
  const MAX_429_RETRIES = 3;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  const byId = new Map<string, PancakeConversation>();
  let lastDebug = '';
  let totalRaw = 0;
  let totalSkippedComments = 0;

  type PageData = {
    conversations: PancakeConversation[];
    rawCount: number;
    skippedComments: number;
  };

  // One request for a given window + page. Retries on 429 with backoff. Returns the
  // parsed conversations, a `rateLimited` signal (stop, keep what we have), or a
  // fatal result to bubble up (token/base/permission errors) that stops everything.
  const requestPage = async (
    since: number,
    until: number,
    pageNumber: number,
  ): Promise<
    { fatal: PancakeConversationsResult } | { rateLimited: true } | { page: PageData }
  > => {
    const win = `since=${since}&until=${until}&page_number=${pageNumber}`;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
      let res: Response;
      try {
        const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}&${win}`;
        res = await fetch(endpoint, {
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        return {
          fatal: {
            ok: false,
            code: 'unavailable',
            message: 'Pancake API unavailable. Please try again in a moment.',
            conversations: [],
            debug: `network error · GET ${base}${path} · token ${tokenKind} (${tokenParam})`,
          },
        };
      }

      // Read the RAW response so we can both parse it and surface a diagnostic snippet.
      const rawText = await res.text().catch(() => '');
      let body: unknown = null;
      try {
        body = rawText ? JSON.parse(rawText) : null;
      } catch {
        body = null;
      }
      lastDebug = `HTTP ${res.status} · GET ${base}${path}?${win} · token ${tokenKind} (${tokenParam}) · ${rawText.slice(0, 500)}`;

      // Rate limited: honour Retry-After when present, else exponential backoff, then
      // retry. When retries are exhausted, signal so the caller keeps partial results.
      if (res.status === 429) {
        if (attempt >= MAX_429_RETRIES) return { rateLimited: true };
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 1000 * 2 ** attempt;
        await sleep(waitMs);
        continue;
      }

      // A pages.fm web-app HTML page (not JSON) means the API base is wrong — usually
      // a missing /public_api/v1 segment. Report it plainly.
      if (/^\s*<(?:!doctype|html)/i.test(rawText)) {
        return {
          fatal: {
            ok: false,
            code: 'unavailable',
            message:
              'Pancake returned a web page, not data — the API base URL is wrong. It should be https://pages.fm/api/public_api/v1',
            conversations: [],
            debug: lastDebug,
          },
        };
      }
      if (res.status === 401) {
        return {
          fatal: {
            ok: false,
            code: 'token_invalid',
            message: 'Invalid or expired token.',
            conversations: [],
            debug: lastDebug,
          },
        };
      }
      if (res.status === 403) {
        return {
          fatal: {
            ok: false,
            code: 'permission_denied',
            message: 'Permission denied for conversations.',
            conversations: [],
            debug: lastDebug,
          },
        };
      }
      if (!res.ok) {
        return {
          fatal: {
            ok: false,
            code: 'unavailable',
            message: `Pancake responded ${res.status}.`,
            conversations: [],
            debug: lastDebug,
          },
        };
      }
      if (
        body &&
        typeof body === 'object' &&
        (body as { success?: boolean }).success === false
      ) {
        return {
          fatal: {
            ok: false,
            code: 'token_invalid',
            message: 'Pancake rejected the token.',
            conversations: [],
            debug: lastDebug,
          },
        };
      }

      return { page: extractConversations(body) };
    }
    // Unreachable (loop returns), but satisfies the type checker.
    return { rateLimited: true };
  };

  let rateLimited = false;
  outer: for (let until = now; until > earliest; until -= WINDOW) {
    const since = Math.max(earliest, until - WINDOW);
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const r = await requestPage(since, until, pageNumber);
      if ('fatal' in r) {
        // A hard error with nothing collected yet is fatal; if we already have some,
        // keep them (partial success) rather than throwing all of it away.
        if (byId.size === 0) return r.fatal;
        rateLimited = true;
        break outer;
      }
      if ('rateLimited' in r) {
        rateLimited = true;
        break outer;
      }
      totalRaw += r.page.rawCount;
      totalSkippedComments += r.page.skippedComments;
      if (r.page.rawCount === 0) break; // no more pages in this window
      for (const c of r.page.conversations) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
      await sleep(REQUEST_DELAY); // pace requests to stay under the rate limit
    }
  }

  // De-duped by conversation id above; now collapse to ONE per customer (same
  // normalized name counts once — Owner request). Preference within a name: a
  // messageable INBOX thread beats a post COMMENT; within the same kind the newest
  // thread wins. Un-named threads are kept individually.
  const byName = new Map<string, PancakeConversation>();
  const unnamed: PancakeConversation[] = [];
  for (const c of byId.values()) {
    const key = normalizeConvName(c.customerName ?? '');
    if (!key) {
      unnamed.push(c);
      continue;
    }
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, c);
      continue;
    }
    const prevComment = prev.isComment === true;
    const curComment = c.isComment === true;
    if (prevComment && !curComment) {
      byName.set(key, c); // an inbox thread replaces a comment
    } else if (
      prevComment === curComment &&
      (c.updatedAt ?? '') > (prev.updatedAt ?? '')
    ) {
      byName.set(key, c); // same kind → newest wins
    }
    // else: keep prev (it is inbox and the new one is a comment)
  }
  const conversations = [...byName.values(), ...unnamed];
  // Honest breakdown so the count is explainable (comments filtered, rate-limit cut-off).
  const breakdown =
    `${conversations.length} people (messages + comments)` +
    (totalSkippedComments > 0
      ? ` · ${totalSkippedComments} ratings/reviews skipped`
      : '') +
    ` · ${totalRaw} raw over ~${months} month(s)` +
    (rateLimited ? ' · rate-limited (partial)' : '');
  if (conversations.length === 0) {
    const msg = rateLimited
      ? 'Pancake is rate-limiting requests right now (HTTP 429). Please wait a minute and try again.'
      : 'No conversations found for this Page.';
    return {
      ok: false,
      code: rateLimited ? 'unavailable' : 'none_found',
      message: msg,
      conversations: [],
      debug: lastDebug,
    };
  }
  return {
    ok: true,
    code: 'loaded',
    message: rateLimited
      ? `Loaded ${breakdown}. Pancake rate-limited the rest — run it again in a minute to pick up older ones.`
      : `Loaded ${breakdown}.`,
    conversations,
    debug: lastDebug,
  };
}

/* ==========================================================================
 * Auto-link Pancake conversations to customers (Owner request): one click loads
 * the Page's conversations and fills customers.pancake_conversation_id by matching
 * on name — so Send Invoice / Reminder can auto-deliver with NO manual id entry.
 * ======================================================================== */

export type PancakeSyncResult = {
  ok: boolean;
  message: string;
  /** How many customers were linked this run. */
  matched: number;
  /** Conversations loaded from Pancake. */
  total: number;
  /** Active customers now linked to a Pancake conversation (running coverage). */
  linkedCustomers?: number;
  /** Total active customers. */
  totalCustomers?: number;
};

/** Running link coverage — how many active customers have a Pancake conversation (so
 *  are reachable by Send Invoice + the one-tap auto-send) out of all active customers.
 *  Works with either the user-scoped or the service-role client. */
export async function getPancakeLinkCoverage(
  supabase: SupabaseClient,
): Promise<{ linked: number; total: number }> {
  const [totalRes, linkedRes] = await Promise.all([
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true),
    supabase
      .from('customers')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .not('pancake_conversation_id', 'is', null),
  ]);
  return { linked: Number(linkedRes.count ?? 0), total: Number(totalRes.count ?? 0) };
}

/** The confirmation after a sync — this run's NEW links plus running coverage. */
export function buildPancakeSyncMessage(
  matched: number,
  linked: number,
  total: number,
): string {
  const newly = matched === 1 ? '1 new customer' : `${matched} new customers`;
  return (
    `Linked ${newly}. ${linked} of ${total} active customers are now reachable ` +
    `by Send Invoice and the one-tap auto-send.`
  );
}

/**
 * Capture-time LIVE lookup — find the Pancake conversation for an OCR'd name among the
 * MOST RECENT interactions (messages + comments, last ~2 days, page 1 only: a single
 * bounded API call, so it stays fast and rate-limit-friendly during a live). This is
 * what lets a live COMMENTER be auto-sent to before they are a saved, pre-linked
 * customer. SAFE: returns an id ONLY when exactly one distinct conversation carries
 * that normalized name — a shared/ambiguous name (or a person split across an inbox +
 * comment thread) returns null, so a screenshot is never sent to the wrong person.
 * Never throws; missing config/network → null.
 */
/** "first|last" of a conversation-normalized name (middle-name tolerant). */
function convNameKey(v: string): string {
  const n = normalizeConvName(v);
  if (!n) return '';
  const parts = n.split(' ');
  return `${parts[0]}|${parts[parts.length - 1]}`;
}

export async function findRecentPancakeConversationByName(
  name: string,
  opts?: { sinceDays?: number; maxPages?: number },
): Promise<{ conversationId: string | null; matchCount: number }> {
  const norm = normalizeConvName(name);
  if (norm.length < 2) return { conversationId: null, matchCount: 0 };
  const key = convNameKey(name);

  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = (pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN || '').trim();
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  const pageId = await getActivePancakePageId();
  if (!token || !pageId) return { conversationId: null, matchCount: 0 };

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_CONVERSATIONS_PATH || '/pages/{page_id}/conversations';
  const path = template.replace('{page_id}', encodeURIComponent(pageId));
  const now = Math.floor(Date.now() / 1000);
  // BOUNDED window so this stays fast (seconds, not the minutes the full 6-month load
  // takes). Live capture uses the tight default (2 days, 1 page); the order panel
  // passes a wider-but-still-bounded window.
  const sinceDays = Math.max(1, opts?.sinceDays ?? 2);
  // Up to 15 pages — but the loop stops early the moment the name is found, so a deep
  // cap only costs pages when the person is genuinely far back.
  const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 1, 15));
  const since = now - sinceDays * 86400;

  const byId = new Map<string, PancakeConversation>();
  for (let page = 1; page <= maxPages; page += 1) {
    const endpoint =
      `${base}${path}${path.includes('?') ? '&' : '?'}` +
      `${tokenParam}=${encodeURIComponent(token)}&since=${since}&until=${now}&page_number=${page}`;
    let convs: PancakeConversation[];
    try {
      const res = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) break;
      const body = (await res.json().catch(() => null)) as unknown;
      if (
        body &&
        typeof body === 'object' &&
        (body as { success?: boolean }).success === false
      ) {
        break;
      }
      convs = extractConversations(body).conversations;
    } catch {
      break;
    }
    if (convs.length === 0) break;
    for (const c of convs) if (!byId.has(c.id)) byId.set(c.id, c);
    // Early stop: once this name appears, stop paging — no need to fetch deeper. This
    // lets us search MANY pages cheaply (fast when the person is recent; only pages
    // deep when they're not), instead of always giving up after a few pages.
    let hit = false;
    for (const c of byId.values()) {
      const cn = c.customerName ?? '';
      if (normalizeConvName(cn) === norm || (key !== '' && convNameKey(cn) === key)) {
        hit = true;
        break;
      }
    }
    if (hit) break;
    if (page < maxPages) await new Promise((r) => setTimeout(r, 300)); // gentle pacing
  }

  const all = [...byId.values()];
  // EXACT full-name first — a single distinct conversation is a confident match.
  const exact = new Map<string, PancakeConversation>();
  for (const c of all) {
    if (normalizeConvName(c.customerName ?? '') === norm) exact.set(c.id, c);
  }
  if (exact.size === 1)
    return { conversationId: [...exact.values()][0]?.id ?? null, matchCount: 1 };
  if (exact.size > 1) return { conversationId: null, matchCount: exact.size };

  // FIRST+LAST fallback (middle-name tolerant) — still a single distinct conversation.
  if (key) {
    const fl = new Map<string, PancakeConversation>();
    for (const c of all) {
      if (convNameKey(c.customerName ?? '') === key) fl.set(c.id, c);
    }
    if (fl.size === 1)
      return { conversationId: [...fl.values()][0]?.id ?? null, matchCount: 1 };
    return { conversationId: null, matchCount: fl.size };
  }
  return { conversationId: null, matchCount: 0 };
}

/* Throttle the on-demand live-comment discovery so a burst of captures during a live
 * doesn't hammer Pancake — ONE crawl backfills EVERY commenter of the live thread, so
 * the captures that follow within the gap resolve straight from those backfilled rows. */
let lastLiveDiscoveryAt = 0;
const LIVE_DISCOVERY_MIN_GAP_MS = 6000;

/** (psid, name) pairs from a Pancake messages/comments response, tolerating the shapes
 *  pages.fm uses (a `from` object per message, or flat sender fields). */
function extractCommenters(body: unknown): Array<{ psid: string; name: string }> {
  const root =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const arr = (key: string): unknown[] => {
    const v = root?.[key];
    return Array.isArray(v) ? v : [];
  };
  // Whichever envelope pages.fm uses; overlaps are harmless (deduped by PSID below).
  const list: unknown[] = Array.isArray(body)
    ? body
    : [...arr('messages'), ...arr('data'), ...arr('comments')];
  const out: Array<{ psid: string; name: string }> = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as Record<string, unknown>;
    const from =
      mm.from && typeof mm.from === 'object'
        ? (mm.from as Record<string, unknown>)
        : null;
    const psid = asText(from?.id) || asText(mm.from_id) || asText(mm.sender_id);
    const name =
      asText(from?.name) || asText(mm.from_name) || asText(mm.sender_name);
    if (psid) out.push({ psid, name });
  }
  return out;
}

/**
 * FALLBACK — on-demand live-comment discovery. When the realtime Pancake webhook MISSED a
 * live comment, we still know the LIVE POST (from the comments it DID deliver). Pull that
 * post's comments from the Pancake API and backfill each commenter (page_id + PSID + name)
 * into pancake_webhook_events, so webhook_resolve_conversation_by_name can then resolve the
 * pinned name to a messageable {page_id}_{psid} chat. Best-effort, THROTTLED, never throws.
 * The endpoint template is env-overridable (PANCAKE_POST_COMMENTS_PATH) so the exact
 * pages.fm contract can be corrected without a code change. Returns how many were backfilled.
 */
export async function discoverAndBackfillLiveCommenters(
  supabase: SupabaseClient,
): Promise<number> {
  const nowMs = Date.now();
  if (nowMs - lastLiveDiscoveryAt < LIVE_DISCOVERY_MIN_GAP_MS) return 0;
  lastLiveDiscoveryAt = nowMs;

  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = (pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN || '').trim();
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  const pageId = await getActivePancakePageId();
  if (!token || !pageId) return 0;

  const { data: threads } = (await supabase.rpc('webhook_recent_live_threads', {
    p_active_page: pageId,
  })) as {
    data: Array<{
      page_id: string;
      livestream_post_id: string | null;
      raw_post_id: string | null;
    }> | null;
  };
  if (!threads || threads.length === 0) return 0;

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_POST_COMMENTS_PATH ||
    '/pages/{page_id}/conversations/{conversation_id}/messages';

  // The candidate conversation ids that might address the whole live thread's comments —
  // both the "{page_id}_{post}" form and the raw post id, since we can't be sure which
  // one pages.fm keys the comment feed on.
  const candidates = new Set<string>();
  for (const t of threads) {
    const full = (t.livestream_post_id ?? '').trim();
    const raw = (t.raw_post_id ?? '').trim();
    if (full) candidates.add(full);
    if (raw) candidates.add(raw);
  }

  let backfilled = 0;
  const seen = new Set<string>();
  for (const conv of candidates) {
    const path = template
      .replace('{page_id}', encodeURIComponent(pageId))
      .replace('{conversation_id}', encodeURIComponent(conv));
    let commenters: Array<{ psid: string; name: string }> = [];
    try {
      const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token)}`;
      const res = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const body = (await res.json().catch(() => null)) as unknown;
      if (
        body &&
        typeof body === 'object' &&
        (body as { success?: boolean }).success === false
      ) {
        continue;
      }
      commenters = extractCommenters(body);
    } catch {
      continue;
    }
    for (const c of commenters) {
      if (seen.has(c.psid)) continue;
      seen.add(c.psid);
      try {
        await supabase.rpc('webhook_backfill_live_commenter', {
          p_page_id: pageId,
          p_psid: c.psid,
          p_name: c.name || null,
          p_conversation_id: null,
          p_livestream_post_id: conv,
        });
        backfilled += 1;
      } catch {
        /* best-effort — a single backfill failure never blocks the rest */
      }
    }
  }
  return backfilled;
}

/**
 * The webhook fast-match, WITH the on-demand fallback: resolve a name to a messageable
 * {page_id}_{psid} chat from the stored Live-comment identities; if none matches and the
 * name isn't ambiguous, pull the live post's comments from Pancake (backfilling them) and
 * try ONCE more. Returns the raw conversation id + match count; each caller maps it to its
 * own link shape. Unique-gated inside the RPC — a shared name never guesses.
 */
export async function resolveConversationFromWebhook(
  supabase: SupabaseClient,
  name: string,
  activePage: string,
): Promise<{ conversationId: string | null; matchCount: number }> {
  const call = async () => {
    const r = (await supabase.rpc('webhook_resolve_conversation_by_name', {
      p_name: name,
      p_active_page: activePage,
    })) as { data: { conversationId?: string | null; matchCount?: number } | null };
    const id = (r.data?.conversationId ?? '').trim();
    return {
      conversationId: id && conversationBelongsToPage(id, activePage) ? id : null,
      matchCount: r.data?.matchCount ?? 0,
    };
  };
  let res = await call();
  // Missed by the realtime webhook (and not a shared name) → OPTIONALLY pull the live
  // post's comments and retry once. OPT-IN (PANCAKE_LIVE_DISCOVERY=1), OFF by default:
  // the webhook parser now captures EVERY commenter (video-live payload fix), so the
  // fast-match above already resolves them. The crawl uses a best-guess endpoint and would
  // otherwise add several seconds of latency to this HOT resolve path (mobile auto-send +
  // Send Invoice) for a not-yet-captured name. Kept behind the flag so it can be re-enabled.
  if (
    !res.conversationId &&
    res.matchCount <= 1 &&
    process.env.PANCAKE_LIVE_DISCOVERY === '1'
  ) {
    const found = await discoverAndBackfillLiveCommenters(supabase);
    if (found > 0) res = await call();
  }
  return res;
}

export type ResolvedConversation = {
  conversationId: string | null;
  /** How many candidates matched — >1 means ambiguous, so the id is null. */
  matchCount: number;
  source: 'customer' | 'customer_first_last' | 'pancake_live' | 'none';
};

/**
 * Resolve the Pancake conversation for a Facebook name — the one source of truth for
 * "who do we message" (the /api/mobile/customer/conversation route AND the PC's
 * Incoming Captures "Send to Messenger" both use this).
 *
 * Two tiers, and NEVER a guess when ambiguous:
 *   1. A pre-linked ACTIVE customer with that unique name (exact, then first+last).
 *   2. LIVE fallback — the person may have just commented and not be a saved customer
 *      yet; look the name up in the recent Pancake conversations. A name shared by 2+
 *      people returns null (never guessed).
 *
 * Takes an RLS-scoped supabase client so the caller's row-level security is the
 * boundary (a mobile Bearer client or the PC server client both work).
 */
export async function resolveConversationForName(
  supabase: SupabaseClient,
  rawName: string,
  opts?: { sinceDays?: number; maxPages?: number },
): Promise<ResolvedConversation> {
  const name = (rawName ?? '').trim();
  if (name.length < 2) return { conversationId: null, matchCount: 0, source: 'none' };

  const norm = normalizeName(name);
  const firstToken = name.split(/\s+/)[0] ?? name;
  const { data } = await supabase
    .from('customers')
    .select('display_name, pancake_conversation_id')
    .eq('is_active', true)
    .ilike('display_name', `%${firstToken.replace(/[%,]/g, ' ')}%`)
    .limit(50);

  const rows = (data ?? []) as Array<{
    display_name: string | null;
    pancake_conversation_id: string | null;
  }>;

  // A stored link can only be messaged if it lives on the ACTIVE send page — a link on
  // ANOTHER page is rejected by Pancake ("conversation_id not found", code 120). So a
  // wrong-page link is treated as UNLINKED: it never wins tier 1 and never blocks the
  // correct on-page match; the name falls through to the live lookup, which searches
  // the active page. This is the fix for multi-page link clutter from earlier syncs.
  const activePage = await getActivePancakePageId();
  const usable = (id: string | null) => conversationBelongsToPage(id, activePage);

  // Tier 1a — EXACT full-name; a unique link ON THE ACTIVE PAGE wins.
  const exact = rows.filter((c) => normalizeName(c.display_name ?? '') === norm);
  const exactUsable = exact.filter((c) => usable(c.pancake_conversation_id));
  if (exactUsable.length === 1) {
    return {
      conversationId: exactUsable[0]?.pancake_conversation_id ?? null,
      matchCount: exact.length,
      source: 'customer',
    };
  }
  // 2+ DIFFERENT on-page links for the same name is genuinely ambiguous — never guess.
  if (exactUsable.length > 1) {
    return { conversationId: null, matchCount: exactUsable.length, source: 'none' };
  }

  // Tier 1b — FIRST+LAST (middle-name tolerant), unique on-page link only.
  const key = nameKey(name);
  const flUsable = rows.filter(
    (c) => nameKey(c.display_name ?? '') === key && usable(c.pancake_conversation_id),
  );
  if (flUsable.length === 1) {
    return {
      conversationId: flUsable[0]?.pancake_conversation_id ?? null,
      matchCount: 1,
      source: 'customer_first_last',
    };
  }
  if (flUsable.length > 1) {
    return { conversationId: null, matchCount: flUsable.length, source: 'none' };
  }

  // Tier 1.5 — WEBHOOK FAST-MATCH: a recent Live commenter resolved from the webhook
  // identities (the exact person, straight from Pancake — no slow/rate-limited
  // conversations API). Builds the messageable inbox conversation {page_id}_{psid}; unique
  // name only (never guesses a shared name); a wrong-page/blank id is ignored so tier 2
  // still runs. This is what makes "tap the pinned comment → Send now" work during a live.
  const wh = await resolveConversationFromWebhook(supabase, name, activePage);
  if (wh.conversationId) {
    return { conversationId: wh.conversationId, matchCount: 1, source: 'pancake_live' };
  }
  if (wh.matchCount > 1) {
    return { conversationId: null, matchCount: wh.matchCount, source: 'none' };
  }

  // Tier 2 — LIVE lookup (returns a single unambiguous conversation, else null).
  const live = await findRecentPancakeConversationByName(name, {
    sinceDays: opts?.sinceDays ?? 7,
    maxPages: opts?.maxPages ?? 8,
  });
  return {
    conversationId: live.conversationId,
    matchCount: exact.length || live.matchCount,
    source: live.conversationId ? 'pancake_live' : 'none',
  };
}

export async function syncPancakeConversationsToCustomers(): Promise<PancakeSyncResult> {
  const conv = await listPancakeConversations();
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

  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('sync_pancake_conversations', {
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

  // Fill the profile photo for the just-linked customers (best-effort, fill-only —
  // never resets a link). Powers the capture confirm-picker's photo.
  const avatarPairs = conv.conversations
    .filter((c) => c.avatar && c.avatar.trim())
    .map((c) => ({ conversation_id: c.id, avatar: c.avatar }));
  if (avatarPairs.length > 0) {
    await supabase.rpc('set_customer_pancake_avatars', { p_pairs: avatarPairs }).then(
      () => undefined,
      () => undefined,
    );
  }

  const { linked, total: totalCustomers } = await getPancakeLinkCoverage(supabase);
  return {
    ok: true,
    message: buildPancakeSyncMessage(matched, linked, totalCustomers),
    matched,
    total: conv.conversations.length,
    linkedCustomers: linked,
    totalCustomers,
  };
}

/* ==========================================================================
 * Pancake Private Reply — sender (users[].id) resolution + the send primitive.
 * (Owner request 2026-08-17, verified official contract.) A Facebook Live COMMENT can
 * be privately replied to ONCE; the reply is TEXT-only and opens a REAL private
 * conversation the screenshot is then sent through (existing reply_inbox PHOTO flow).
 * `sender_id` MUST be an ACTIVE Pancake user (Get Users List), EXPLICITLY selected by
 * the Owner — never page_id, never a PSID/page_customer_id/fb_id, never guessed, never
 * users[0] by default. No sender selected → no private reply (fail-closed).
 * ======================================================================== */

/** One active Pancake page user — only the safe fields MineFlow needs. */
export type PancakePageUser = {
  id: string;
  name: string | null;
  status: string | null;
  statusInPage: string | null;
  isOnline: boolean | null;
  /** Raw page_permissions kept for DIAGNOSTICS only — MineFlow invents NO semantics. */
  pagePermissions: unknown;
};

export type PancakePageUsersResult = {
  ok: boolean;
  code: PancakePagesCode;
  message: string;
  users: PancakePageUser[];
  debug?: string;
};

/** Parse ONLY the official active `users[]` (never `disabled_users[]`), tolerant of shape. */
export function extractPageUsers(body: unknown): PancakePageUser[] {
  const root =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const usersVal = root?.users;
  const list: unknown[] = Array.isArray(usersVal) ? usersVal : [];
  const out: PancakePageUser[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const u = raw as Record<string, unknown>;
    const id = asText(u.id);
    if (!id) continue;
    out.push({
      id,
      name: asText(u.name) || null,
      status: asText(u.status) || null,
      statusInPage: asText(u.status_in_page) || null,
      isOnline: typeof u.is_online === 'boolean' ? u.is_online : null,
      pagePermissions: u.page_permissions ?? null,
    });
  }
  return out;
}

/**
 * Get the ACTIVE users of the connected Page (pages.fm Get Users List:
 * `GET /pages/{page_id}/users`) so the Owner can choose the authorized Private Reply
 * sender. Primary Super Admin only; the token stays server-side and the token-bearing
 * URL is never logged. Only `users[]` is offered — `disabled_users[]` is ignored.
 */
export async function getPancakePageUsers(): Promise<PancakePageUsersResult> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError)
      return { ok: false, code: 'forbidden', message: cause.message, users: [] };
    throw cause;
  }
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN;
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  const pageId = await getActivePancakePageId();
  if (!token || !token.trim())
    return { ok: false, code: 'token_missing', message: 'Access token missing.', users: [] };
  if (!pageId)
    return { ok: false, code: 'token_missing', message: 'No Page selected.', users: [] };

  const base = resolvePancakeApiBase();
  const template = process.env.PANCAKE_USERS_PATH || '/pages/{page_id}/users';
  const path = template.replace('{page_id}', encodeURIComponent(pageId.trim()));
  let res: Response;
  try {
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}`;
    res = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  } catch {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Pancake API unavailable. Please try again in a moment.',
      users: [],
    };
  }
  const rawText = await res.text().catch(() => '');
  let bodyU: unknown = null;
  try {
    bodyU = rawText ? JSON.parse(rawText) : null;
  } catch {
    bodyU = null;
  }
  const debug = `HTTP ${res.status} · GET ${base}${path} · ${rawText.slice(0, 300)}`;
  if (res.status === 401)
    return { ok: false, code: 'token_invalid', message: 'Invalid or expired token.', users: [], debug };
  if (res.status === 403)
    return { ok: false, code: 'permission_denied', message: 'Permission denied for users.', users: [], debug };
  if (!res.ok)
    return { ok: false, code: 'unavailable', message: `Pancake responded ${res.status}.`, users: [], debug };
  if (bodyU && typeof bodyU === 'object' && (bodyU as { success?: boolean }).success === false)
    return { ok: false, code: 'token_invalid', message: 'Pancake rejected the token.', users: [], debug };
  const users = extractPageUsers(bodyU);
  if (users.length === 0)
    return { ok: false, code: 'none_found', message: 'No active Pancake users found for this Page.', users: [], debug };
  return {
    ok: true,
    code: 'loaded',
    message: `Loaded ${users.length} active Pancake user(s).`,
    users,
    debug,
  };
}

/** The saved Private Reply sender (an active Pancake users[].id), or null if none. */
export type SelectedPancakeSender = { userId: string; userName: string | null };

export async function getSelectedPancakeSender(): Promise<SelectedPancakeSender | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('pancake_integration_config')
    .select('sender_user_id, sender_user_name')
    .maybeSingle();
  const id = ((data?.sender_user_id as string | null) ?? '').trim();
  if (!id) return null;
  return { userId: id, userName: (data?.sender_user_name as string | null) ?? null };
}

export type SaveSenderResult = { ok: true; userId: string } | { ok: false; error: string };

/**
 * Persist the explicitly-chosen Private Reply sender. Primary Super Admin only. The
 * chosen id MUST be one of the Page's ACTIVE users (re-validated here against a fresh
 * Get Users List) so a disabled/absent user can never be saved as the sender.
 */
export async function saveSelectedPancakeSender(input: {
  userId: string;
  userName?: string | null;
}): Promise<SaveSenderResult> {
  try {
    await requirePrimarySuperAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const userId = (input.userId ?? '').trim();
  if (!userId) return { ok: false, error: 'Choose a Pancake user before saving.' };
  const active = await getPancakePageUsers();
  if (!active.ok) return { ok: false, error: active.message };
  const match = active.users.find((u) => u.id === userId);
  if (!match) {
    return {
      ok: false,
      error:
        'That user is not an active Pancake user on this Page. Reload the list and pick an active user.',
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('save_pancake_sender_selection', {
    p_user_id: userId,
    p_user_name: input.userName ?? match.name ?? null,
  });
  if (error) return { ok: false, error: 'The sender could not be saved. Please try again.' };
  return { ok: true, userId };
}

/**
 * Resolve the configured Private Reply sender id (fail-closed). Returns null when no
 * sender has been selected — the caller MUST NOT send a private reply then (Owner rule:
 * no sender selected → no automatic private reply).
 */
export async function resolvePancakeSenderUserId(): Promise<string | null> {
  const sender = await getSelectedPancakeSender();
  return sender?.userId ?? null;
}

export type PancakePrivateReplyResult = {
  ok: boolean;
  code:
    | 'sent'
    | 'sender_unset'
    | 'token_missing'
    | 'page_missing'
    | 'unavailable'
    | 'already_replied'
    | 'failed';
  message: string;
  /** The real private conversation id, when Pancake returns one in the response. */
  privateConversationId: string | null;
  pancakeMessageId: string | null;
  debug?: string;
};

/** Pull a private/inbox conversation id from a private_replies response, tolerating shapes. */
function extractPrivateConversationId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const candidates: unknown[] = [
    (b.private_reply_conversation as Record<string, unknown> | undefined)?.id,
    (b.conversation as Record<string, unknown> | undefined)?.id,
    b.conversation_id,
    (b.data as Record<string, unknown> | undefined)?.conversation_id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number') return String(c);
  }
  return null;
}

/**
 * The centralized default Private Reply initiation text (Owner may override per send /
 * via a template later). Kept in ONE place so the initiation message is never hardcoded
 * across the code. `{customer_name}` is substituted with the commenter's name when known.
 */
export const DEFAULT_PRIVATE_REPLY_TEXT =
  'Hi {customer_name}! Here is the item you mined during our Live. 💛';

/**
 * The VERIFIED private_replies body — pure + exported so the exact field mapping is
 * unit-lockable. TEXT only: `action=private_replies` + post_id/message_id/from_id/
 * sender_id/message. NO conversation_id in the body, NO content_ids/attachment_type
 * (the official schema has no photo field — the screenshot is sent afterward).
 */
export function buildPrivateReplyBody(input: {
  postId: string;
  messageId: string;
  fromId: string;
  senderId: string;
  message: string;
}): Record<string, string> {
  return {
    action: 'private_replies',
    post_id: input.postId,
    message_id: input.messageId,
    from_id: input.fromId,
    sender_id: input.senderId,
    message: input.message,
  };
}

/**
 * Send a TEXT Private Reply to a Facebook Live COMMENT (verified official Pancake
 * contract). Body: `{ action: 'private_replies', post_id, message_id, from_id,
 * sender_id, message }`. `sender_id` is the explicitly-selected active Pancake user
 * (fail-closed if unset). TEXT ONLY — the schema exposes no content_ids; the screenshot
 * is sent AFTERWARD through the resulting real private conversation via reply_inbox
 * PHOTO. The path is env-overridable (PANCAKE_PRIVATE_REPLY_PATH) so the exact contract
 * can be corrected without a code change. Never logs the token.
 */
export async function sendPancakePrivateReply(input: {
  postId: string;
  messageId: string;
  fromId: string;
  /** The COMMENT conversation id — used for the endpoint PATH only, not sent in the body. */
  commentConversationId: string;
  message: string;
}): Promise<PancakePrivateReplyResult> {
  const senderId = await resolvePancakeSenderUserId();
  if (!senderId) {
    return {
      ok: false,
      code: 'sender_unset',
      message:
        'No Pancake Private Reply sender is selected. An Owner must choose the authorized sender in Settings → Integrations before private replies can be sent.',
      privateConversationId: null,
      pancakeMessageId: null,
    };
  }
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN;
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  if (!token || !token.trim())
    return {
      ok: false,
      code: 'token_missing',
      message: 'Access token missing.',
      privateConversationId: null,
      pancakeMessageId: null,
    };
  const pageId = await getActivePancakePageId();
  if (!pageId)
    return {
      ok: false,
      code: 'page_missing',
      message: 'No Page selected.',
      privateConversationId: null,
      pancakeMessageId: null,
    };
  const postId = (input.postId ?? '').trim();
  const messageId = (input.messageId ?? '').trim();
  const fromId = (input.fromId ?? '').trim();
  if (!postId || !messageId || !fromId)
    return {
      ok: false,
      code: 'failed',
      message: 'Missing comment identity (post/message/from).',
      privateConversationId: null,
      pancakeMessageId: null,
    };

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_PRIVATE_REPLY_PATH ||
    '/pages/{page_id}/conversations/{conversation_id}/messages';
  const path = template
    .replace('{page_id}', encodeURIComponent(pageId.trim()))
    .replace('{conversation_id}', encodeURIComponent((input.commentConversationId ?? '').trim()));

  let res: Response;
  try {
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}`;
    // pages.fm public API is form/query based. The verified private_replies body is
    // exactly these fields — no conversation_id in the body, no content_ids (text only).
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(
      buildPrivateReplyBody({ postId, messageId, fromId, senderId, message: input.message }),
    )) {
      form.set(k, v);
    }
    res = await fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return {
      ok: false,
      code: 'unavailable',
      message: 'Pancake API unavailable. Please try again in a moment.',
      privateConversationId: null,
      pancakeMessageId: null,
    };
  }
  const rawText = await res.text().catch(() => '');
  let body: unknown = null;
  try {
    body = rawText ? JSON.parse(rawText) : null;
  } catch {
    body = null;
  }
  const debug = `HTTP ${res.status} · private_replies · ${rawText.slice(0, 400)}`;
  const rejected =
    !res.ok ||
    (body &&
      typeof body === 'object' &&
      (body as { success?: boolean }).success === false);
  if (rejected) {
    // Pancake #10900 "Activity already replied to" is an EXPECTED response, not a
    // contract/endpoint failure — the comment was already privately replied to (a
    // comment can be privately replied to only once). Classify it distinctly so a
    // caller never retries or treats it as an endpoint error, and surface any existing
    // private conversation for DIAGNOSTICS only.
    if (/\b10900\b/.test(rawText) || /already\s+replied/i.test(rawText)) {
      return {
        ok: false,
        code: 'already_replied',
        message:
          'This comment was already privately replied to (Pancake #10900) — not a contract error. Use a brand-new comment.',
        privateConversationId: extractPrivateConversationId(body),
        pancakeMessageId: null,
        debug,
      };
    }
    return {
      ok: false,
      code: 'failed',
      message: 'Pancake rejected the private reply.',
      privateConversationId: null,
      pancakeMessageId: null,
      debug,
    };
  }
  return {
    ok: true,
    code: 'sent',
    message: 'Private reply sent.',
    privateConversationId: extractPrivateConversationId(body),
    pancakeMessageId: extractMessageId(body),
    debug,
  };
}

/**
 * NARROW Get Conversations lookup for the REAL inbox conversation of a specific PSID —
 * the API fallback used AFTER a successful private reply to check whether Pancake
 * created a messageable inbox thread (without the customer replying). It fetches only a
 * recent, bounded window (never full history), searches by the conversation id that
 * ENDS WITH `_{psid}` (the inbox form Pancake itself returns), and returns THAT real id.
 * It never searches by name and never synthesizes `{page_id}_{psid}` — the id returned
 * is the one Pancake emitted. Returns null when Pancake has not created/exposed one yet.
 */
export async function findPancakeInboxConversationByPsid(
  psid: string,
  opts?: { sinceMinutes?: number; maxPages?: number },
): Promise<{ conversationId: string | null; scanned: number; debug?: string }> {
  const p = (psid ?? '').trim();
  if (!p) return { conversationId: null, scanned: 0 };
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN;
  const token = (pageToken || process.env.PANCAKE_USER_ACCESS_TOKEN || '').trim();
  const tokenParam =
    process.env.PANCAKE_SEND_TOKEN_PARAM ||
    (pageToken ? 'page_access_token' : 'access_token');
  const pageId = await getActivePancakePageId();
  if (!token || !pageId) return { conversationId: null, scanned: 0 };

  const base = resolvePancakeApiBase();
  const template =
    process.env.PANCAKE_CONVERSATIONS_PATH || '/pages/{page_id}/conversations';
  const path = template.replace('{page_id}', encodeURIComponent(pageId));
  const now = Math.floor(Date.now() / 1000);
  const since = now - Math.max(1, opts?.sinceMinutes ?? 60) * 60;
  const maxPages = Math.max(1, Math.min(opts?.maxPages ?? 2, 5));
  const suffix = `_${p}`;
  let scanned = 0;
  let lastDebug = '';

  for (let page = 1; page <= maxPages; page += 1) {
    let convs: PancakeConversation[] = [];
    try {
      const endpoint =
        `${base}${path}${path.includes('?') ? '&' : '?'}` +
        `${tokenParam}=${encodeURIComponent(token)}&since=${since}&until=${now}&page_number=${page}`;
      const res = await fetch(endpoint, {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      const rawText = await res.text().catch(() => '');
      lastDebug = `HTTP ${res.status} · GET conversations p${page} · ${rawText.slice(0, 120)}`;
      if (!res.ok) break;
      let body: unknown = null;
      try {
        body = rawText ? JSON.parse(rawText) : null;
      } catch {
        body = null;
      }
      if (
        body &&
        typeof body === 'object' &&
        (body as { success?: boolean }).success === false
      ) {
        break;
      }
      convs = extractConversations(body).conversations;
    } catch {
      break;
    }
    if (convs.length === 0) break;
    for (const c of convs) {
      scanned += 1;
      if (c.id.endsWith(suffix)) {
        return { conversationId: c.id, scanned, debug: lastDebug };
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { conversationId: null, scanned, debug: lastDebug };
}
