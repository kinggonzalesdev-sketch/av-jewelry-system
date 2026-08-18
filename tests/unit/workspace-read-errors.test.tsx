import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// InventoryWorkspace can mount modals that call useRouter. A router stub suffices.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Server actions are mocked — this render test only exercises the read-error branch.
vi.mock('@/lib/inventory/actions', () => ({
  createInventoryItemAction: vi.fn(),
  returnCompletedItemAction: vi.fn(),
  decideRtsAction: vi.fn(),
  openMigrationBatchAction: vi.fn(),
  returnToAvailableAction: vi.fn(),
  reviewDuplicateAction: vi.fn(),
}));

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';

/**
 * A failed read must surface an explicit error, never a false empty state
 * ("No inventory items" on a read error is a lie).
 */
describe('read-error states (no fake empty states)', () => {
  it('Inventory shows an explicit read error, not "No inventory items"', () => {
    render(
      <InventoryWorkspace
        initialPage={{ ok: false, reason: 'db down' }}
        canMonitor={true}
      />,
    );
    expect(screen.getByText(/Inventory could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/No inventory items/i)).not.toBeInTheDocument();
  });
});
