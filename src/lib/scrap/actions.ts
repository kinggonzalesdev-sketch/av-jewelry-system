'use server';

import { revalidatePath } from 'next/cache';

import { recordScrapSale } from '@/lib/scrap/service';
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
    soldOn: text(formData, 'soldOn'),
    note: text(formData, 'note'),
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/scrap');
  return { error: null, success: 'Scrap sale recorded.' };
}
