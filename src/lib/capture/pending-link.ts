import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { nameKey, normalizeName } from '@/lib/customers/matching';
import {
  conversationBelongsToPage,
  findRecentPancakeConversationByName,
  getActivePancakePageId,
} from '@/lib/integrations/pancake';

/**
 * Capture-time customer linking (2026-08-09). The moment a floating capture's
 * Facebook name is known, resolve WHO it is — the MineFlow customer + their Pancake
 * conversation — so the PC's Incoming Captures shows a "Linked Facebook Customer"
 * panel BEFORE the capture becomes an order, and (when unambiguous) auto-sends the
 * screenshot. Page-aware throughout (a link on another page is never used) and it
 * NEVER guesses when two customers share the name — it asks the operator to confirm.
 */

export type CaptureLinkStatus =
  | 'linked' // a unique customer + a messageable conversation on the active page
  | 'needs_confirmation' // 2+ people share this name — the operator must pick
  | 'customer_no_chat' // a unique customer, but no messageable conversation yet
  | 'no_match'; // no customer and no conversation found

export type CaptureLink = {
  linkStatus: CaptureLinkStatus;
  customerId: string | null;
  customerName: string | null;
  conversationId: string | null;
  conversationAvailable: boolean;
  /** The linked customer's saved Messenger URL, for "Open Conversation". */
  fbUrl: string | null;
  /** How many candidates matched — drives the "N possible matches" confirm UI. */
  matchCount: number;
};

export type CaptureCandidate = {
  customerId: string;
  displayName: string;
  contactNumber: string | null;
  /** True when this customer has a conversation ON the active send page. */
  hasConversation: boolean;
  fbUrl: string | null;
};

type Row = {
  id: string;
  display_name: string | null;
  pancake_conversation_id: string | null;
  contact_number: string | null;
  facebook_conversation_url: string | null;
};

const SELECT = 'id, display_name, pancake_conversation_id, contact_number, facebook_conversation_url';

/** Narrow an untyped Supabase result to our Row shape (params are `unknown`, so the
 *  assertion genuinely narrows — no `any`-cast lint noise). */
function asRows(data: unknown): Row[] {
  return (data ?? []) as Row[];
}
function asRow(data: unknown): Row | null {
  return (data as Row | null) ?? null;
}

/** Active customers whose name shares the first token — the candidate pool. */
async function candidateRows(supabase: SupabaseClient, name: string): Promise<Row[]> {
  const firstToken = name.split(/\s+/)[0] ?? name;
  const { data } = await supabase
    .from('customers')
    .select(SELECT)
    .eq('is_active', true)
    .ilike('display_name', `%${firstToken.replace(/[%,]/g, ' ')}%`)
    .limit(50);
  return asRows(data);
}

function linkedFromRow(row: Row, conversationId: string, matchCount: number): CaptureLink {
  return {
    linkStatus: 'linked',
    customerId: row.id,
    customerName: (row.display_name ?? '').trim() || null,
    conversationId,
    conversationAvailable: true,
    fbUrl: (row.facebook_conversation_url ?? '').trim() || null,
    matchCount,
  };
}

const NO_MATCH: CaptureLink = {
  linkStatus: 'no_match',
  customerId: null,
  customerName: null,
  conversationId: null,
  conversationAvailable: false,
  fbUrl: null,
  matchCount: 0,
};

/**
 * Resolve a capture's identity from its detected Facebook name (page-aware, never a
 * guess when ambiguous). If the capture already carries an on-page conversation
 * (e.g. from a prior send), that is kept.
 */
