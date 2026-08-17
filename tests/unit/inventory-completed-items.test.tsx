import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InventoryWorkspace } from '@/components/inventory/inventory-workspace';
import type { CompletedInventoryRow } from '@/lib/inventory/completed';
import type { InventoryRow } from '@/lib/inventory/service';

/**
 * Active Inventory vs Completed Items (spec §3/§4/§5). One source of truth split by
 * status: completed/released items NEVER show as available, and appear under the Completed
 * Items tab (historical) — the record is never deleted. Completed Items is SERVER-PAGINATED:
 * the EXACT total comes from the server, never from how many rows the browser loaded, so the
 * count is 12,485 of 12,485 (or 1–50 of 12,485), never a "999 of 999" cap.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// Server-paginated Completed Items: the workspace fetches a PAGE (+ exact total) via the
// server action when the tab opens. The mock stands in for that server round-trip.
const H = vi.hoisted<{
  rows: CompletedInventoryRow[];
  total: number;
  searchTotal: number;
  typeCounts: Record<string, number>;
}>(() => ({ rows: [], total: 0, searchTotal: 0, typeCounts: {} }));
vi.mock('@/lib/inventory/actions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Only the Completed-Items server page is stubbed — every other action stays real (they
    // are wired via useActionState but never invoked in these tests).
    loadCompletedInventoryPageAction: vi.fn(() =>
      Promise.resolve({
        ok: true,
        rows: H.rows,
        total: H.total,
        searchTotal: H.searchTotal,
        typeCounts: H.typeCounts,
      }),
    ),
  };
});

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

/** Point the mocked server page at a fixture (rows) with an EXACT server total. */
function serveCompleted(pageRows: CompletedInventoryRow[], total = pageRows.length): void {
  H.rows = pageRows;
  H.total = total;
  H.searchTotal = total;
  H.typeCounts = pageRows.reduce<Record<string, number>>((acc, c) => {
    acc[c.completionType] = (acc[c.completionType] ?? 0) + 1;
    return acc;
  }, {});
}

beforeEach(() => {
  serveCompleted(completed);
});

function renderWorkspace(extra: Record<string, unknown> = {}) {
  return render(
    <InventoryWorkspace
      initialPage={{ ok: true, rows, total: rows.length, groupCounts: {}, statusOptions: [] }}
      canMonitor={false}
      {...extra}
    />,
  );
}

const openCompleted = () =>
  fireEvent.click(screen.getByRole('tab', { name: 'Completed Items' }));

describe('Inventory — Active vs Completed', () => {
  it('Active Inventory hides completed/released items', () => {
    renderWorkspace();
    expect(screen.getByText('SBA-N-1111')).toBeInTheDocument();
    expect(screen.queryByText('SBA-R-2222')).not.toBeInTheDocument();
    expect(screen.queryByText('SBA-E-3333')).not.toBeInTheDocument();
  });

  it('Completed Items shows the sold/released items (historical)', async () => {
    renderWorkspace();
    openCompleted();
    const table = screen.getByTestId('completed-items');
    expect(await within(table).findByText('SBA-R-2222')).toBeInTheDocument();
    expect(within(table).getByText('SBA-E-3333')).toBeInTheDocument();
    expect(within(table).queryByText('SBA-N-1111')).not.toBeInTheDocument();
  });

  it('an item consumed by an order leaves Active Inventory immediately', () => {
    renderWorkspace();
    expect(screen.queryByText('SBA-C-4444')).not.toBeInTheDocument();
  });

  it('Completed Items shows the live Current Stage for a reserved item', async () => {
    renderWorkspace();
    openCompleted();
    const table = screen.getByTestId('completed-items');
    expect(await within(table).findByText('SBA-C-4444')).toBeInTheDocument();
    expect(within(table).getByText('For Invoice')).toBeInTheDocument();
  });

  it('removes the Order and Invoice columns but keeps the key business columns', async () => {
    renderWorkspace();
    openCompleted();
    const table = await screen.findByTestId('completed-items');
    await within(table).findByText('SBA-R-2222');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).not.toContain('Order');
    expect(headers).not.toContain('Invoice');
    expect(headers).toEqual(
      expect.arrayContaining([
        'Inventory Code',
        'Customer',
        'Sale Amount',
        'Payment',
        'Current Stage',
        'Completion Date',
        'Actions',
      ]),
    );
  });

  it('shows real Customer / Payment / Stage values (not — placeholders)', async () => {
    renderWorkspace();
    openCompleted();
    const table = await screen.findByTestId('completed-items');
    expect((await within(table).findAllByText('Maria Santos')).length).toBeGreaterThan(0);
    expect(within(table).getAllByText('Paid in Full').length).toBeGreaterThan(0);
    expect(within(table).getByText('For Invoice')).toBeInTheDocument();
  });

  it('hides the per-row Delete on Completed Items for non-Super-Admins', async () => {
    renderWorkspace();
    openCompleted();
    const table = screen.getByTestId('completed-items');
    await within(table).findByText('SBA-R-2222');
    expect(within(table).queryByText('Delete')).not.toBeInTheDocument();
  });

  it('shows a Super-Admin Delete that removes the order info + returns the item', async () => {
    renderWorkspace({ canReturnCompleted: true });
    openCompleted();
    const deletes = await screen.findAllByText('Delete');
    expect(deletes.length).toBe(completed.length);
    fireEvent.click(deletes[0]!);
    expect(
      screen.getByRole('heading', {
        name: 'Delete order info & return item to inventory',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/goes back to available stock/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete info & return' })).toBeInTheDocument();
  });
});

describe('Completed Items — exact server total (no 999/1000 cap)', () => {
  // The displayed total must be the EXACT server count, regardless of how many rows the
  // page loaded. A single 25-row page must still report the true total of N.
  const onePage = [completedRow({ itemCode: 'SBA-N-0001' })];

  for (const n of [999, 1000, 1001, 10000, 10001, 25750]) {
    it(`shows the exact total for ${n.toLocaleString()} matching records`, async () => {
      serveCompleted(onePage, n);
      renderWorkspace();
      openCompleted();
      await waitFor(() =>
        expect(screen.getByTestId('completed-count')).toHaveTextContent(
          `of ${n.toLocaleString()}`,
        ),
      );
      // Never the loaded-row count as the ceiling.
      expect(screen.getByTestId('completed-count')).not.toHaveTextContent('of 1 ');
      expect(screen.getByTestId('completed-count')).not.toHaveTextContent('999 of 999');
    });
  }
});
