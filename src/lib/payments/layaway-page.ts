import 'server-only';

import { createClient } from '@/lib/supabase/server';
import {
  financerKey,
  fromDerived,
  fromLedger,
  type LayawayAccountRow,
} from '@/lib/payments/layaway-account-row';
import { ledgerRowsByIds } from '@/lib/payments/layaway-ledger';
import { arrangementRowsByIds } from '@/lib/payments/workspace';

/**
 * Server-side Layaway Accounts page (Owner request 2026-08-18, P1-B). The Layaway table used
 * to load EVERY imported ledger row into the browser and classify / search / filter / sum /
 * paginate client-side — it would not scale to 50k. This mirrors the proven orders_page /
 * inventory pattern: the `layaway_page` SQL RPC does the section + search + financer filter,
 * the exact filtered total, the full-dataset section counts, and the financial summary in the
 * DB and returns only the CURRENT PAGE's ids (each tagged 'l' ledger / 'a' arrangement). Here
 * we fetch just those ids with the SAME ledger / arrangement readers the old lists used, so a
 * row's shape and money are byte-for-byte what the browser produced before.
 */

export type LayawaySection = 'active' | 'overdue' | 'forfeited' | 'completed' | 'all';

export type LayawaySectionCounts = {
  all: number;
  active: number;
  overdue: number;
  forfeited: number;
  completed: number;
};

/** The financial summary for the CURRENT section + search + financer filter. Peso STRINGS. */
export type LayawaySummary = {
  qty: number;
  interest: string;
  grandTotal: string;
  payment: string;
  balance: string;
};

export type LayawayFinancerOption = { key: string; label: string };

export type LayawayPageResult =
  | {
      ok: true;
      rows: LayawayAccountRow[];
      total: number;
      sectionCounts: LayawaySectionCounts;
      summary: LayawaySummary;
      financerOptions: LayawayFinancerOption[];
    }
  | { ok: false; reason: string };

export type LayawayPageOpts = {
  search?: string;
  section?: LayawaySection;
  /** '' / '__all__' = all; '__none__' = no financer; else a financerKey() value. */
  financer?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  size?: number;
};

type PageId = { s: 'l' | 'a'; id: string };

const EMPTY_COUNTS: LayawaySectionCounts = {
  all: 0,
  active: 0,
  overdue: 0,
  forfeited: 0,
  completed: 0,
};
const EMPTY_SUMMARY: LayawaySummary = {
  qty: 0,
  interest: '0.00',
  grandTotal: '0.00',
  payment: '0.00',
  balance: '0.00',
};

export async function listLayawayPage(opts: LayawayPageOpts = {}): Promise<LayawayPageResult> {
  const page = Math.max(1, opts.page ?? 1);
  const size = Math.min(100, Math.max(1, opts.size ?? 25));
  const supabase = await createClient();

  const resp = await supabase.rpc('layaway_page', {
    p_search: opts.search?.trim() ?? '',
    p_section: opts.section ?? 'all',
    p_financer: opts.financer ?? '',
    p_date_from: opts.dateFrom ?? '',
    p_date_to: opts.dateTo ?? '',
    p_limit: size,
    p_offset: (page - 1) * size,
  });

  if (resp.error || !resp.data) {
    return {
      ok: false,
      reason: resp.error?.message ?? 'The layaway page could not be read.',
    };
  }

  const payload = resp.data as {
    ids?: PageId[];
    total?: number;
    sectionCounts?: Partial<LayawaySectionCounts>;
    summary?: Partial<LayawaySummary>;
    financerOptions?: string[];
  };

  const ids = Array.isArray(payload.ids) ? payload.ids : [];
  const ledgerIds = ids.filter((x) => x.s === 'l').map((x) => x.id);
  const arrangementIds = ids.filter((x) => x.s === 'a').map((x) => x.id);

  // Fetch ONLY this page's rows with the SAME readers the full lists used (identical shape +
  // money). Ledger money is stored columns; arrangement money is order_balance() — the exact
  // functions listLayaways called — so the figures match the pre-pagination table.
  const [ledgerRows, arrangementRows] = await Promise.all([
    ledgerRowsByIds(ledgerIds),
    arrangementRowsByIds(arrangementIds),
  ]);

  const byLedger = new Map(ledgerRows.map((r) => [r.id, fromLedger(r)]));
  const byArrangement = new Map(arrangementRows.map((r) => [r.layawayId, fromDerived(r)]));

  // Restore the RPC's page order (created_at desc, id desc) across the two sources. A row that
  // the RPC returned but the by-id read dropped (deleted between calls) is skipped, never a gap.
  const rows: LayawayAccountRow[] = [];
  for (const x of ids) {
    const row = x.s === 'l' ? byLedger.get(x.id) : byArrangement.get(x.id);
    if (row) rows.push(row);
  }

  // Financer dropdown options — dedup the dataset-wide distinct financer/remarks values by the
  // SAME key the RPC filters on, keeping the first display spelling.
  const optionByKey = new Map<string, string>();
  for (const label of payload.financerOptions ?? []) {
    const display = (label ?? '').trim();
    if (!display) continue;
    const key = financerKey(display);
    if (!optionByKey.has(key)) optionByKey.set(key, display);
  }
  const financerOptions = [...optionByKey.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const summary: LayawaySummary = {
    qty: payload.summary?.qty ?? rows.length,
    interest: payload.summary?.interest ?? '0.00',
    grandTotal: payload.summary?.grandTotal ?? '0.00',
    payment: payload.summary?.payment ?? '0.00',
    balance: payload.summary?.balance ?? '0.00',
  };

  return {
    ok: true,
    rows,
    total: payload.total ?? rows.length,
    sectionCounts: { ...EMPTY_COUNTS, ...(payload.sectionCounts ?? {}) },
    summary: { ...EMPTY_SUMMARY, ...summary },
    financerOptions,
  };
}
