import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Money-in-Transit (business problem #14; solution G).
 *
 * Reads the SQL aggregation (report_money_in_transit) — every figure is summed
 * in the database as numeric and arrives as an authoritative STRING, never a JS
 * float. A failed read returns `ok: false` so the screen shows an error, never a
 * false ₱0.
 */

export type MoneyInTransit = {
  /** Submitted payment evidence not yet verified. */
  awaitingVerification: string;
  /** Outstanding balance on orders still awaiting their required payment. */
  customerPending: string;
  /** Outstanding on COD orders dispatched but not completed — money a rider or
   *  courier is carrying to collect. */
  inTransitToCollect: string;
};

export type MoneyInTransitResult = { ok: true; data: MoneyInTransit } | { ok: false };

/** The SQL casts each sum to text, so a real value is a string; anything else
 *  degrades to "0" rather than stringifying an object. Never a JS float. */
function asMoney(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '0';
}

export async function getMoneyInTransit(): Promise<MoneyInTransitResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('report_money_in_transit');

  if (response.error || !response.data) return { ok: false };

  const d = response.data as Record<string, unknown>;
  return {
    ok: true,
    data: {
      awaitingVerification: asMoney(d.awaiting_verification),
      customerPending: asMoney(d.customer_pending),
      inTransitToCollect: asMoney(d.in_transit_to_collect),
    },
  };
}
