'use server';

import { revalidatePath } from 'next/cache';

import type { CustomerActionState } from '@/lib/customers/action-state';
import {
  deactivateCustomer,
  permanentlyDeleteCustomer,
  updateCustomer,
  type UpdateCustomerResult,
} from '@/lib/customers/service';

/**
 * Customer actions (transport only). Authority (Owner-only) and the soft-delete
 * rule live in the domain module and the database. Deleting a customer with any
 * history is impossible (RESTRICT foreign keys); this deactivates instead.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Edit a customer's details (name, contact, address). Owner/Admin or a staff
 *  member with existing_record_entry — enforced in the domain module + DB. */
export async function updateCustomerAction(
  id: string,
  displayName: string,
  contactNumber: string | null,
  address: string | null,
): Promise<UpdateCustomerResult> {
  if (!id) return { ok: false, error: 'A customer is required.' };
  const result = await updateCustomer({ id, displayName, contactNumber, address });
  if (result.ok) revalidatePath('/customers');
  return result;
}

export async function deactivateCustomerAction(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const customerId = text(formData, 'customerId');
  const confirm = text(formData, 'confirm');
  if (!customerId) return { error: 'Missing customer.', success: null };
  // Explicit typed confirmation, exactly as requested.
  if (confirm !== 'YES') {
    return { error: 'Type YES to confirm deletion.', success: null };
  }

  const result = await deactivateCustomer(customerId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/customers');
  return { error: null, success: 'Customer deactivated. History is preserved.' };
}

/**
 * Permanently delete a customer (Owner/Admin). Requires typing DELETE, and the
 * database blocks the delete when any linked transaction record exists. This is
 * irreversible — unlike deactivate above.
 */
export async function permanentlyDeleteCustomerAction(
  _prev: CustomerActionState,
  formData: FormData,
): Promise<CustomerActionState> {
  const customerId = text(formData, 'customerId');
  const confirm = text(formData, 'confirm');
  if (!customerId) return { error: 'Missing customer.', success: null };
  if (confirm !== 'DELETE') {
    return { error: 'Type DELETE to permanently delete this customer.', success: null };
  }

  const result = await permanentlyDeleteCustomer(customerId);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/customers');
  return { error: null, success: 'Customer permanently deleted.' };
}
