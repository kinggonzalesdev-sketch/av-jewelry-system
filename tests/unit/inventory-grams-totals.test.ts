import { beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate the reader: stub its two module-load deps so we don't pull in next/headers etc.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/authz/guard', () => ({ getCurrentStaffProfile: vi.fn() }));

import { getCurrentStaffProfile } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { getInventoryGramsTotals } from '@/lib/inventory/grams-totals';

function mockRole(roleKey: string) {
  vi.mocked(getCurrentStaffProfile).mockResolvedValue({
    roleKey,
  } as unknown as Awaited<ReturnType<typeof getCurrentStaffProfile>>);
}

function mockRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(createClient).mockResolvedValue({
    rpc,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  return rpc;
}

beforeEach(() => vi.clearAllMocks());

/**
 * Owner 2026-08-28 — the Total Grams cards are Super Admin (owner) + Admin (selected_admin)
 * only, and are database-backed. The reader must role-gate BEFORE touching the DB, parse the
 * numeric-as-string totals exactly, and fail to a neutral null (never a false 0.00 g).
 */
describe('getInventoryGramsTotals — role gating + parsing', () => {
  it('owner: returns the parsed numeric totals from the RPC', async () => {
    mockRole('owner');
    const rpc = mockRpc({
      data: [
        {
          active_grams: '13729.15',
          active_items: 1784,
          completed_grams: '128791.14',
          completed_items: 1791,
        },
      ],
      error: null,
    });
    expect(await getInventoryGramsTotals()).toEqual({
      activeGrams: 13729.15,
      completedGrams: 128791.14,
    });
    expect(rpc).toHaveBeenCalledWith('inventory_grams_totals');
  });

  it('selected_admin (Admin): also allowed', async () => {
    mockRole('selected_admin');
    mockRpc({ data: [{ active_grams: '0', completed_grams: '0' }], error: null });
    expect(await getInventoryGramsTotals()).toEqual({ activeGrams: 0, completedGrams: 0 });
  });

  it('staff: returns null and NEVER runs the aggregate (no DB work for staff)', async () => {
    mockRole('staff');
    const rpc = mockRpc({ data: [], error: null });
    expect(await getInventoryGramsTotals()).toBeNull();
    expect(vi.mocked(createClient)).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('RPC error → null (the card shows "—", never a false 0.00 g)', async () => {
    mockRole('owner');
    mockRpc({ data: null, error: { message: 'boom' } });
    expect(await getInventoryGramsTotals()).toBeNull();
  });

  it('empty result set → null', async () => {
    mockRole('owner');
    mockRpc({ data: [], error: null });
    expect(await getInventoryGramsTotals()).toBeNull();
  });

  it('accepts numeric strings AND plain numbers from PostgREST', async () => {
    mockRole('owner');
    mockRpc({ data: [{ active_grams: 42.5, completed_grams: '7.25' }], error: null });
    expect(await getInventoryGramsTotals()).toEqual({ activeGrams: 42.5, completedGrams: 7.25 });
  });
});
