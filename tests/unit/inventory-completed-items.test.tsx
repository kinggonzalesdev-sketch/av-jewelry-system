import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';
import type { CompletedInventoryRow } from '@/lib/inventory/completed';
import type { InventoryRow } from '@/lib/inventory/service';

/**
 * Active Inventory vs Completed Items (spec §3/§4/§5). One source of truth split
 * by status: completed/released items NEVER show as available, and appear under
 * the Completed Items tab (historical) — the record is never deleted.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function row(over: Partial<InventoryRow>): InventoryRow {
  return {
    inventoryItemId: crypto.randomUUID(),
    itemCode: 'SBA-N-2001',
    itemName: null,
    availabilityStatus: 'available',
    quantityTotal: 1,
    availableQuantity: 1,
    reservedQuantity: 0,
    inRtsReview: false,
    isForfeited: false,
    custodyHolder: 'av_jewelry',
    storageLocation: null,
    handlerName: null,
    gramsPerPiece: null,
    size: null,
    supplierName: null,
    facebookName: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    ...over,
  };
}

const rows: InventoryRow[] = [
  row({ itemCode: 'SBA-N-1111', availabilityStatus: 'available' }),
  row({ itemCode: 'SBA-R-2222', availabilityStatus: 'released' }),
  row({ itemCode: 'SBA-E-3333', availabilityStatus: 'completed' }),
  // Consumed by a New Order — reserved to it, so no longer sellable stock.
  row({ itemCode: 'SBA-C-4444', availabilityStatus: 'committed' }),
];

function completedRow(over: Partial<CompletedInventoryRow>): CompletedInventoryRow {
  return {
    inventoryItemId: crypto.randomUUID(),
    itemCode: 'SBA-R-2222',
    itemName: null,
    availabilityStatus: 'released',
    customerName: 'Maria Santos',
    orderNumber: 'ORD-9',
    invoiceNumber: 'INV-9',
    completionType: 'Delivered',
    courier: null,
    trackingNumber: null,
    completedDate: '2026-07-20T00:00:00.000Z',
    currentHolder: 'A.V. Jewelry',
    currentLocation: null,
    finalSale: '8000.00',
    paymentStatus: 'paid_in_full',
    currentStage: 'Completed',
    ...over,
  };
}

const completed: CompletedInventoryRow[] = [
  completedRow({ itemCode: 'SBA-R-2222', finalSale: '8000.00', paymentStatus: 'paid_in_full' }),
  completedRow({
    itemCode: 'SBA-E-3333',
    completionType: 'Store Pickup',
    finalSale: '12000.00',
    paymentStatus: 'partial',
  }),
  // Reserved to a live order — listed here with the stage it is actually in.
  completedRow({
    itemCode: 'SBA-C-4444',
    availabilityStatus: 'committed',
    finalSale: '5000.00',
    paymentStatus: 'unpaid',
    currentStage: 'For Invoice',
  }),
];

function renderWorkspace() {
  return render(
    <InventoryWorkspace
      inventory={{ ok: true, rows }}
      completed={completed}
      canMonitor={false}
    />,
  );
}

describe('Inventory — Active vs Completed', () => {
  it('Active Inventory hides completed/released items', () => {
    renderWorkspace();
    expect(screen.getByText('SBA-N-1111')).toBeInTheDocument();
    expect(screen.queryByText('SBA-R-2222')).not.toBeInTheDocument();
    expect(screen.queryByText('SBA-E-3333')).not.toBeInTheDocument();
  });

  it('Completed Items shows the sold/released items (historical)', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: 'Completed Items' }));
    const table = screen.getByTestId('completed-items');
    expect(within(table).getByText('SBA-R-2222')).toBeInTheDocument();
    expect(within(table).getByText('SBA-E-3333')).toBeInTheDocument();
    // The active item is NOT in the completed table.
    expect(within(table).queryByText('SBA-N-1111')).not.toBeInTheDocument();
  });

  it('an item consumed by an order leaves Active Inventory immediately', () => {
    renderWorkspace();
    // Committed to a New Order — it is no longer sellable stock.
    expect(screen.queryByText('SBA-C-4444')).not.toBeInTheDocument();
  });

  it('Completed Items shows the live Current Stage for a reserved item', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: 'Completed Items' }));
    const table = screen.getByTestId('completed-items');
    expect(within(table).getByText('SBA-C-4444')).toBeInTheDocument();
    expect(within(table).getByText('For Invoice')).toBeInTheDocument();
  });

  it('hides the per-row Delete on Completed Items for non-Super-Admins', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('tab', { name: 'Completed Items' }));
    const table = screen.getByTestId('completed-items');
    // Only View — never Delete — when canReturnCompleted is not granted.
    expect(within(table).queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows a Super-Admin Delete that removes the order info + returns the item', () => {
    render(
      <InventoryWorkspace
        inventory={{ ok: true, rows }}
        completed={completed}
        canMonitor={false}
        canReturnCompleted
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Completed Items' }));
    const deletes = screen.getAllByText('Delete');
    expect(deletes.length).toBe(completed.length);
    fireEvent.click(deletes[0]!);
    // Honest wording: the item is returned to inventory, not deleted; gated on DELETE.
    expect(
      screen.getByRole('heading', { name: 'Delete order info & return item to inventory' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/goes back to available stock/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete info & return' }),
    ).toBeInTheDocument();
  });
});
