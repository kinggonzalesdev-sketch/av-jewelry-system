import type { ComponentProps } from 'react';

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
// Controllable delete result so a test can simulate the DB's "linked to a business
// record" refusal — that refusal is what reveals the Super Admin force-delete.
const h = vi.hoisted(() => ({ deleteLinked: false, depsActive: false }));
vi.mock('@/lib/inventory/actions', () => ({
  deleteInventoryItemAction: () =>
    Promise.resolve(
      h.deleteLinked
        ? {
            error: 'This item is linked to 1 business record(s) and cannot be deleted.',
            success: null,
          }
        : { error: null, success: null },
    ),
  // The force override is now gated on the item's REAL dependency resolution: an ACTIVE link keeps
  // the override hidden (depsActive=true), a resolved link reveals it (depsActive=false, default).
  checkItemDependenciesAction: () =>
    Promise.resolve({
      ok: true,
      dependencies: h.depsActive
        ? [{ kind: 'official_order', label: 'Order #1', isActive: true }]
        : [{ kind: 'inventory_reservation', label: 'Released reservation', isActive: false }],
    }),
  forceDeleteInventoryItemAction: () => emptyState(),
  editInventoryItemAction: () => emptyState(),
  restoreInventoryItemAction: () => emptyState(),
  permanentlyDeleteInventoryItemAction: () => emptyState(),
  requestInventoryItemDeletionAction: () => Promise.resolve({ ok: true }),
  requestInventoryEditAction: () => Promise.resolve({ ok: true }),
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

describe('InventoryItemActions — role-independent geometry (Owner request 2026-08-18)', () => {
  // The point: an Admin's Actions cell must look IDENTICAL to the Owner's — same labels, same
  // button dimensions, ONE horizontal line — even though Admin Edit/Delete route to approval.
  // (Regression guarded: Admin used to show longer "Request Edit / Request Delete" labels that
  // wrapped, making Admin rows taller than Owner rows.) These assert the shared classes that
  // decide the rendered geometry — role must select the handler, never the layout.
  function measure(props: ComponentProps<typeof InventoryItemActions>) {
    const { unmount } = render(<InventoryItemActions {...props} />);
    const view = screen.getByTestId('inventory-view-item-1');
    const container = view.parentElement as HTMLElement;
    const edit = screen.queryByTestId('inventory-edit-item-1');
    const del = screen.queryByTestId('inventory-delete-item-1');
    const data = {
      containerClass: container.className,
      viewClass: view.className,
      editText: edit?.textContent ?? null,
      editClass: edit?.className ?? null,
      deleteText: del?.textContent ?? null,
      deleteClass: del?.className ?? null,
    };
    unmount();
    return data;
  }
  const owner = () =>
    measure({ row: row({}), canEdit: true, canDelete: true, isOwner: true, canForceDelete: true });
  const admin = () => measure({ row: row({}), canEdit: true, canDelete: true });
  const staff = () => measure({ row: row({}), canEdit: false, canDelete: false });

  it('F: the Actions container never wraps (one line) for Owner, Admin, or Staff', () => {
    for (const m of [owner(), admin(), staff()]) {
      expect(m.containerClass).toContain('whitespace-nowrap');
    }
  });

  it('B/G: Owner and Admin share the IDENTICAL Actions container geometry', () => {
    expect(admin().containerClass).toBe(owner().containerClass);
  });

  it('C/D: Admin shows "Edit" / "Delete" — same labels as Owner, never a "Request" label', () => {
    const a = admin();
    const o = owner();
    expect(a.editText).toBe('Edit');
    expect(a.deleteText).toBe('Delete');
    expect(a.editText).toBe(o.editText);
    expect(a.deleteText).toBe(o.deleteText);
    expect(a.editText).not.toMatch(/request/i);
    expect(a.deleteText).not.toMatch(/request/i);
  });

  it('Owner and Admin buttons have identical dimensions (identical classNames)', () => {
    const a = admin();
    const o = owner();
    expect(a.viewClass).toBe(o.viewClass);
    expect(a.editClass).toBe(o.editClass);
    expect(a.deleteClass).toBe(o.deleteClass);
  });

  it('H: Staff (View only) keeps the SAME container + button geometry, gains no permission', () => {
    const s = staff();
    const o = owner();
    expect(s.containerClass).toBe(o.containerClass);
    expect(s.viewClass).toBe(o.viewClass);
    expect(s.editText).toBeNull();
    expect(s.deleteText).toBeNull();
  });
});

describe('InventoryItemActions — per-permission Edit / Delete', () => {
  it('shows View always, and Edit + direct Delete for the Super Admin (isOwner)', () => {
    render(
      <InventoryItemActions
        row={row({})}
        canEdit={true}
        canDelete={true}
        isOwner={true}
        canForceDelete={true}
      />,
    );
    expect(screen.getByTestId('inventory-view-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-edit-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-delete-item-1')).toBeInTheDocument();
  });

  it('an Admin (not the Owner) may INITIATE — Delete is REQUEST-only (Submit for Approval)', () => {
    // No isOwner: an Admin sees Edit/Delete, but the Delete modal SUBMITS FOR APPROVAL —
    // there is no direct "Delete permanently" path (Owner request 2026-08-17). This
    // supersedes the old Cynthia direct-delete grant.
    render(<InventoryItemActions row={row({})} canEdit={true} canDelete={true} />);
    expect(screen.getByTestId('inventory-edit-item-1')).toBeInTheDocument();
    expect(screen.getByTestId('inventory-delete-item-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));
    expect(
      screen.getByRole('button', { name: /Submit for Approval/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Delete permanently/i }),
    ).not.toBeInTheDocument();
  });

  it('hides Edit and Delete when neither permission is granted', () => {
    render(<InventoryItemActions row={row({})} canEdit={false} canDelete={false} />);
    expect(screen.getByTestId('inventory-view-item-1')).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-edit-item-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventory-delete-item-1')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('inventory-request-delete-item-1'),
    ).not.toBeInTheDocument();
  });

  it('gates Edit and Delete INDEPENDENTLY (edit granted, delete not)', () => {
    render(<InventoryItemActions row={row({})} canEdit={true} canDelete={false} />);
    expect(screen.getByTestId('inventory-edit-item-1')).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-delete-item-1')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('inventory-request-delete-item-1'),
    ).not.toBeInTheDocument();
  });

  it('View shows the compact Code / Status / Grams / Date fields', () => {
    render(
      <InventoryItemActions
        row={row({})}
        canEdit={true}
        canDelete={true}
        canForceDelete={true}
      />,
    );
    fireEvent.click(screen.getByTestId('inventory-view-item-1'));
    expect(screen.getByText('Inventory Code')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Grams')).toBeInTheDocument();
    expect(screen.getByText('Date Encoded')).toBeInTheDocument();
  });

  it('Delete requires typing DELETE before the button enables', () => {
    render(
      <InventoryItemActions
        row={row({})}
        canEdit={true}
        canDelete={true}
        isOwner={true}
        canForceDelete={true}
      />,
    );
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));

    expect(screen.getByPlaceholderText('DELETE')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: /Delete permanently/i });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    expect(button).toBeEnabled();
  });

  it('reveals the Super Admin force-delete ONLY after a blocked delete', async () => {
    h.deleteLinked = true;
    h.depsActive = false; // the linking record is RESOLVED → force-delete is genuinely available
    render(
      <InventoryItemActions
        row={row({})}
        canEdit={true}
        canDelete={true}
        isOwner={true}
        canForceDelete={true}
      />,
    );
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));
    // Not shown before an attempt — the override is a response to the DB refusal.
    expect(screen.queryByTestId('inventory-force-delete-item-1')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }));

    // After the refusal, the Super Admin override appears.
    expect(
      await screen.findByTestId('inventory-force-delete-item-1'),
    ).toBeInTheDocument();
    h.depsActive = false; // reset for later tests
  });

  it('does NOT offer force-delete when a blocked item is held by an ACTIVE record', async () => {
    // The BNW-N-6137 case (Owner 2026-09-08): the DB refuses the normal delete AND would refuse a
    // force delete, because a live order/payment/hold/layaway/sale holds the item. The override must
    // NOT be offered (it would only be refused again) — an actionable "Protected" note shows instead.
    h.deleteLinked = true;
    h.depsActive = true;
    render(
      <InventoryItemActions
        row={row({})}
        canEdit={true}
        canDelete={true}
        isOwner={true}
        canForceDelete={true}
      />,
    );
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));
    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Delete permanently/i }));

    expect(
      await screen.findByTestId('inventory-force-protected-item-1'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('inventory-force-delete-item-1'),
    ).not.toBeInTheDocument();
    h.deleteLinked = false;
    h.depsActive = false; // reset for later tests
  });

  it('an Admin submits Delete for approval — never a direct delete or force override', () => {
    render(<InventoryItemActions row={row({})} canEdit={true} canDelete={true} />);
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));
    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    // Admin path: the confirm button SUBMITS AN APPROVAL REQUEST — it never deletes
    // directly, and the Super-Admin force override is never available to an Admin.
    expect(
      screen.getByRole('button', { name: /Submit for Approval/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Delete permanently/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventory-force-delete-item-1')).not.toBeInTheDocument();
  });
});

