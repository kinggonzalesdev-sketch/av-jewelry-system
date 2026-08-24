import { describe, expect, it, vi } from 'vitest';

// Isolate resolvePancakeSenderUserId: stub the module-load deps so importing the (server-only)
// pancake module doesn't pull in next/headers etc. Only the service-role read matters here.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: class AuthorizationError extends Error {},
  requirePrimarySuperAdmin: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePancakeSenderUserId } from '@/lib/integrations/pancake';

function mockAdmin(row: unknown) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }) }),
  } as unknown as ReturnType<typeof createAdminClient>);
}

/**
 * Owner 2026-08-24 — the AUTO TEXT send path runs server-side with NO primary-super-admin session
 * (durable router, mobile after(), cron), yet pancake_integration_config is RLS-gated to the primary
 * super admin. Resolving the sender with a session client returned null → 'sender_unset' → the AUTO
 * TEXT never sent automatically. It must resolve via the SERVICE-ROLE client so it works everywhere.
 */
describe('resolvePancakeSenderUserId — service-role read (no session required)', () => {
  it('returns the configured sender id via the admin (service-role) client', async () => {
    mockAdmin({ sender_user_id: 'U123' });
    expect(await resolvePancakeSenderUserId()).toBe('U123');
    expect(vi.mocked(createAdminClient)).toHaveBeenCalled();
  });

  it('fail-closed to null when no sender is configured', async () => {
    mockAdmin({ sender_user_id: null });
    expect(await resolvePancakeSenderUserId()).toBeNull();
  });

  it('fail-closed to null when the read throws (never sends without a sender)', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('service key unavailable');
    });
    expect(await resolvePancakeSenderUserId()).toBeNull();
  });
});
