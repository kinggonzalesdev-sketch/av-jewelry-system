'use server';

import { revalidatePath } from 'next/cache';

import {
  deleteScrapSale,
  recordScrapSale,
  recordScrapSales,
  updateScrapSale,
  type ScrapDeleteResult,
  type ScrapEditInput,
  type ScrapItemInput,
  type RecordScrapResult,
} from '@/lib/scrap/service';
import type { ScrapActionState } from '@/lib/scrap/action-state';

/** Scrap server action (Bible §G). Transport only — validation, self-attribution,
 *  and audit live in the domain module and the database. */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function recordScrapAction(
  _prev: ScrapActionState,
  formData: FormData,
): Promise<ScrapActionState> {
  const result = await recordScrapSale({
    material: text(formData, 'material'),
    grams: text(formData, 'grams'),
    amount: text(formData, 'amount'),
    buyer: text(formData, 'buyer'),
    contact: text(formData, 'contact'),
    soldOn: text(formData, 'soldOn'),
    note: text(formData, 'note'),
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/scrap');
  return { error: null, success: 'Scrap sale recorded.' };
}

/** Record a MULTI-ITEM scrap entry (Customer Name + one or more pieces). Called with a
 *  structured payload from the client form, not FormData. */
export async function recordScrapSalesAction(input: {
  buyer: string | null;
  contact: string | null;
  soldOn: string | null;
  note: string | null;
  items: ScrapItemInput[];
}): Promise<RecordScrapResult> {
  const result = await recordScrapSales(input);
  if (result.ok) revalidatePath('/admin/scrap');
  return result;
}

/** Edit ONE scrap sale (Owner / Selected Admin — re-checked in the DB). */
export async function updateScrapSaleAction(
  id: string,
  input: ScrapEditInput,
): Promise<RecordScrapResult> {
  const result = await updateScrapSale(id, input);
  if (result.ok) {
    revalidatePath('/admin/scrap');
    revalidatePath('/dashboard');
  }
  return result;
}

/** Permanently delete ONE scrap sale (Owner / Selected Admin). Revalidates so the
 *  totals and table refresh without a full-page reload. */
export async function deleteScrapSaleAction(
  id: string,
  confirm: string,
): Promise<ScrapDeleteResult> {
  if (confirm !== 'DELETE') {
    return { ok: false, error: 'Type DELETE to permanently delete this scrap sale.' };
  }
  const result = await deleteScrapSale(id);
  if (result.ok) {
    revalidatePath('/admin/scrap');
    revalidatePath('/dashboard');
  }
  return result;
}