export async function resolveCaptureIdentity(
  supabase: SupabaseClient,
  rawName: string,
  existingConversationId?: string | null,
): Promise<CaptureLink> {
  const activePage = await getActivePancakePageId();
  const onPage = (id: string | null | undefined) => conversationBelongsToPage(id ?? null, activePage);

  // Already messageable on the active page → keep it; fill the owning customer if we can.
  const existing = (existingConversationId ?? '').trim();
  if (existing && onPage(existing)) {
    const { data } = await supabase
      .from('customers')
      .select(SELECT)
      .eq('is_active', true)
      .eq('pancake_conversation_id', existing)
      .limit(1)
      .maybeSingle();
    const row = asRow(data);
    return row
      ? linkedFromRow(row, existing, 1)
      : {
          linkStatus: 'linked',
          customerId: null,
          customerName: null,
          conversationId: existing,
          conversationAvailable: true,
          fbUrl: null,
          matchCount: 1,
        };
  }

  const name = (rawName ?? '').trim();
  if (name.length < 2) return NO_MATCH;

  const rows = await candidateRows(supabase, name);
  const norm = normalizeName(name);
  const key = nameKey(name);

  // A helper that resolves a SINGLE known customer to a link (their on-page chat,
  // else a live-lookup chat, else "customer with no chat yet").
  const resolveKnownCustomer = async (row: Row): Promise<CaptureLink> => {
    if (onPage(row.pancake_conversation_id)) {
      return linkedFromRow(row, row.pancake_conversation_id as string, 1);
    }
    const live = await findRecentPancakeConversationByName(name, { sinceDays: 7, maxPages: 8 });
    if (live.conversationId) return linkedFromRow(row, live.conversationId, 1);
    if (live.matchCount > 1) {
      return { ...NO_MATCH, linkStatus: 'needs_confirmation', matchCount: live.matchCount };
    }
    return {
      linkStatus: 'customer_no_chat',
      customerId: row.id,
      customerName: (row.display_name ?? '').trim() || null,
      conversationId: null,
      conversationAvailable: false,
      fbUrl: (row.facebook_conversation_url ?? '').trim() || null,
      matchCount: 1,
    };
  };

  // Tier 1 — EXACT full name.
  const exact = rows.filter((c) => normalizeName(c.display_name ?? '') === norm);
  const exactUsable = exact.filter((c) => onPage(c.pancake_conversation_id));
  if (exactUsable.length === 1) return linkedFromRow(exactUsable[0]!, exactUsable[0]!.pancake_conversation_id as string, exact.length);
  if (exact.length > 1) return { ...NO_MATCH, linkStatus: 'needs_confirmation', matchCount: exact.length };
  if (exact.length === 1) return resolveKnownCustomer(exact[0]!);

  // Tier 2 — FIRST+LAST (middle-name tolerant).
  const fl = rows.filter((c) => nameKey(c.display_name ?? '') === key);
  const flUsable = fl.filter((c) => onPage(c.pancake_conversation_id));
  if (flUsable.length === 1) return linkedFromRow(flUsable[0]!, flUsable[0]!.pancake_conversation_id as string, 1);
  if (fl.length > 1) return { ...NO_MATCH, linkStatus: 'needs_confirmation', matchCount: fl.length };
  if (fl.length === 1) return resolveKnownCustomer(fl[0]!);

  // Tier 3 — LIVE lookup for a not-yet-saved customer (single unambiguous chat only).
  const live = await findRecentPancakeConversationByName(name, { sinceDays: 7, maxPages: 8 });
  if (live.conversationId) {
    return {
      linkStatus: 'linked',
      customerId: null,
      customerName: name,
      conversationId: live.conversationId,
      conversationAvailable: true,
      fbUrl: null,
      matchCount: 1,
    };
  }
  if (live.matchCount > 1) return { ...NO_MATCH, linkStatus: 'needs_confirmation', matchCount: live.matchCount };
  return NO_MATCH;
}

/** Persist a resolved (or operator-chosen) link onto the pending capture. */
export async function persistCaptureLink(
  supabase: SupabaseClient,
  captureRecordId: string,
  link: Pick<CaptureLink, 'linkStatus' | 'customerId' | 'conversationId'>,
): Promise<void> {
  await supabase.rpc('set_capture_customer_link', {
    p_capture_record_id: captureRecordId,
    p_customer_id: link.customerId,
    p_conversation_id: link.conversationId,
    p_pancake_customer_id: null,
    p_link_status: link.linkStatus,
  });
}

/** Resolve a capture's identity from its name and PERSIST it. Returns the link. */
export async function resolveAndPersistCaptureLink(
  supabase: SupabaseClient,
  captureRecordId: string,
  rawName: string,
  existingConversationId?: string | null,
): Promise<CaptureLink> {
  const link = await resolveCaptureIdentity(supabase, rawName, existingConversationId);
  await persistCaptureLink(supabase, captureRecordId, link);
  return link;
}

/** The same-name customers an operator can pick from (needs-confirmation / Change). */
export async function listCaptureCandidates(
  supabase: SupabaseClient,
  rawName: string,
): Promise<CaptureCandidate[]> {
  const name = (rawName ?? '').trim();
  if (name.length < 2) return [];
  const activePage = await getActivePancakePageId();
  const rows = await candidateRows(supabase, name);
  const norm = normalizeName(name);
  const key = nameKey(name);
  const picked = rows.filter(
    (c) => normalizeName(c.display_name ?? '') === norm || nameKey(c.display_name ?? '') === key,
  );
  return picked.slice(0, 8).map((c) => ({
    customerId: c.id,
    displayName: (c.display_name ?? '').trim(),
    contactNumber: (c.contact_number ?? '').trim() || null,
    hasConversation: conversationBelongsToPage(c.pancake_conversation_id, activePage),
    fbUrl: (c.facebook_conversation_url ?? '').trim() || null,
  }));
}

/** Resolve ONE explicitly chosen customer to a link (the operator's Change/confirm). */
export async function resolveChosenCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<CaptureLink> {
  const { data } = await supabase
    .from('customers')
    .select(SELECT)
    .eq('id', customerId)
    .maybeSingle();
  const row = asRow(data);
  if (!row) return NO_MATCH;
  const activePage = await getActivePancakePageId();
  if (conversationBelongsToPage(row.pancake_conversation_id, activePage)) {
    return linkedFromRow(row, row.pancake_conversation_id as string, 1);
  }
  // Chosen customer has no on-page chat — try a live lookup by their name.
  const live = await findRecentPancakeConversationByName((row.display_name ?? '').trim(), {
    sinceDays: 7,
    maxPages: 8,
  });
  if (live.conversationId) return linkedFromRow(row, live.conversationId, 1);
  return {
    linkStatus: 'customer_no_chat',
    customerId: row.id,
    customerName: (row.display_name ?? '').trim() || null,
    conversationId: null,
    conversationAvailable: false,
    fbUrl: (row.facebook_conversation_url ?? '').trim() || null,
    matchCount: 1,
  };
}
