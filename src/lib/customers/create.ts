import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Create a customer from a typed name (New Order manual entry).
 *
 * This is a REAL record, not free text stashed on a claim: a claim references a
 * real customer_id, so a manually-named buyer becomes a real customer. Insert is
 * gated by `claim_capture` here and by the `customers_insert` RLS policy
 * underneath (claim_capture OR existing_record_entry) — the database is the
 * boundary. Attributed to the caller via created_by.
 */
export type CreateCustomerResult =
  { ok: true; customerId: string; displayName: string } | { ok: false; error: string };

export async function createCustomer(rawName: string): Promise<CreateCustomerResult> {
  const displayName = (rawName ?? '').trim();
  if (displayName.length === 0) {
    return { ok: false, error: 'Enter a customer name.' };
  }
  if (displayName.length > 160) {
    return { ok: false, error: 'Customer name must be 160 characters or fewer.' };
  }

  let staff;
  try {
    staff = await requirePermission('claim_capture');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'customer.create',
        entityType: 'customer',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .insert({
      display_name: displayName,
      source_kind: 'native',
      created_by: staff.staffProfileId,
    })
    .select('id')
    .single();

  if (error || !data) {
    await recordAuditEvent({
      action: 'customer.create',
      entityType: 'customer',
      outcome: 'failed',
      reason: error?.message ?? 'insert returned no row',
    });
    return { ok: false, error: 'The customer could not be created.' };
  }

  await recordAuditEvent({
    action: 'customer.create',
    entityType: 'customer',
    entityId: data.id as string,
    context: { display_name: displayName, source: 'new_order_manual' },
  });

  return { ok: true, customerId: data.id as string, displayName };
}
