import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InventoryItemActions } from '@/components/inventory/inventory-item-actions';
import { ArchivedItemsView } from '@/components/inventory/archived-items-view';
import type { InventoryRow } from '@/lib/inventory/service';
import type { ArchivedInventoryRow } from '@/lib/inventory/archive';

/**
 * Inventory safe delete & archive (spec §1–§8), UI behaviour:
 *   - Active rows expose View / Edit / Delete;
 *   - the Delete modal warns, checks dependencies, requires a reason, and blocks
 *     archive for historical / in-flight items;
 *   - Archived Items exposes Restore (monitor) and Permanent Delete (Owner only).
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const emptyState = () => Promise.resolve({ error: null, success: null });
vi.mock('@/lib/inventory/actions', () => ({
  deleteInventoryItemAction: () => emptyState(),
  editInventoryItemAction: () => emptyState(),
  restoreInventoryItemAction: () => emptyState(),
  permanentlyDeleteInventoryItemAction: () => emptyState(),
}));

function row(over: Partial<InventoryRow>): InventoryRow {
  return {
    inventoryItemId: 'item-1',
    itemCode: 'SBA-N-1001',
    itemName: 'Test Ring',
    availabilityStatus: 'available',
    quantityTotal: 1,
    availableQuantity: 1,
    reservedQuantity: 0,
    inRtsReview: false,
    isForfeited: false,
    custodyHolder: 'av_jewelry',
    storageLocation: null,
    handlerName: null,
    gramsPerPiece: '12.2',
    size: '7',
    supplierName: null,
    facebookName: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    ...over,
  };
}

describe('InventoryItemActions — type-DELETE confirmation', () => {
  it('shows View/Edit/Delete for a monitor', () => {
    render(<InventoryItemActions row={row({})} canMonitor={true} />);
    expect(screen.getByTestId('inventory-view-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-edit-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-delete-item-1')).toBeInTheDocument();
  });

  it('hides Edit/Delete when the caller cannot monitor inventory', () => {
    render(<InventoryItemActions row={row({})} canMonitor={false} />);
    expect(screen.getByTestId('inventory-view-item-1')).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-edit-item-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventory-delete-item-1')).not.toBeInTheDocument();
  });

  it('View shows the compact Code / Status / Grams / Date fields', () => {
    render(<InventoryItemActions row={row({})} canMonitor={true} />);
    fireEvent.click(screen.getByTestId('inventory-view-item-1'));
    expect(screen.getByText('Inventory Code')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Grams')).toBeInTheDocument();
    expect(screen.getByText('Date Encoded')).toBeInTheDocument();
  });

  it('Delete requires typing DELETE before the button enables', () => {
    render(<InventoryItemActions row={row({})} canMonitor={true} />);
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));

    expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Delete permanently/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    expect(button).toBeEnabled();
  });
});

function archivedRow(over: Partial<ArchivedInventoryRow>): ArchivedInventoryRow {
  return {
    inventoryItemId: 'arch-1',
    itemCode: 'SBA-N-9001',
    itemName: 'Bad Encode',
    archivedFromStatus: 'available',
    archiveReasonCode: 'incorrectly_encoded',
    archiveReasonDetail: null,
    archivedByName: 'Owner',
    archivedAt: '2026-07-23T00:00:00.000Z',
    ...over,
  };
}

describe('ArchivedItemsView — restore / permanent delete gating', () => {
  it('shows Restore for a monitor but Permanent Delete only for the Owner', () => {
    const { rerender } = render(
      <ArchivedItemsView
        archived={{ ok: true, rows: [archivedRow({})] }}
        canMonitor={true}
        isOwner={false}
      />,
    );
    expect(screen.getByTestId('archived-restore-arch-1')).toBeInTheDocument();
    expect(screen.queryByTestId('archived-delete-arch-1')).not.toBeInTheDocument();

    rerender(
      <ArchivedItemsView
        archived={{ ok: true, rows: [archivedRow({})] }}
        canMonitor={true}
        isOwner={true}
      />,
    );
    expect(screen.getByTestId('archived-delete-arch-1')).toBeInTheDocument();
  });

  it('surfaces a read error instead of a false empty state', () => {
    render(
      <ArchivedItemsView
        archived={{ ok: false, reason: 'db down' }}
        canMonitor={true}
        isOwner={true}
      />,
    );
    expect(screen.getByText(/Archived items could not be loaded/i)).toBeInTheDocument();
  });
});
