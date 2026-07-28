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
