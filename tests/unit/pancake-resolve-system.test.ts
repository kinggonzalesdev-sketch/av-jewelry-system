import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

// Isolate resolveConversationForName: stub the module-load deps so importing the (server-only)
// pancake module doesn't pull in next/headers etc. The client is passed in explicitly per call.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requirePrimarySuperAdmin: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { resolveConversationForName } from '@/lib/integrations/pancake';

/**
 * Aug-28 error-spike fix. The durable/webhook auto-router resolves the name→conversation with a
 * SERVICE-ROLE (admin) client. Tier 1.5 calls webhook_resolve_conversation_by_name, a SECURITY DEFINER
 * RPC gated on app_private.is_active_staff() — which a service-role client (no auth.uid()) can only fail,
 * raising "Not authorized." (42501) on every Live-comment sweep. The `system` flag skips that guaranteed-
 * failing tier for the service path (tiers 1+2 already cover it) while EVERY authenticated caller keeps it.
 */
function makeSupabase(rpc: ReturnType<typeof vi.fn>): SupabaseClient {
  // Tier 1 (customers) returns nothing so the flow reaches tier 1.5; `.rpc` is the tier-1.5 seam.
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    ilike: () => builder,
    limit: () => Promise.resolve({ data: [] }),
  };
  return { from: () => builder, rpc } as unknown as SupabaseClient;
}

const TOKEN_ENV = ['PANCAKE_PAGE_ACCESS_TOKEN', 'PANCAKE_USER_ACCESS_TOKEN'] as const;

describe('resolveConversationForName — service-role `system` path skips the staff-gated webhook RPC', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.PANCAKE_PAGE_ID = process.env.PANCAKE_PAGE_ID;
    process.env.PANCAKE_PAGE_ID = 'PAGE'; // getActivePancakePageId short-circuits on the env (no config read).
    for (const k of TOKEN_ENV) {
      saved[k] = process.env[k];
      delete process.env[k]; // tier 2 (live API) returns empty without a token — no network in tests.
    }
  });

  afterEach(() => {
    if (saved.PANCAKE_PAGE_ID === undefined) delete process.env.PANCAKE_PAGE_ID;
    else process.env.PANCAKE_PAGE_ID = saved.PANCAKE_PAGE_ID;
    for (const k of TOKEN_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('system:true → NEVER calls webhook_resolve_conversation_by_name (the RPC that 42501s under service role)', async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: { conversationId: null, matchCount: 0 } }),
    );
    const res = await resolveConversationForName(makeSupabase(rpc), 'Some Customer', {
      system: true,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(res.conversationId).toBeNull();
  });

  it('default (authenticated) path → STILL uses the webhook fast-match RPC', async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: { conversationId: null, matchCount: 0 } }),
    );
    await resolveConversationForName(makeSupabase(rpc), 'Some Customer');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'webhook_resolve_conversation_by_name',
      expect.objectContaining({ p_name: 'Some Customer' }),
    );
  });

  it('default path resolves a unique on-page webhook match (fast tier preserved for real staff)', async () => {
    const rpc = vi.fn(() =>
      Promise.resolve({ data: { conversationId: 'PAGE_123', matchCount: 1 } }),
    );
    const res = await resolveConversationForName(makeSupabase(rpc), 'Some Customer');
    expect(res.conversationId).toBe('PAGE_123');
    expect(res.source).toBe('pancake_live');
  });
});
