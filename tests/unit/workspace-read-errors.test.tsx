import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Server actions are mocked — these render tests only exercise the read-error
// branch of each workspace, never a submission.
vi.mock('@/lib/inventory/actions', () => ({
  decideRtsAction: vi.fn(),
  openMigrationBatchAction: vi.fn(),
  returnToAvailableAction: vi.fn(),
  reviewDuplicateAction: vi.fn(),
}));
vi.mock('@/lib/fulfillment/actions', () => ({
  releaseFulfillmentAction: vi.fn(),
  dispatchAction: vi.fn(),
  completeFulfillmentAction: vi.fn(),
  requestApprovalAction: vi.fn(),
  decideApprovalAction: vi.fn(),
  executeApprovalAction: vi.fn(),
  prepareFulfillmentAction: vi.fn(),
}));

import { FulfillmentWorkspace } from '@/components/fulfillment/fulfillment-workspace';
import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';

/**
 * A failed read must surface an explicit error, never a false empty state
 * ("No inventory items" / "Nothing to fulfill" on a read error is a lie).
 */
describe('read-error states (no fake empty states)', () => {
  it('Inventory shows an explicit read error, not "No inventory items"', () => {
    render(
      <InventoryWorkspace
        inventory={{ ok: false, reason: 'db down' }}
        reviews={[]}
        duplicates={[]}
        batches={[]}
        canMonitor={true}
        canReview={false}
        canMigrate={false}
      />,
    );
    expect(screen.getByText(/Inventory could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No inventory items/i)).not.toBeInTheDocument();
  });

  it('Fulfillment shows an explicit read error, not "Nothing to fulfill"', () => {
    render(
      <FulfillmentWorkspace
        fulfillments={{ ok: false, reason: 'db down' }}
        approvals={[]}
        canPrepare={false}
        canRelease={false}
        canRequest={false}
        isOwner={false}
      />,
    );
    expect(
      screen.getByText(/Fulfillment queue could not be loaded/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to fulfill/i)).not.toBeInTheDocument();
  });
});
