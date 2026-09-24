import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/*
 * The Messenger-window ("is the chat open?") check must never run under the operator's own
 * session: pancake_webhook_events is readable only by Owners under RLS, so an Admin's session saw
 * no messages and every open chat looked closed (2026-09-24: the PC sent a comment reply instead of
 * the screenshot). Both PC paths must use the service-role helpers in auto-router.ts.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('media-window checks on the PC use the server read', () => {
  it('pc-send uses isConversationMediaEligibleSystem, never the session client', () => {
    const src = read('src/lib/capture/pc-send.ts');
    expect(src).toContain('isConversationMediaEligibleSystem(conversationId)');
    expect(src).not.toMatch(/isConversationMediaEligible[(]supabase/);
  });
  it('the Incoming Captures list uses conversationsMediaEligibilitySystem', () => {
    const src = read('src/lib/capture/pending.ts');
    expect(src).toContain('conversationsMediaEligibilitySystem(');
    expect(src).not.toMatch(/conversationsMediaEligibility[(]supabase/);
  });
});
