import 'server-only';

import { getCurrentStaffProfile } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Inventory Total Grams summary cards (Owner 2026-08-28).
 *
 * Two GLOBAL, database-backed totals shown at the top of the Inventory page:
 * "Active Inventory Total Grams" and "Completed Items Total Grams". The numbers come
 * from ONE SQL aggregate (`inventory_grams_totals`) over ALL rows — never a browser
 * row-sum, never tied to the current search / filter / page — so they stay correct and
 * cheap at 50k items.
 *
 * The grams themselves are parsed from `item_code` inside the RPC (the same regex the
 * Inventory table uses) because `grams_per_piece` is empty for essentially every item;
 * see the migration for the full rationale.
 */

export type InventoryGramsTotals = {
  /** SUM of grams across Active Inventory (canonical Active set). */
  activeGrams: number;
  /** SUM of grams across Completed Items (canonical Completed set). */
  completedGrams: number;
};

/**
 * Reads both totals. Scoped to Super Admin (owner) + Admin (selected_admin) — the Owner
 * limited these cards to managers, so a Staff session gets `null` and never sees them.
 * Returns `null` on a role miss OR a read error (the caller shows a neutral "—", never a
 * false "0.00 g"). The RPC additionally enforces an active-staff gate in the database.
 */
export async function getInventoryGramsTotals(): Promise<InventoryGramsTotals | null> {
  const profile = await getCurrentStaffProfile();
  if (profile.roleKey !== 'owner' && profile.roleKey !== 'selected_admin') return null;

  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('inventory_grams_totals')) as {
    data:
      | Array<{ active_grams: string | number | null; completed_grams: string | number | null }>
      | null;
    error: { message: string } | null;
  };
  if (error || !data || data.length === 0) return null;

  const row = data[0];
  // PostgREST serializes numeric as a string to preserve precision; the totals are already
  // rounded to 2 dp in SQL, so Number() is exact well within the safe-integer range.
  return {
    activeGrams: Number(row?.active_grams ?? 0),
    completedGrams: Number(row?.completed_grams ?? 0),
  };
}
