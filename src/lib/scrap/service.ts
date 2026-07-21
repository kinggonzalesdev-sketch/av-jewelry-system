import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Scrap income (Bible §G). A separate income stream for scrap gold/silver. Any
 * active staff may record a sale (attributed to themselves) and read the report;
 * income is summed in SQL and shown as an authoritative string (never a float).
 */

export type ScrapSaleRow = {
  id: string;
  material: 'gold' | 'silver';
  grams: string;
  amount: string;
  buyer: string | null;
  soldOn: string;
  note: string | null;
};

export type ScrapIncomeRow = {
  material: 'gold' | 'silver';
  totalGrams: string;
  totalAmount: string;
  saleCount: number;
};

export type ScrapIncomeResult = { ok: true; rows: ScrapIncomeRow[] } | { ok: false };
export type RecordScrapResult = { ok: true } | { ok: false; error: string };

export async function recordScrapSale(input: {
  material: string | null;
  grams: string | null;
  amount: string | null;
  buyer: string | null;
  soldOn: string | null;
  note: string | null;
}): Promise<RecordScrapResult> {
  if (input.material !== 'gold' && input.material !== 'silver') {
    return { ok: false, error: 'Material must be gold or silver.' };
  }
  const grams = Number(input.grams);
  if (!Number.isFinite(grams) || grams <= 0) {
    return { ok: false, error: 'Grams must be greater than zero.' };
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: 'Amount must be a valid, non-negative number.' };
  }

  const staff = await requireActiveStaff();
  const supabase = await createClient();

  const { error } = await supabase.from('scrap_sales').insert({
    material: input.material,
    // Pass the ORIGINAL strings to Postgres numeric — the Number() checks above
    // are validation only, never the stored value (no float rounding).
    grams: input.grams,
    amount: input.amount,
    buyer: input.buyer?.trim() || null,
    sold_on: input.soldOn || undefined,
    note: input.note?.trim() || null,
    recorded_by: staff.staffProfileId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'scrap.record',
      entityType: 'scrap_sale',
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: 'The scrap sale could not be recorded.' };
  }

  await recordAuditEvent({
    action: 'scrap.record',
    entityType: 'scrap_sale',
    context: { material: input.material, grams: input.grams, amount: input.amount },
  });
  return { ok: true };
}

export async function listScrapSales(limit = 100): Promise<ScrapSaleRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('scrap_sales')
    .select('id, material, grams, amount, buyer, sold_on, note')
    .order('sold_on', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    material: r.material as 'gold' | 'silver',
    grams: String(r.grams as string | number),
    amount: String(r.amount as string | number),
    buyer: (r.buyer as string | null) ?? null,
    soldOn: r.sold_on as string,
    note: (r.note as string | null) ?? null,
  }));
}

export async function getScrapIncome(
  from: string,
  to: string,
): Promise<ScrapIncomeResult> {
  const supabase = await createClient();
  const response = await supabase.rpc('report_scrap_income', { p_from: from, p_to: to });

  if (response.error || !response.data) return { ok: false };

  const rows = (response.data as Array<Record<string, unknown>>).map((r) => ({
    material: r.material as 'gold' | 'silver',
    totalGrams: String(r.total_grams as string | number),
    totalAmount: String(r.total_amount as string | number),
    saleCount: Number(r.sale_count ?? 0),
  }));

  return { ok: true, rows };
}
