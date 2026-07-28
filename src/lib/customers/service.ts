import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner, requireOwnerOrAdmin } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Customers directory (Bible §14). Roadmap Phase 8.
 *
 * READ-ONLY. Customers are read by any active staff (RLS `customers_read`); the
 * rows and every related claim/order are RLS-scoped to what the caller may
 * already see. This module lists and inspects — it never writes.
 *
 * Standalone customer create/edit is deliberately NOT implemented here. Customers
 * are born in claim capture / migration (RLS gates writes on `claim_capture`,
 * `claim_review`, `existing_record_entry`), and the Bible forbids automatic merge
 * (§22.16) — a free-form "New Customer" form with no duplicate-guard UX would
 * manufacture duplicates. Adding it needs an approved flow, not invention.
 *
 * Every reader returns an explicit failure rather than an empty array on a read
 * error: an unreadable list must never look like "no customers" (the session's
 * rule, matching orders/service.ts).
 */

export type CustomerListRow = {
  id: string;
  displayName: string;
  address: string | null;
  contactNumber: string | null;
  isActive: boolean;
  /** The customer's latest Official Order status (humanized), or "No orders". */
  stage: string;
  createdAt: string;
};

function humanizeStatus(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export type CustomersResult =
  { ok: true; rows: CustomerListRow[] } | { ok: false; reason: string };

/** Strip characters that would break a PostgREST `or(...)` filter string. */
function sanitizeSearch(query: string): string {
  return query.replace(/[,()%*\\]/g, ' ').trim();
}

/**
 * Lists customers, alphabetical. Optional case-insensitive search over the
 * display name and contact number.
 */
export async function listCustomers(query = '', limit = 100): Promise<CustomersResult> {
  const supabase = await createClient();

  let builder = supabase
    .from('customers')
    // official_orders embed drives the STAGE column (latest order status). RLS
    // scopes the embedded orders to what the caller may already see.
    .select(
      'id, display_name, address, contact_number, is_active, created_at, official_orders ( status, created_at )',
    )
    .order('display_name', { ascending: true })
    .limit(limit);

  const term = sanitizeSearch(query);
  if (term.length >= 2) {
    builder = builder.or(`display_name.ilike.%${term}%,contact_number.ilike.%${term}%`);
  }

  const { data, error } = await builder;
  if (error) {
    return { ok: false, reason: error.message };
  }

  const rows: CustomerListRow[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const orders =
      (row.official_orders as Array<{ status: string; created_at: string }> | null) ?? [];
    const latest = orders
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
    return {
      id: row.id as string,
      displayName: (row.display_name as string | null) ?? 'Unknown',
      address: (row.address as string | null) ?? null,
      contactNumber: (row.contact_number as string | null) ?? null,
      isActive: (row.is_active as boolean | null) ?? true,
      stage: latest ? humanizeStatus(latest.status) : 'No orders',
      createdAt: row.created_at as string,
    };
  });

  return { ok: true, rows };
}

/**
 * Deactivate (soft-delete) a customer — Owner-only. A customer with any order,
 * claim, invoice, or message CANNOT be hard-deleted (every FK is ON DELETE
 * RESTRICT); deactivating preserves all history and is reversible (set is_active
 * back to true). RLS still governs the write underneath.
 */
export async function deactivateCustomer(
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .update({ is_active: false })
    .eq('id', customerId)
    .select('id');

  if (error) return { ok: false, error: 'The customer could not be deactivated.' };
  if (!data || data.length === 0) {
    return { ok: false, error: 'That customer could not be found.' };
  }

  await recordAuditEvent({
    action: 'customer.deactivate',
    entityType: 'customer',
    entityId: customerId,
  });
  return { ok: true };
}

/**
 * Permanently delete a customer — Owner or Selected Admin only. The database
 * function is the real gate: it re-checks the role and BLOCKS the delete when the
 * customer is linked to any transaction record (orders, claims, invoice drafts,
 * messages, waitlist, or a duplicate reference). Only a truly isolated customer
 * (at most incidental aliases) is removed, and the audit row — which has no FK to
 * the customer — survives the deletion. This is irreversible, unlike deactivation.
 */
