import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import {
  AuthorizationError,
  requireActiveStaff,
  requireOwnerOrAdmin,
} from '@/lib/authz/guard';
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
  /** Customer name (stored in the buyer column). */
  buyer: string | null;
  /** Seller's contact number. Null when not entered. */
  contact: string | null;
  /** Mode of Payment used to pay the seller (canonical PAYMENT_METHODS). Null when
   *  not entered. */
  paymentMethod: string | null;
  /** Karat / purity, e.g. "18K" / "925". Null when not entered. */
  karat: string | null;
  /** Price per gram used to auto-compute the amount. Null when not entered. */
  perGram: string | null;
  soldOn: string;
  note: string | null;
  /** When the sale was entered (distinct from Sold On, the trade date). */
  encodedAt: string | null;
  /** Who entered it. Null when the recorder is no longer resolvable. */
  encodedBy: string | null;
};

export type ScrapIncomeRow = {
  material: 'gold' | 'silver';
  totalGrams: string;
  totalAmount: string;
  saleCount: number;
};

export type ScrapIncomeResult = { ok: true; rows: ScrapIncomeRow[] } | { ok: false };
export type RecordScrapResult = { ok: true } | { ok: false; error: string };

/** All-time scrap total for the dashboard. Amount is an authoritative numeric
 *  string from SQL (never a float); count is a plain integer. */
export type ScrapTotal = { totalAmount: string; saleCount: number };

export async function recordScrapSale(input: {
  material: string | null;
  grams: string | null;
  amount: string | null;
  buyer: string | null;
  contact: string | null;
  paymentMethod: string | null;
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
    contact_number: input.contact?.trim() || null,
    payment_method: input.paymentMethod?.trim() || null,
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

/** One scrap piece in a multi-item entry: amount is auto-computed (grams × per gram)
 *  on the client, but re-validated here. Karat and per-gram are optional. */
export type ScrapItemInput = {
  material: string | null;
  grams: string | null;
  amount: string | null;
  perGram: string | null;
  karat: string | null;
};

/**
 * Record a MULTI-ITEM scrap entry (the Orders "New Entry" flow, for scrap): one shared
 * Customer Name / Sold On / Note, and one or more pieces. Each piece becomes its own
 * scrap_sales row (so the per-material income totals stay correct), inserted in one
 * batch and self-attributed. Money strings are passed straight to numeric — validated,
 * never re-computed.
 */
export async function recordScrapSales(input: {
  buyer: string | null;
  contact: string | null;
  paymentMethod: string | null;
  soldOn: string | null;
  note: string | null;
  items: ScrapItemInput[];
}): Promise<RecordScrapResult> {
  const items = input.items ?? [];
  if (items.length === 0) return { ok: false, error: 'Add at least one item.' };

  const staff = await requireActiveStaff();
  const buyer = input.buyer?.trim() || null;
  const contact = input.contact?.trim() || null;
  const paymentMethod = input.paymentMethod?.trim() || null;
  const note = input.note?.trim() || null;
  const soldOn = input.soldOn || undefined;

  const rows: Record<string, unknown>[] = [];
  for (const it of items) {
    if (it.material !== 'gold' && it.material !== 'silver') {
      return { ok: false, error: 'Each item must be gold or silver.' };
    }
    const grams = Number(it.grams);
    if (!Number.isFinite(grams) || grams <= 0) {
      return { ok: false, error: 'Each item needs grams greater than zero.' };
    }
    const amount = Number(it.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, error: 'Each item needs a valid, non-negative amount.' };
    }
    const perGramNum = it.perGram === null || it.perGram === '' ? null : Number(it.perGram);
    if (perGramNum !== null && (!Number.isFinite(perGramNum) || perGramNum < 0)) {
      return { ok: false, error: 'Price per gram must be a valid, non-negative number.' };
    }
    rows.push({
      material: it.material,
      // Original strings to numeric — no float rounding of the stored value.
      grams: it.grams,
      amount: it.amount,
      per_gram: it.perGram && it.perGram !== '' ? it.perGram : null,
      karat: it.karat?.trim() || null,
      buyer,
      contact_number: contact,
      payment_method: paymentMethod,
      sold_on: soldOn,
      note,
      recorded_by: staff.staffProfileId,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from('scrap_sales').insert(rows);
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
    context: { items: rows.length },
  });
  return { ok: true };
}

export type ScrapEditInput = {
  material: string | null;
  grams: string | null;
  amount: string | null;
  buyer: string | null;
  contact: string | null;
  paymentMethod: string | null;
  karat: string | null;
  perGram: string | null;
  soldOn: string | null;
  note: string | null;
};

/** Edit ONE scrap sale (Owner / Selected Admin — re-checked in the DB). */
export async function updateScrapSale(
  id: string,
  input: ScrapEditInput,
): Promise<RecordScrapResult> {
  if (!id) return { ok: false, error: 'A scrap sale is required.' };
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

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('update_scrap_sale', {
    p_id: id,
    p_material: input.material,
    p_grams: input.grams,
    p_amount: input.amount,
    p_buyer: input.buyer?.trim() || null,
    p_contact: input.contact?.trim() || null,
    p_payment_method: input.paymentMethod?.trim() || null,
    p_karat: input.karat?.trim() || null,
    p_per_gram: input.perGram && input.perGram !== '' ? input.perGram : null,
    p_sold_on: input.soldOn || null,
    p_note: input.note?.trim() || null,
  });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'scrap_sale.edit',
    entityType: 'scrap_sale',
    entityId: id,
    context: { material: input.material, grams: input.grams, amount: input.amount },
  });
  return { ok: true };
}

