import type { ComponentProps } from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const h = vi.hoisted(() => ({
  deleteLinked: false,
  depsActive: false,
  layaway: false,
  legacy: false,
  linkReads: 0,
}));
// The in-place layaway viewer (loaded with next/dynamic) — a stub that shows which account it opens.
vi.mock('@/components/payments/layaway-ledger-view-modal', () => ({
  LayawayLedgerViewModal: ({ ledgerId }: { ledgerId: string }) => (
    <button type="button">View layaway {ledgerId}</button>
  ),
}));
// The records the database lists for the item (inventory_item_delete_links). Closed history by
// default — WBN-E-3759's real pair: its line on a cancelled order + a finished return review.
const closedLinks = [
  {
    kind: 'order',
    recordId: 'o-1',
    orderId: 'o-1',
    ledgerId: null,
    label: 'MARIA LYZZA · 2026-08-07',
    state: 'cancelled',
    blocks: false,
    reason: 'Cancelled order with no payment.',
  },
  {
    kind: 'return_review',
    recordId: 'r-1',
    orderId: null,
    ledgerId: null,
    label: 'Return to stock · 2026-08-15',
    state: 'approved_return',
    blocks: false,
    reason: 'Finished return review.',
  },
];
const liveLink = {
  kind: 'order',
  recordId: 'o-live',
  orderId: 'o-live',
  ledgerId: null,
  label: 'JOSE CRUZ · 2026-09-20',
  state: 'for_preparation',
  blocks: true,
  reason: 'Live order.',
};
const layawayLink = {
  kind: 'layaway',
  recordId: 'l-1',
  orderId: null,
  ledgerId: 'l-1',
  label: 'LAY-0042 · ANA REYES',
  state: 'active',
  blocks: true,
  reason: 'Active layaway.',
};
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
  // The force override is gated on the item's REAL linked records: a PROTECTED record keeps the
  // override hidden (depsActive=true), closed history only reveals it (depsActive=false, default).
  checkItemDeleteLinksAction: () => {
    h.linkReads += 1;
    return Promise.resolve({
      ok: true,
      // legacy = the older list, read before the migration is applied (always protected).
      exact: !h.legacy,
      links: h.legacy
        ? closedLinks.map((l) => ({ ...l, orderId: null, blocks: true, reason: null }))
        : h.layaway
          ? [layawayLink]
          : h.depsActive
            ? [liveLink]
            : closedLinks,
    });
  },
  checkItemDependenciesAction: () =>
    Promise.resolve({
      ok: true,
      dependencies: h.depsActive
        ? [{ kind: 'official_order', label: 'Order #1', isActive: true }]
        : [
            {
              kind: 'inventory_reservation',
              label: 'Released reservation',
              isActive: false,
            },
          ],
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
    measure({
      row: row({}),
      canEdit: true,
      canDelete: true,
      isOwner: true,
      canForceDelete: true,
    });
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
    expect(screen.queryByTestId('inventory-force-delete-item-1')).not.toBeInTheDocument();
    h.deleteLinked = false;
    h.depsActive = false; // reset for later tests
  });

  // Owner 2026-09-26: "show me which record … it should be clickable".
  async function blockedDelete() {
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
    return screen.findByTestId('inventory-delete-links-item-1');
  }

  it('lists WHICH records link the item, each order opening that exact order', async () => {
    h.deleteLinked = true;
    const list = await blockedDelete();
    expect(list).toHaveTextContent('Linked records (2)');
    expect(list).toHaveTextContent('Order · MARIA LYZZA · 2026-08-07');
    expect(list).toHaveTextContent('Cancelled — Cancelled order with no payment.');
    expect(list).toHaveTextContent('Return review · Return to stock · 2026-08-15');
    expect(list).toHaveTextContent('Approved Return — Finished return review.');
    const open = screen.getByRole('link', { name: 'Open order' });
    expect(open).toHaveAttribute('href', '/orders?order=o-1');
    // Only the order has a page to open; the review shows no dead link.
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getAllByText('Closed')).toHaveLength(2);
    // Closed history only → the Super Admin override is offered.
    expect(screen.getByTestId('inventory-force-delete-item-1')).toBeInTheDocument();
    h.deleteLinked = false;
  });

  it('marks a live order Protected, still links to it, and offers no override', async () => {
    h.deleteLinked = true;
    h.depsActive = true;
    const list = await blockedDelete();
    expect(list).toHaveTextContent('Order · JOSE CRUZ · 2026-09-20');
    expect(list).toHaveTextContent('For Preparation — Live order.');
    expect(screen.getByText('Protected', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open order' })).toHaveAttribute(
      'href',
      '/orders?order=o-live',
    );
    expect(screen.getByTestId('inventory-force-protected-item-1')).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-force-delete-item-1')).not.toBeInTheDocument();
    h.deleteLinked = false;
    h.depsActive = false;
  });

  it('a layaway account opens in place and keeps the item protected', async () => {
    h.deleteLinked = true;
    h.layaway = true;
    const list = await blockedDelete();
    expect(list).toHaveTextContent('Layaway · LAY-0042 · ANA REYES');
    expect(
      await screen.findByRole('button', { name: 'View layaway l-1' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('inventory-force-delete-item-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('inventory-force-protected-item-1')).toBeInTheDocument();
    h.deleteLinked = false;
    h.layaway = false;
  });

  it('before the database update, the older list never offers the override or calls anything Closed', async () => {
    h.deleteLinked = true;
    h.legacy = true;
    const list = await blockedDelete();
    expect(list).toHaveTextContent(
      'Record details and force delete become available after the database update.',
    );
    expect(screen.queryByText('Closed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('inventory-force-delete-item-1')).not.toBeInTheDocument();
    h.deleteLinked = false;
    h.legacy = false;
  });

  it('re-reads the records every time the popup opens, never showing a stale list', async () => {
    h.deleteLinked = true;
    h.linkReads = 0;
    await blockedDelete();
    const afterFirst = h.linkReads;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    // Close and reopen: the list is read again.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('inventory-delete-item-1'));
    await waitFor(() => expect(h.linkReads).toBeGreaterThan(afterFirst));
    h.deleteLinked = false;
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
    fireEvent.submit(
      document.getElementById('inventory-edit-form-item-1') as HTMLFormElement,
    );
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
    fireEvent.change(screen.getByPlaceholderText('DELETE'), {
      target: { value: 'DELETE' },
    });
    fireEvent.submit(
      document.getElementById('inventory-delete-form-item-1') as HTMLFormElement,
    );
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
