import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class TestAuthorizationError extends Error {}

  return {
    AuthorizationError: TestAuthorizationError,
    requireOwner: vi.fn(),
    audit: vi.fn(),
    rpc: vi.fn(),
    createClient: vi.fn(),
  };
});

vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: mocks.AuthorizationError,
  requireActiveStaff: vi.fn(),
  requireOwner: mocks.requireOwner,
  requireOwnerOrAdmin: vi.fn(),
  requirePermission: vi.fn(),
}));

vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/import/layaway-csv', () => ({ layawayDedupKey: vi.fn() }));

import { forfeitLayawayLedger } from '@/lib/payments/layaway-ledger';

describe('forfeitLayawayLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOwner.mockResolvedValue({ roleKey: 'owner' });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it('uses the atomic RPC and maps a successful forfeiture response', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'forfeited',
        changed: true,
        released_items: 2,
        layaway_code: 'A15',
      },
      error: null,
    });

    await expect(forfeitLayawayLedger('ledger-1')).resolves.toEqual({
      ok: true,
      changed: true,
      releasedItems: 2,
      layawayCode: 'A15',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('forfeit_layaway_ledger', {
      p_ledger_id: 'ledger-1',
    });
    // The success audit belongs to the same database transaction as the mutation.
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('accepts the idempotent already-forfeited response', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'forfeited',
        changed: false,
        released_items: 0,
        layaway_code: 'A15',
      },
      error: null,
    });

    await expect(forfeitLayawayLedger('ledger-1')).resolves.toMatchObject({
      ok: true,
      changed: false,
      releasedItems: 0,
    });
  });

  it.each([
    ['missing data', null],
    [
      'a coerced released-item count',
      {
        status: 'forfeited',
        changed: true,
        released_items: '2',
        layaway_code: 'A15',
      },
    ],
  ])('fails closed on %s and records the failed attempt', async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    const result = await forfeitLayawayLedger('ledger-1');

    expect(result).toEqual({
      ok: false,
      error:
        'The forfeiture response was incomplete. Refresh and verify the account before retrying.',
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'layaway.forfeit',
        entityId: 'ledger-1',
        outcome: 'failed',
      }),
    );
  });

  it('does not call the database when the Owner gate refuses the action', async () => {
    mocks.requireOwner.mockRejectedValue(
      new mocks.AuthorizationError('Owner authorization required.'),
    );

    await expect(forfeitLayawayLedger('ledger-1')).resolves.toEqual({
      ok: false,
      error: 'Owner authorization required.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied' }),
    );
  });
});
