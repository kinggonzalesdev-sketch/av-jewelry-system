'use server';

import { findCustomerMatches } from '@/lib/customers/matching';
import type {
  CustomerMatchOutcome,
  CustomerMatchQuery,
} from '@/lib/customers/matching-types';

/** Find candidate customers for a typed name / phone / conversation id. Read-only —
 *  the caller confirms and saves any link explicitly. Used by every match UI. */
export async function findCustomerMatchesAction(
  query: CustomerMatchQuery,
): Promise<CustomerMatchOutcome> {
  const name = (query.name ?? '').trim();
  const phone = (query.phone ?? '').trim();
  const conversationId = (query.conversationId ?? '').trim();
  if (!name && !phone && !conversationId) {
    return { autoMatch: null, candidates: [], needsConfirmation: false };
  }
  return findCustomerMatches({ name, phone, conversationId });
}
