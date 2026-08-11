import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import type { PrinterResult, PrinterRow, PrintQueueStatus } from '@/lib/printers/types';

/**
 * Printer registry + print-queue readers/mutations (live-readiness). Registering and
 * changing a printer is an Owner/Admin action; the SECURITY DEFINER functions re-check
 * that, so the UI gate is convenience only. The single-claim print flow itself
 * (claim_next_label_job / mark_*) is driven by the on-device print endpoints.
 */

export async function listPrinters(): Promise<PrinterRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('printers')
    .select(
      'id, name, target, transport, label_size, is_active, is_default, last_seen_at',
    )
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    name: (r.name as string | null) ?? '—',
    target: (r.target as string | null) ?? null,
    transport: (r.transport as string | null) ?? 'bluetooth',
    labelSize: (r.label_size as string | null) ?? null,
    isActive: r.is_active === true,
    isDefault: r.is_default === true,
    lastSeenAt: (r.last_seen_at as string | null) ?? null,
  }));
}

/** Counts for the queue snapshot: pending (unclaimed), claimed (in progress), failed. */
export async function getPrintQueueStatus(): Promise<PrintQueueStatus> {
  const supabase = await createClient();
  const [pending, claimed, failed] = await Promise.all([
    supabase
      .from('label_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_print')
      .is('claimed_at', null),
    supabase
      .from('label_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_print')
      .not('claimed_at', 'is', null),
    supabase
      .from('label_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed_print'),
  ]);
  return {
    pending: pending.count ?? 0,
    claimed: claimed.count ?? 0,
    failed: failed.count ?? 0,
  };
}

async function guardOwnerOrAdmin(): Promise<PrinterResult | null> {
  try {
    await requireOwnerOrAdmin();
    return null;
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
}

export async function registerPrinter(input: {
  name: string;
  target?: string | null;
  transport?: string | null;
  labelSize?: string | null;
}): Promise<PrinterResult> {
  const denied = await guardOwnerOrAdmin();
  if (denied) return denied;
  if (!input.name?.trim()) return { ok: false, error: 'A printer name is required.' };

  const supabase = await createClient();
  const { error } = (await supabase.rpc('register_printer', {
    p_name: input.name.trim(),
    p_target: input.target?.trim() ? input.target.trim() : null,
    p_transport: input.transport?.trim() ? input.transport.trim() : 'bluetooth',
    p_label_size: input.labelSize?.trim() ? input.labelSize.trim() : null,
  })) as { error: { message: string } | null };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'printer.register',
    entityType: 'printer',
    entityId: input.name.trim(),
  });
  return { ok: true };
}

export async function updatePrinter(
  id: string,
  changes: {
    name?: string | null;
    active?: boolean | null;
    makeDefault?: boolean | null;
  },
): Promise<PrinterResult> {
  if (!id) return { ok: false, error: 'A printer is required.' };
  const denied = await guardOwnerOrAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = (await supabase.rpc('update_printer', {
    p_id: id,
    p_name: changes.name?.trim() ? changes.name.trim() : null,
    p_active: changes.active ?? null,
    p_make_default: changes.makeDefault ?? null,
  })) as { error: { message: string } | null };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'printer.update',
    entityType: 'printer',
    entityId: id,
  });
  return { ok: true };
}

export async function deletePrinter(id: string): Promise<PrinterResult> {
  if (!id) return { ok: false, error: 'A printer is required.' };
  const denied = await guardOwnerOrAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = (await supabase.rpc('delete_printer', { p_id: id })) as {
    error: { message: string } | null;
  };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'printer.delete',
    entityType: 'printer',
    entityId: id,
  });
  return { ok: true };
}