export async function listScrapSales(
  limit = 100,
  range?: { from: string; to: string },
): Promise<ScrapSaleRow[]> {
  const supabase = await createClient();
  const base = supabase
    .from('scrap_sales')
    .select(
      'id, material, grams, amount, buyer, contact_number, payment_method, karat, per_gram, sold_on, note, created_at, recorded_by, staff_profiles!scrap_sales_recorded_by_fkey ( full_name )',
    )
    .order('sold_on', { ascending: false })
    .limit(limit);
  const query = range ? base.gte('sold_on', range.from).lte('sold_on', range.to) : base;
  const { data, error } = await query;

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => {
    // The recorder's name, for the View modal. PostgREST returns the embedded row
    // as an object or a one-element array depending on the relationship shape.
    const embedded = r.staff_profiles;
    const recorder = Array.isArray(embedded)
      ? (embedded[0] as { full_name?: string } | undefined)
      : (embedded as { full_name?: string } | null);

    // Cast the numeric column to a concrete type before stringifying (narrowing raw
    // `unknown` would trip no-base-to-string).
    const pg = r.per_gram as string | number | null | undefined;

    return {
      id: r.id as string,
      material: r.material as 'gold' | 'silver',
      grams: String(r.grams),
      amount: String(r.amount),
      buyer: (r.buyer as string | null) ?? null,
      contact: (r.contact_number as string | null) ?? null,
      paymentMethod: (r.payment_method as string | null) ?? null,
      karat: (r.karat as string | null) ?? null,
      perGram: pg === null || pg === undefined ? null : String(pg),
      soldOn: r.sold_on as string,
      note: (r.note as string | null) ?? null,
      encodedAt: (r.created_at as string | null) ?? null,
      encodedBy: recorder?.full_name ?? null,
    };
  });
}

/**
 * Scrap income total for a date range (amount summed in SQL) for the dashboard
 * chart. Returns a zero total on a read failure so the chart shows an honest ₱0
 * rather than crashing the page.
 */
export async function getScrapTotal(from: string, to: string): Promise<ScrapTotal> {
  const supabase = await createClient();
  const response = await supabase.rpc('dashboard_scrap_total', {
    p_from: from,
    p_to: to,
  });

  if (response.error || !response.data) return { totalAmount: '0', saleCount: 0 };

  const rows = (response.data as Array<Record<string, unknown>>).map((row) => ({
    totalAmount: String((row.total_amount as string | number | null) ?? '0'),
    saleCount: Number(row.sale_count ?? 0),
  }));

  return rows[0] ?? { totalAmount: '0', saleCount: 0 };
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

export type ScrapDeleteResult = { ok: true } | { ok: false; error: string };

/**
 * Permanently delete ONE scrap sale (Owner / Selected Admin). Removes exactly the
 * selected row — no totals are rewritten, because the income figures are summed
 * from the remaining rows on every read. The audit event survives the deletion.
 */
export async function deleteScrapSale(id: string): Promise<ScrapDeleteResult> {
  if (!id) return { ok: false, error: 'A scrap sale is required.' };

  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'scrap_sale.delete',
        entityType: 'scrap_sale',
        entityId: id,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_scrap_sale', { p_id: id });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'scrap_sale.delete',
    entityType: 'scrap_sale',
    entityId: id,
    context: { permanent: true },
  });
  return { ok: true };
}
