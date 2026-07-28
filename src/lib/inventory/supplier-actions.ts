'use server';

import { revalidatePath } from 'next/cache';

import {
  deleteSupplierCode,
  upsertSupplierCode,
  type SupplierCodeResult,
} from '@/lib/inventory/suppliers';

/** Add or rename a supplier code (Owner/Admin). Revalidates Settings on success. */
export async function upsertSupplierCodeAction(
  code: string,
  name: string,
): Promise<SupplierCodeResult> {
  const result = await upsertSupplierCode(code, name);
  if (result.ok) revalidatePath('/settings');
  return result;
}

/** Delete a supplier code (Owner/Admin). Revalidates Settings on success. */
export async function deleteSupplierCodeAction(code: string): Promise<SupplierCodeResult> {
  const result = await deleteSupplierCode(code);
  if (result.ok) revalidatePath('/settings');
  return result;
}
