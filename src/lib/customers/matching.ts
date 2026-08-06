import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type {
  CustomerMatch,
  CustomerMatchOutcome,
  CustomerMatchQuery,
  MatchConfidence,
  MatchSource,
} from '@/lib/customers/matching-types';

/**
 * THE shared customer-matching service (spec §1/§2). One implementation, reused by
 * every surface — Orders, Walk-In, Layaway, Customer editing, Screenshot processing.
 * Given a name / phone / conversation id it finds candidate MineFlow customers, ranks
 * them by the safe priority order, and marks the single high-confidence auto-match (or
 * flags that the user must choose). Each candidate carries whatever Facebook/Pancake
 * link it already has, so the caller can immediately show "Facebook linked".
 *
 * Reads are RLS-scoped. Nothing here writes or links — confirming/saving a link is the
 * caller's explicit action.
 */

/** Normalize a name for comparison: lower-case, punctuation → space, collapse spaces.
 *  Mirrors the SQL app_private.normalize_name used by Pancake auto-link. */
export function normalizeName(v: string | null | undefined): string {
  return (v ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Digits only, for loose phone comparison (ignores +, spaces, dashes). */
function digitsOf(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** A raw customer row the ranker works on (shape of the DB select). */
export type MatchCustomerRow = {
  id: string;
  display_name: string | null;
  contact_number: string | null;
  address: string | null;
  facebook_conversation_url: string | null;
  pancake_conversation_id: string | null;
};

const SELECT =
  'id, display_name, contact_number, address, facebook_conversation_url, pancake_conversation_id';

function toMatch(
  row: MatchCustomerRow,
  source: MatchSource,
  confidence: MatchConfidence,
): CustomerMatch {
  return {
    customerId: row.id,
    displayName: row.display_name ?? '—',
    contactNumber: row.contact_number ?? null,
    address: row.address ?? null,
    facebookConversationUrl: row.facebook_conversation_url ?? null,
    pancakeConversationId: row.pancake_conversation_id ?? null,
    hasConversation: Boolean(row.pancake_conversation_id),
    confidence,
    source,
  };
}

const SOURCE_RANK: Record<MatchSource, number> = {
  pancake_conversation: 0,
  phone: 1,
  exact_name: 2,
  similar_name: 3,
};

/**
 * Pure ranking (unit-tested without a DB): classify each candidate by the strongest
 * signal it matches, sort best-first, and decide the auto-match. Auto-match only when
 * there is exactly ONE high-confidence candidate and its exact-name is not shared by
 * another candidate (spec §2/§5: never auto-link a shared name).
 */
export function rankCustomerMatches(
  query: CustomerMatchQuery,
  rows: MatchCustomerRow[],
): CustomerMatchOutcome {
  const normName = normalizeName(query.name);
  const phone = digitsOf(query.phone);
  const convId = (query.conversationId ?? '').trim();

  const candidates: CustomerMatch[] = [];
  for (const row of rows) {
    const rowName = normalizeName(row.display_name);
    if (convId && row.pancake_conversation_id === convId) {
      candidates.push(toMatch(row, 'pancake_conversation', 'high'));
    } else if (phone.length >= 7 && digitsOf(row.contact_number).endsWith(phone.slice(-9))) {
      candidates.push(toMatch(row, 'phone', 'high'));
    } else if (normName && rowName === normName) {
      candidates.push(toMatch(row, 'exact_name', 'high'));
    } else if (
      normName &&
      (rowName.includes(normName) || normName.includes(rowName)) &&
      rowName.length > 0
    ) {
      // A partial/contained name — never auto-linked (spec §2). Medium if the first
      // word matches, otherwise low.
      const rowFirst = rowName.split(' ')[0] ?? '';
      const queryFirst = normName.split(' ')[0] ?? '';
      const firstWordShared = rowFirst === queryFirst && queryFirst.length > 1;
      candidates.push(toMatch(row, 'similar_name', firstWordShared ? 'medium' : 'low'));
    }
  }

  candidates.sort(
    (a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.displayName.localeCompare(b.displayName),
  );

  const high = candidates.filter((c) => c.confidence === 'high');
  const exactNameHigh = high.filter((c) => c.source === 'exact_name');
  // Exactly one strong candidate, and no exact-name collision → safe to auto-select.
  const autoMatch =
    high.length === 1 && !(high[0]?.source === 'exact_name' && exactNameHigh.length > 1)
      ? (high[0] ?? null)
      : null;

  const needsConfirmation = !autoMatch && candidates.length > 0;

  return { autoMatch, candidates, needsConfirmation };
}

/** Find candidate customers for a name / phone / conversation id (RLS-scoped). */
export async function findCustomerMatches(
  query: CustomerMatchQuery,
): Promise<CustomerMatchOutcome> {
  const supabase = await createClient();
  const name = (query.name ?? '').trim();
  const phone = digitsOf(query.phone);
  const convId = (query.conversationId ?? '').trim();

  const rows = new Map<string, MatchCustomerRow>();
  const add = (data: unknown) => {
    for (const r of (data as MatchCustomerRow[] | null) ?? []) rows.set(r.id, r);
  };

  // Strongest signals first (each a small, indexed lookup).
  if (convId) {
    const { data } = await supabase
      .from('customers')
      .select(SELECT)
      .eq('is_active', true)
      .eq('pancake_conversation_id', convId)
      .limit(5);
    add(data);
  }
  if (phone.length >= 7) {
    const { data } = await supabase
      .from('customers')
      .select(SELECT)
      .eq('is_active', true)
      .ilike('contact_number', `%${phone.slice(-9)}%`)
      .limit(10);
    add(data);
  }
  if (name) {
    const safe = name.replace(/[%,()]/g, ' ').trim();
    const firstToken = safe.split(/\s+/)[0] ?? safe;
    const { data } = await supabase
      .from('customers')
      .select(SELECT)
      .eq('is_active', true)
      .or(`display_name.ilike.%${safe}%,display_name.ilike.%${firstToken}%`)
      .limit(50);
    add(data);
  }

  return rankCustomerMatches(query, [...rows.values()]);
}