export async function permanentlyDeleteCustomer(
  customerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireOwnerOrAdmin();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'customer.permanent_delete',
        entityType: 'customer',
        entityId: customerId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('permanently_delete_customer', {
    p_customer_id: customerId,
  });

  if (error) {
    await recordAuditEvent({
      action: 'customer.permanent_delete',
      entityType: 'customer',
      entityId: customerId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  // The customer row is gone; the audit row (no FK to it) preserves the history.
  await recordAuditEvent({
    action: 'customer.permanent_delete',
    entityType: 'customer',
    entityId: customerId,
    context: { permanent: true },
  });
  return { ok: true };
}

export type UpdateCustomerInput = {
  id: string;
  displayName: string;
  contactNumber: string | null;
  address: string | null;
};

export type UpdateCustomerResult = { ok: true } | { ok: false; error: string };

/**
 * Edit a customer's core details (name, contact, address). Owner/Admin, or a staff
 * member with existing_record_entry — enforced in the DEFINER function. Uses the
 * permanent id; linked orders/claims/payments/layaway/history are untouched (the
 * update only writes these three columns). Records who/when via the audit log.
 */
export async function updateCustomer(
  input: UpdateCustomerInput,
): Promise<UpdateCustomerResult> {
  const name = input.displayName.trim();
  if (!name) return { ok: false, error: 'A customer name is required.' };
  if (name.length > 200) return { ok: false, error: 'That name is too long.' };

  const contact = input.contactNumber?.trim() || '';
  // Validate the format only WHEN provided (optional field).
  if (contact && !/^[\d+][\d\s()-]{5,19}$/.test(contact)) {
    return {
      ok: false,
      error: 'Enter a valid contact number (digits, spaces, +, -, and () only).',
    };
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('update_customer_details', {
    p_id: input.id,
    p_display_name: name,
    p_contact_number: contact || null,
    p_address: input.address?.trim() || null,
  })) as { data: boolean | null; error: { message: string } | null };

  if (res.error) {
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  if (res.data !== true) {
    return { ok: false, error: 'That customer could not be found.' };
  }

  await recordAuditEvent({
    action: 'customer.update_details',
    entityType: 'customer',
    entityId: input.id,
    context: { name, has_contact: Boolean(contact), has_address: Boolean(input.address?.trim()) },
  });
  return { ok: true };
}

export type CustomerDetail = {
  id: string;
  displayName: string;
  contactNumber: string | null;
  notes: string | null;
  isActive: boolean;
  sourceKind: string;
  createdAt: string;
};

export type CustomerOrderRow = {
  id: string;
  orderNumber: string;
  invoiceNumber: string;
  status: string;
  createdAt: string;
};

export type CustomerClaimRow = {
  id: string;
  claimReference: string;
  status: string;
  quantity: number;
  createdAt: string;
};

export type CustomerDetailResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** null = no such customer (or not readable by this caller). */
      customer: CustomerDetail | null;
      orders: CustomerOrderRow[];
      claims: CustomerClaimRow[];
    };

/**
 * One customer with their related Official Orders and claims. Related rows are
 * RLS-scoped, so the caller sees only what they may already read.
 */
export async function getCustomerDetail(id: string): Promise<CustomerDetailResult> {
  const supabase = await createClient();

  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .select('id, display_name, contact_number, notes, is_active, source_kind, created_at')
    .eq('id', id)
    .maybeSingle();

  if (customerError) {
    return { ok: false, reason: customerError.message };
  }
  if (!customerRow) {
    return { ok: true, customer: null, orders: [], claims: [] };
  }

  const [ordersResponse, claimsResponse] = await Promise.all([
    supabase
      .from('official_orders')
      .select('id, order_number, invoice_number, status, created_at')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('claims')
      .select('id, claim_reference, status, quantity, created_at')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
  ]);

  if (ordersResponse.error) {
    return { ok: false, reason: ordersResponse.error.message };
  }
  if (claimsResponse.error) {
    return { ok: false, reason: claimsResponse.error.message };
  }

  const c = customerRow as Record<string, unknown>;
  const customer: CustomerDetail = {
    id: c.id as string,
    displayName: (c.display_name as string | null) ?? 'Unknown',
    contactNumber: (c.contact_number as string | null) ?? null,
    notes: (c.notes as string | null) ?? null,
    isActive: (c.is_active as boolean | null) ?? true,
    sourceKind: (c.source_kind as string | null) ?? 'native',
    createdAt: c.created_at as string,
  };

  const orders: CustomerOrderRow[] = (ordersResponse.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      orderNumber: (row.order_number as string | null) ?? '—',
      invoiceNumber: (row.invoice_number as string | null) ?? '—',
      status: (row.status as string | null) ?? 'unknown',
      createdAt: row.created_at as string,
    };
  });

  const claims: CustomerClaimRow[] = (claimsResponse.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      claimReference: (row.claim_reference as string | null) ?? '—',
      status: (row.status as string | null) ?? 'unknown',
      quantity: (row.quantity as number | null) ?? 0,
      createdAt: row.created_at as string,
    };
  });

  return { ok: true, customer, orders, claims };
}
