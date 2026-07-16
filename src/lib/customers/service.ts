import 'server-only';

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
  contactNumber: string | null;
  isActive: boolean;
  sourceKind: string;
  createdAt: string;
};

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
    .select('id, display_name, contact_number, is_active, source_kind, created_at')
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
    return {
      id: row.id as string,
      displayName: (row.display_name as string | null) ?? 'Unknown',
      contactNumber: (row.contact_number as string | null) ?? null,
      isActive: (row.is_active as boolean | null) ?? true,
      sourceKind: (row.source_kind as string | null) ?? 'native',
      createdAt: row.created_at as string,
    };
  });

  return { ok: true, rows };
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
