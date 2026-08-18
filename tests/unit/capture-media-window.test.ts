import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isConversationMediaEligible,
  psidFromConversationId,
} from '@/lib/capture/media-window';

describe('psidFromConversationId', () => {
  it('extracts the PSID after the first underscore of {page_id}_{psid}', () => {
    expect(psidFromConversationId('588622885161430_27782810028035237')).toBe(
      '27782810028035237',
    );
  });
  it('returns null for a shape with no underscore or an empty psid', () => {
    expect(psidFromConversationId('nounderscore')).toBeNull();
    expect(psidFromConversationId('588622885161430_')).toBeNull();
    expect(psidFromConversationId('')).toBeNull();
    expect(psidFromConversationId(null)).toBeNull();
  });
});

/** Minimal chainable Supabase mock whose terminal `.limit()` resolves to `{ data }`. */
function supabaseReturning(events: Array<Record<string, unknown>>): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    gt: () => builder,
    order: () => builder,
    limit: () => Promise.resolve({ data: events, error: null }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const PSID = '27782810028035237';
const CONV = `588622885161430_${PSID}`;
const inboxFromCustomer = { raw: { data: { message: { from: { id: PSID } } } } };
const inboxFromPage = { raw: { data: { message: { from: { id: '588622885161430' } } } } };

describe('isConversationMediaEligible', () => {
  it('true when a customer-initiated inbox event exists (from.id === psid)', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([inboxFromCustomer]), CONV);
    expect(ok).toBe(true);
  });

  it('false when there are no inbox events for the PSID', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([]), CONV);
    expect(ok).toBe(false);
  });

  it('false when the only inbox event is a Page echo (from.id !== psid)', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([inboxFromPage]), CONV);
    expect(ok).toBe(false);
  });

  it('false (fail-safe) when the conversation id has no extractable PSID', async () => {
    const ok = await isConversationMediaEligible(supabaseReturning([inboxFromCustomer]), 'bad-id');
    expect(ok).toBe(false);
  });
});
