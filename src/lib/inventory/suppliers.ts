import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Supplier-code master entity (Excel-first spec §7). A configurable mapping from the
 * supplier INITIAL the code parser extracts (e.g. the "A" in SBA-N-2683) to a real
 * supplier name. Managed in Settings by the Owner/Admin; read by any active staff.
 */
export type SupplierCode = { code: string; name: string; isActive: boolean };
export type SupplierCodeResult = { ok: true } | { ok: false; error: string };

export async function listSupplierCodes(): Promise<SupplierCode[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('supplier_codes')
    .select('code, name, is_active')
    .order('code', { ascending: true });
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    code: r.code as string,
    name: r.name as string,
    isActive: r.is_active === true,
  }));
}

/** Active supplier initial → name map, for resolving parsed inventory codes. */
export async function getSupplierCodeMap(): Promise<Record<string, string>> {
  const rows = await listSupplierCodes();
  const map: Record<string, string> = {};
  for (const r of rows) if (r.isActive) map[r.code] = r.name;
  return map;
}

export async function upsertSupplierCode(
  code: string,
  name: string,
): Promise<SupplierCodeResult> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('upsert_supplier_code', {
    p_code: code,
    p_name: name,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'supplier_code.upsert',
    entityType: 'supplier_code',
    entityId: code.toUpperCase(),
  });
  return { ok: true };
}

export async function deleteSupplierCode(code: string): Promise<SupplierCodeResult> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_supplier_code', { p_code: code });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'supplier_code.delete',
    entityType: 'supplier_code',
    entityId: code.toUpperCase(),
  });
  return { ok: true };
}
