'use server';

import { revalidatePath } from 'next/cache';

import { deletePrinter, registerPrinter, updatePrinter } from '@/lib/printers/service';
import type { PrinterResult } from '@/lib/printers/types';

const revalidate = () => revalidatePath('/settings/live-operations');

export async function registerPrinterAction(input: {
  name: string;
  target?: string | null;
  transport?: string | null;
  labelSize?: string | null;
}): Promise<PrinterResult> {
  const res = await registerPrinter(input);
  if (res.ok) revalidate();
  return res;
}

export async function updatePrinterAction(
  id: string,
  changes: {
    name?: string | null;
    active?: boolean | null;
    makeDefault?: boolean | null;
  },
): Promise<PrinterResult> {
  const res = await updatePrinter(id, changes);
  if (res.ok) revalidate();
  return res;
}

export async function deletePrinterAction(id: string): Promise<PrinterResult> {
  const res = await deletePrinter(id);
  if (res.ok) revalidate();
  return res;
}
