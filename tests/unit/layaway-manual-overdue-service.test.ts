import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class TestAuthorizationError extends Error {}

  return {
    AuthorizationError: TestAuthorizationError,
    requirePermission: vi.fn(),
    audit: vi.fn(),
    rpc: vi.fn(),
    createClient: vi.fn(),
  };
});

vi.mock('@/lib/authz/guard', () => ({
  AuthorizationError: mocks.AuthorizationError,
  requireActiveStaff: vi.fn(),
  requireOwner: vi.fn(),
  requireOwnerOrAdmin: vi.fn(),
  requirePermission: mocks.requirePermission,
}));
vi.mock('@/lib/audit/log', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/import/layaway-csv', () => ({ layawayDedupKey: vi.fn() }));

import { updateLayawayLedgerAndTransferOverdue } from '@/lib/payments/layaway-ledger';

const input = {
  id: 'ledger-1',
  customerName: ' ERICKA DE DIOS ',
  remarks: 'OK',
  datePurchased: '2026-06-01',
  itemAmount: '7000.00',
  interest: '450.00',
  nextDueDate: '2026-09-01',
  notes: 'Original note',
};

describe('updateLayawayLedgerAndTransferOverdue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue({ roleKey: 'selected_admin' });
    mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  });

  it('requires both existing edit and Transfer-to-Destination permissions', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'overdue',
        changed: true,
        released_items: 2,
        item_unique_codes: ['ITEM-1', 'ITEM-2'],
        grand_total: '7450.00',
        balance: '4450.00',
        layaway_code: 'E34',
        layaway_code_released: true,
      },
      error: null,
    });

    await expect(updateLayawayLedgerAndTransferOverdue(input)).resolves.toEqual({
      ok: true,
      changed: true,
      releasedItems: 2,
      itemUniqueCodes: ['ITEM-1', 'ITEM-2'],
      grandTotal: '7450.00',
      balance: '4450.00',
      layawayCode: 'E34',
      layawayCodeReleased: true,
      status: 'overdue',
    });
    expect(mocks.requirePermission.mock.calls).toEqual([
      ['layaway_edit'],
      ['fulfillment_preparation'],
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('update_layaway_ledger_and_transfer_overdue', {
      p_id: 'ledger-1',
      p_customer_name: 'ERICKA DE DIOS',
      p_remarks: 'OK',
      p_date_purchased: '2026-06-01',
      p_item_amount: '7000.00',
      p_interest: '450.00',
      p_next_due_date: '2026-09-01',
      p_notes: 'Original note',
    });
    // The success audit is part of the database transaction.
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('accepts an idempotent retry response without reporting another release', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'overdue',
        changed: false,
        released_items: 0,
        item_unique_codes: [],
        grand_total: 7450,
        balance: 4450,
        layaway_code: 'E34',
        layaway_code_released: false,
      },
      error: null,
    });

    await expect(updateLayawayLedgerAndTransferOverdue(input)).resolves.toMatchObject({
      ok: true,
      changed: false,
      releasedItems: 0,
      status: 'overdue',
    });
  });

  it('does not call the RPC when either permission is refused', async () => {
    mocks.requirePermission
      .mockResolvedValueOnce({ roleKey: 'selected_admin' })
      .mockRejectedValueOnce(
        new mocks.AuthorizationError('fulfillment_preparation permission required.'),
      );

    await expect(updateLayawayLedgerAndTransferOverdue(input)).resolves.toEqual({
      ok: false,
      error: 'fulfillment_preparation permission required.',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'layaway.transfer_to_overdue',
        outcome: 'denied',
      }),
    );
  });

  it('fails closed on an incomplete response and records the failed attempt', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        status: 'overdue',
        changed: true,
        released_items: '2',
        item_unique_codes: ['ITEM-1', 'ITEM-2'],
        grand_total: '7450.00',
        balance: '4450.00',
        layaway_code: 'E34',
        layaway_code_released: true,
      },
      error: null,
    });

    const result = await updateLayawayLedgerAndTransferOverdue(input);

    expect(result).toEqual({
      ok: false,
      error:
        'The Overdue transfer response was incomplete. Refresh and verify the account before retrying.',
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failed' }),
    );
  });
});
