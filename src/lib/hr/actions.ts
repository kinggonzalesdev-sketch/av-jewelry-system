'use server';

import { revalidatePath } from 'next/cache';

import { clockIn, clockOut } from '@/lib/hr/attendance';
import type { HrActionState } from '@/lib/hr/action-state';

/**
 * HR attendance server actions (Bible §F). Transport only — authority (active
 * staff, self-only writes) and the one-open-session rule live in the domain
 * module and the database.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function clockInAction(
  _prev: HrActionState,
  formData: FormData,
): Promise<HrActionState> {
  const result = await clockIn(text(formData, 'note'));
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  return { error: null, success: result.message };
}

export async function clockOutAction(
  _prev: HrActionState,
  _formData: FormData,
): Promise<HrActionState> {
  const result = await clockOut();
  if (!result.ok) return { error: result.error, success: null };
  revalidatePath('/admin/attendance');
  return { error: null, success: result.message };
}
