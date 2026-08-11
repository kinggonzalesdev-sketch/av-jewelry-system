import { describe, expect, it } from 'vitest';

import {
  normalizeName,
  rankCustomerMatches,
  type MatchCustomerRow,
} from '@/lib/customers/matching';

function row(over: Partial<MatchCustomerRow> = {}): MatchCustomerRow {
  return {
    id: 'c1',
    display_name: 'Maria Dela Cruz',
    contact_number: null,
    address: null,
    facebook_conversation_url: null,
    pancake_conversation_id: null,
    ...over,
  };
}

describe('normalizeName', () => {
  it('lower-cases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeName('  Maria   DELA-Cruz, Jr. ')).toBe('maria dela cruz jr');
    expect(normalizeName('José')).toBe('josé');
    expect(normalizeName(null)).toBe('');
  });
});

describe('rankCustomerMatches — safe priority (spec §2)', () => {
  it('auto-matches a single exact normalized name (high confidence)', () => {
    const out = rankCustomerMatches({ name: 'maria dela-cruz' }, [row()]);
    expect(out.autoMatch?.customerId).toBe('c1');
    expect(out.autoMatch?.source).toBe('exact_name');
    expect(out.needsConfirmation).toBe(false);
  });

  it('never auto-matches when two customers share the exact name — asks to confirm', () => {
    const out = rankCustomerMatches({ name: 'Maria Dela Cruz' }, [
      row({ id: 'a' }),
      row({ id: 'b' }),
    ]);
    expect(out.autoMatch).toBeNull();
    expect(out.needsConfirmation).toBe(true);
    expect(out.candidates).toHaveLength(2);
  });

  it('prefers an existing Pancake conversation id over a name match', () => {
    const out = rankCustomerMatches(
      { name: 'Someone Else', conversationId: 'PAGE_123' },
      [
        row({
          id: 'conv',
          display_name: 'Different Name',
          pancake_conversation_id: 'PAGE_123',
        }),
      ],
    );
    expect(out.autoMatch?.source).toBe('pancake_conversation');
    expect(out.autoMatch?.hasConversation).toBe(true);
  });

  it('treats a partial name as similar (never auto-linked)', () => {
    const out = rankCustomerMatches({ name: 'Maria' }, [
      row({ id: 'c1', display_name: 'Maria Dela Cruz' }),
    ]);
    expect(out.autoMatch).toBeNull();
    expect(out.candidates[0]?.source).toBe('similar_name');
    expect(out.needsConfirmation).toBe(true);
  });

  it('surfaces the linked Facebook state on each candidate', () => {
    const out = rankCustomerMatches({ name: 'Maria Dela Cruz' }, [
      row({
        facebook_conversation_url: 'https://m.me/x',
        pancake_conversation_id: 'P_1',
      }),
    ]);
    expect(out.autoMatch?.hasConversation).toBe(true);
    expect(out.autoMatch?.facebookConversationUrl).toBe('https://m.me/x');
  });
});
