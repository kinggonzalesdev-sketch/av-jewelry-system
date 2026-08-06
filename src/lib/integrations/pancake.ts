import 'server-only';

import { AuthorizationError, requirePrimarySuperAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

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

  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;

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

/** How many active customers already have a Pancake conversation linked. This is the
 *  PERSISTENT proof that Send Invoice / Reminder can auto-deliver — the links live in
 *  the database, so they survive refreshes and never need re-linking unless customers
 *  are added. */
export type PancakeLinkStatus = { linked: number; total: number };

export async function getPancakeLinkStatus(): Promise<PancakeLinkStatus> {
  const supabase = await createClient();
  const [{ count: total }, { count: linked }] = await Promise.all([
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('is_active', true),
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
  | { ok: true; message: string; pageId: string }
  | { ok: false; error: string };

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
    return { ok: false, error: 'The Page selection could not be saved. Please try again.' };
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
};

/** Pull a message id out of Pancake's response without assuming one exact shape. */
function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const candidates = [b.message_id, b.id, (b.data as Record<string, unknown> | undefined)?.id];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (typeof c === 'number') return String(c);
  }
  return null;
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
    process.env.PANCAKE_SEND_TOKEN_PARAM || (pageToken ? 'page_access_token' : 'access_token');
  if (!token || !token.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message:
        'Access token missing. Set PANCAKE_PAGE_ACCESS_TOKEN (or PANCAKE_USER_ACCESS_TOKEN) and redeploy.',
      pancakeMessageId: null,
    };
  }
  const pageId = process.env.PANCAKE_PAGE_ID;
  if (!pageId || !pageId.trim()) {
    return {
      ok: false,
      code: 'page_missing',
      message: 'No Page selected. Set PANCAKE_PAGE_ID (from Save Selected Page) and redeploy.',
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
    process.env.PANCAKE_SEND_PATH || '/pages/{page_id}/conversations/{conversation_id}/messages';
  const path = template
    .replace('{page_id}', encodeURIComponent(pageId.trim()))
    .replace('{conversation_id}', encodeURIComponent(conversationId));

  let res: Response;
  try {
    const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}`;
    // pages.fm's public API is FORM/QUERY based (the conversations list uses query
    // params, not JSON). A JSON body is rejected with a generic "Something went
    // wrong", so we send `application/x-www-form-urlencoded`. `action=reply_inbox`
    // is the reply mode; `content_url` carries an image when attached.
    const form = new URLSearchParams();
    form.set('action', 'reply_inbox');
    form.set('message', input.message);
    if (input.attachmentUrl) form.set('content_url', input.attachmentUrl);
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
      };
    }
    return {
      ok: false,
      code: 'failed',
      message: 'Pancake rejected the message. The reminder is saved — you can retry, or send it via Open FB Chat.',
      pancakeMessageId: null,
      debug,
    };
  }

  return {
    ok: true,
    code: 'sent',
    message: 'Sent to the customer through Pancake.',
    pancakeMessageId: extractMessageId(body),
    debug,
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
  const root = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
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
    // Only private inbox chats — Pancake's conversations feed also includes public
    // post COMMENTs and RATINGs, which are not people we message an invoice to. Skip
    // those; keep INBOX and anything whose type we don't recognise (never lose data).
    const convType = (asConvText(c.type) ?? asConvText(c.conversation_type) ?? '').toUpperCase();
    if (/COMMENT|RATING|REVIEW|FEED/.test(convType)) {
      skippedComments += 1;
      continue;
    }
    const from = c.from as Record<string, unknown> | undefined;
    const cust = c.customer as Record<string, unknown> | undefined;
    const pageCust = c.page_customer as Record<string, unknown> | undefined;
    // pages.fm usually carries the person in a `customers` ARRAY (the participants),
    // not a single `customer`. Fall back through every shape we've seen so names show
    // instead of "Unknown".
    const custArr = Array.isArray(c.customers) ? (c.customers as Record<string, unknown>[]) : [];
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
    out.push({ id, customerName, snippet, updatedAt, avatar });
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
  | { ok: true; messages: PancakeMessage[] }
  | { ok: false; message: string };

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
    process.env.PANCAKE_SEND_TOKEN_PARAM || (pageToken ? 'page_access_token' : 'access_token');
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
    const res = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
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
          m.from && typeof m.from === 'object' ? (m.from as Record<string, unknown>) : null;
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
          at: asConvText(m.inserted_at) ?? asConvText(m.created_at) ?? asConvText(m.updated_at),
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
    process.env.PANCAKE_SEND_TOKEN_PARAM || (pageToken ? 'page_access_token' : 'access_token');
  const pageId = process.env.PANCAKE_PAGE_ID;
  if (!token || !token.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message: 'Access token missing. Set PANCAKE_USER_ACCESS_TOKEN / PANCAKE_PAGE_ACCESS_TOKEN.',
      conversations: [],
    };
  }
  if (!pageId || !pageId.trim()) {
    return {
      ok: false,
      code: 'token_missing',
      message: 'No Page selected. Set PANCAKE_PAGE_ID (from Save Selected Page) and redeploy.',
      conversations: [],
    };
  }

  const base = resolvePancakeApiBase();
  const template = process.env.PANCAKE_CONVERSATIONS_PATH || '/pages/{page_id}/conversations';
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
  const months = Number.isFinite(monthsRaw) && monthsRaw > 0 ? Math.min(monthsRaw, 24) : 6;
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

  type PageData = { conversations: PancakeConversation[]; rawCount: number; skippedComments: number };

  // One request for a given window + page. Retries on 429 with backoff. Returns the
  // parsed conversations, a `rateLimited` signal (stop, keep what we have), or a
  // fatal result to bubble up (token/base/permission errors) that stops everything.
  const requestPage = async (
    since: number,
    until: number,
    pageNumber: number,
  ): Promise<
    | { fatal: PancakeConversationsResult }
    | { rateLimited: true }
    | { page: PageData }
  > => {
    const win = `since=${since}&until=${until}&page_number=${pageNumber}`;
    for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt += 1) {
      let res: Response;
      try {
        const endpoint = `${base}${path}${path.includes('?') ? '&' : '?'}${tokenParam}=${encodeURIComponent(token.trim())}&${win}`;
        res = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
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
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
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
        return { fatal: { ok: false, code: 'token_invalid', message: 'Invalid or expired token.', conversations: [], debug: lastDebug } };
      }
      if (res.status === 403) {
        return { fatal: { ok: false, code: 'permission_denied', message: 'Permission denied for conversations.', conversations: [], debug: lastDebug } };
      }
      if (!res.ok) {
        return { fatal: { ok: false, code: 'unavailable', message: `Pancake responded ${res.status}.`, conversations: [], debug: lastDebug } };
      }
      if (body && typeof body === 'object' && (body as { success?: boolean }).success === false) {
        return { fatal: { ok: false, code: 'token_invalid', message: 'Pancake rejected the token.', conversations: [], debug: lastDebug } };
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
  // normalized name → the newest thread wins) so a person who appears in multiple
  // threads counts once (Owner request). Un-named threads are kept individually.
  const byName = new Map<string, PancakeConversation>();
  const unnamed: PancakeConversation[] = [];
  for (const c of byId.values()) {
    const key = normalizeConvName(c.customerName ?? '');
    if (!key) {
      unnamed.push(c);
      continue;
    }
    const prev = byName.get(key);
    if (!prev || (c.updatedAt ?? '') > (prev.updatedAt ?? '')) byName.set(key, c);
  }
  const conversations = [...byName.values(), ...unnamed];
  // Honest breakdown so the count is explainable (comments filtered, rate-limit cut-off).
  const breakdown =
    `${conversations.length} inbox` +
    (totalSkippedComments > 0 ? ` · ${totalSkippedComments} comments/ratings skipped` : '') +
    ` · ${totalRaw} raw over ~${months} month(s)` +
    (rateLimited ? ' · rate-limited (partial)' : '');
  if (conversations.length === 0) {
    const msg = rateLimited
      ? 'Pancake is rate-limiting requests right now (HTTP 429). Please wait a minute and try again.'
      : 'No conversations found for this Page.';
    return { ok: false, code: rateLimited ? 'unavailable' : 'none_found', message: msg, conversations: [], debug: lastDebug };
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
  /** How many customers were linked. */
  matched: number;
  /** Conversations loaded from Pancake. */
  total: number;
};

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
  return {
    ok: true,
    message: `Linked ${matched} customer(s) from ${conv.conversations.length} conversation(s). Send Invoice / Reminder will now auto-deliver to them.`,
    matched,
    total: conv.conversations.length,
  };
}