/**
 * Actions-column GEOMETRY PARITY (Owner request 2026-08-18). Admin rows used to be taller
 * because the longer "Request Edit / Request Delete" labels wrapped inside a flex-wrap row.
 * Owner and Admin must now render IDENTICAL table buttons ("View | Edit | Delete") on ONE
 * line; the approval nature of an Admin's action lives entirely inside the modal.
 */
describe('InventoryItemActions — Owner/Admin geometry parity', () => {
  it('Owner and Admin show the SAME table labels (View / Edit / Delete) — no "Request …"', () => {
    const owner = render(
      <InventoryItemActions row={row({})} canEdit canDelete isOwner />,
    );
    expect(screen.getByTestId('inventory-edit-item-1').textContent).toBe('Edit');
    expect(screen.getByTestId('inventory-delete-item-1').textContent).toBe('Delete');
    owner.unmount();

    render(<InventoryItemActions row={row({})} canEdit canDelete />); // Admin
    expect(screen.getByTestId('inventory-edit-item-1').textContent).toBe('Edit');
    expect(screen.getByTestId('inventory-delete-item-1').textContent).toBe('Delete');
    // The old wrapping labels are gone for every role.
    expect(screen.queryByText('Request Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Request Delete')).not.toBeInTheDocument();
  });

  it('renders the action buttons on ONE line — nowrap, never flex-wrap', () => {
    render(<InventoryItemActions row={row({})} canEdit canDelete />);
    const actionRow = screen.getByTestId('inventory-view-item-1').parentElement!;
    expect(actionRow.className).toContain('whitespace-nowrap');
    expect(actionRow.className).not.toContain('flex-wrap');
  });

  it('an Admin edit request confirms INSIDE the modal (not an inline cell note) and offers Done', async () => {
    render(<InventoryItemActions row={row({})} canEdit canDelete />);
    fireEvent.click(screen.getByTestId('inventory-edit-item-1'));
    fireEvent.submit(document.getElementById('inventory-edit-form-item-1') as HTMLFormElement);
    expect(
      await screen.findByText(/submitted for Super Admin approval/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Done$/ })).toBeInTheDocument();
    // Once submitted, the request button is gone (replaced by Done) — no re-submit.
    expect(
      screen.queryByRole('button', { name: /Submit for Approval/i }),
    ).not.toBeInTheDocument();
  });

  it('an Admin delete request confirms INSIDE the modal and offers Done', async () => {
    render(<InventoryItemActions row={row({})} canEdit canDelete />);
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));
    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'DELETE' } });
    fireEvent.submit(document.getElementById('inventory-delete-form-item-1') as HTMLFormElement);
    expect(
      await screen.findByText(/Deletion request submitted for Super Admin approval/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Done$/ })).toBeInTheDocument();
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
