import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Layaway financers (spec §14). A financer is NOT a supplier. This module reads
 * the configurable financer list and updates a layaway's financer + custody +
 * remarks, gated by `layaway_monitoring` and RLS.
 */

export type Financer = { id: string; name: string };

/**
 * Every DETECTED financer name for the New Entry dropdown — the configured
 * financers UNIONED with every distinct financer/remark actually seen on layaway
 * accounts (imported or created). The main Layaway workspace builds the same set
 * client-side for its filter; this is the server-side equivalent so a form that
 * does not load the whole account list still offers the full roster.
 *
 * Deduplicated case- and spacing-insensitively (so "nez", "NEZ", "Nez " are one),
 * keeping the first display spelling, and sorted. Returns plain names — the New
 * Entry field stores the chosen text as the account's Remarks / Financer.
 */
/**
 * Values that landed in the dual-purpose "Remarks / Financer" column but are
 * operational notes, NOT financer names — excluded from the detected list so the
 * dropdown offers only real financers. Matched case- and spacing-insensitively.
 * Configured financers are never filtered; this only prunes remark-derived noise.
 */
const FINANCER_STOP_LIST = new Set([
  'ok',
  'keep',
  'paid',
  'done',
  'completed',
  'cancelled',
  'canceled',
  'forfeited',
  'pending',
  'none',
  'n/a',
  'na',
  '-',
]);

export async function listDetectedFinancers(): Promise<string[]> {
  const supabase = await createClient();
  const [configured, ledger] = await Promise.all([
    supabase.from('financers').select('name').eq('is_active', true),
    // Imported/manual layaway accounts store the financer in Remarks / Financer.
    supabase.from('layaway_ledger').select('remarks').not('remarks', 'is', null),
  ]);

  const byKey = new Map<string, string>();
  // A configured financer is always kept; a remark-derived one is dropped when it
  // is a known operational note.
  const add = (raw: unknown, configuredName = false) => {
    const display = typeof raw === 'string' ? raw.trim() : '';
    if (!display) return;
    const key = display.toLowerCase().replace(/\s+/g, ' ');
    if (!configuredName && FINANCER_STOP_LIST.has(key)) return;
    if (!byKey.has(key)) byKey.set(key, display);
  };

  for (const r of (configured.data ?? []) as Array<{ name: string }>) add(r.name, true);
  for (const r of (ledger.data ?? []) as Array<{ remarks: string | null }>) add(r.remarks);

  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

/** Active financers, alphabetical. Read-only, RLS-scoped to active staff. */
export async function listFinancers(): Promise<Financer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('financers')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error || !data) return [];
  return (data as Array<{ id: string; name: string }>).map((r) => ({
    id: r.id,
    name: r.name,
  }));
}

export type FindOrCreateFinancerResult =
  | { ok: true; financer: Financer }
  | { ok: false; error: string };

/**
 * Find a financer by normalized name (case- and spacing-insensitive) or create it.
 * Manual entry that avoids duplicates: "GCash" / "gcash " / "G  Cash" resolve to
 * one record, and the first-seen display name is preserved. Gated (layaway
 * monitoring) in the database function.
 */
export async function findOrCreateFinancer(
  name: string,
): Promise<FindOrCreateFinancerResult> {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { ok: false, error: 'A financer name is required.' };
  if (trimmed.length > 120) return { ok: false, error: 'That financer name is too long.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc('find_or_create_financer', { p_name: trimmed })
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  const row = data as { id: string; name: string } | null;
  if (!row) return { ok: false, error: 'The financer could not be saved.' };

  await recordAuditEvent({
    action: 'financer.find_or_create',
    entityType: 'financer',
    entityId: row.id,
    context: { name: row.name },
  });
  return { ok: true, financer: { id: row.id, name: row.name } };
}

export type SetLayawayDetailsInput = {
  layawayArrangementId: string | null;
  financerId: string | null;
  currentHolder: string | null;
  currentLocation: string | null;
  remarks: string | null;
};

export type SetLayawayDetailsResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Set a layaway's financer, current holder, current location, and remarks.
 * Permission-gated (`layaway_monitoring`) with the database RLS as the real
 * boundary; the change is audited. Nothing financial is touched.
 */
export async function setLayawayDetails(
  input: SetLayawayDetailsInput,
): Promise<SetLayawayDetailsResult> {
  if (!input.layawayArrangementId) {
    return { ok: false, error: 'A layaway is required.' };
  }

  try {
    await requirePermission('layaway_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('layaway_arrangements')
    .update({
      financer_id: input.financerId,
      current_holder: input.currentHolder?.trim() || null,
      current_location: input.currentLocation?.trim() || null,
      remarks: input.remarks?.trim() || null,
    })
    .eq('id', input.layawayArrangementId);

  if (error) {
    return { ok: false, error: 'The layaway details could not be updated.' };
  }

  await recordAuditEvent({
    action: 'layaway.details_updated',
    entityType: 'layaway_arrangement',
    entityId: input.layawayArrangementId,
    context: {
      financer_id: input.financerId,
      current_holder: input.currentHolder,
      current_location: input.currentLocation,
    },
  });

  return { ok: true, message: 'Layaway details updated.' };
}
