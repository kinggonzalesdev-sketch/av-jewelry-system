import { describe, expect, it } from 'vitest';

import { conversationBelongsToPage } from '@/lib/integrations/pancake';

/**
 * Page-scoping guard (2026-08-09): a pages.fm conversation id is `{page_id}_{psid}`,
 * so a conversation only exists on ITS page. Sending to a conversation on another page
 * is rejected ("conversation_id not found", code 120). `conversationBelongsToPage`
 * gates every stored link on the ACTIVE send page so we never attempt an undeliverable
 * send. This is the fix for A.V. Jewelry's multi-page link clutter from earlier syncs.
 */
describe('conversationBelongsToPage', () => {
  const AV_JEWELRY = '588622885161430';

  it('accepts a conversation on the active page', () => {
    expect(conversationBelongsToPage(`${AV_JEWELRY}_10035481173163176`, AV_JEWELRY)).toBe(
      true,
    );
  });

  it('rejects a conversation on a DIFFERENT page (the code-120 case)', () => {
    // A link synced from another page — this is exactly what was failing in the live.
    expect(
      conversationBelongsToPage('2609158952867406_1017128484489433', AV_JEWELRY),
    ).toBe(false);
  });

  it('never treats a null/empty conversation id as usable', () => {
    expect(conversationBelongsToPage(null, AV_JEWELRY)).toBe(false);
    expect(conversationBelongsToPage('', AV_JEWELRY)).toBe(false);
    expect(conversationBelongsToPage('   ', AV_JEWELRY)).toBe(false);
  });

  it('does not require an exact page string — only the page prefix (with the underscore)', () => {
    // A page id that is a prefix of another must NOT match without the separator.
    expect(conversationBelongsToPage('5886228851614300_123', AV_JEWELRY)).toBe(false);
  });

  it('is permissive when the active page is unknown (preserves old behaviour)', () => {
    // No active page resolved (empty) → do not drop links; a present id stays usable.
    expect(conversationBelongsToPage('2609158952867406_1017128484489433', '')).toBe(true);
    expect(conversationBelongsToPage(null, '')).toBe(false);
  });
});
