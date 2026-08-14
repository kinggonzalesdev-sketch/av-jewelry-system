import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LayawayEditItems } from '@/components/payments/layaway-edit-items';
import type { CaptureItem } from '@/lib/orders/service';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';

type Item = LayawayLedgerDetail['items'][number];

// Layaway server actions are transport (covered by the domain + SQL rollback probes);
// stub them so this focuses on the panel's structure + the exact price it sends.
// `addLayaway` forwards its args so a test can assert the price passed to the DB.
const addLayaway = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true as const }));
const removeLayaway = vi.fn(() => Promise.resolve({ ok: true as const }));
const splitLayaway = vi.fn(() =>
  Promise.resolve({ ok: true as const, orderNumber: 'ORD-2026-000999' }),
);
vi.mock('@/lib/payments/actions', () => ({
  addLayawayItemAction: (...a: unknown[]) => addLayaway(...a),
  removeLayawayItemAction: () => removeLayaway(),
  splitLayawayItemToOrderAction: () => splitLayaway(),
}));

// AddItemSearchRow (reused from the Order Edit panel) runs its own Active-Inventory
// search; stub it so the row picks a known weighable item.
const search = vi.fn((): Promise<CaptureItem[]> => Promise.resolve([]));
vi.mock('@/lib/orders/actions', () => ({
  addOrderItemAction: vi.fn(),
  removeOrderItemAction: vi.fn(),
  splitOrderItemAction: vi.fn(),
  requestOrderEditAction: vi.fn(),
  searchCaptureItemsAction: () => search(),
}));

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'item-a',
    itemCode: 'SBA-R-1',
    itemName: 'Ring',
    grams: '5',
    unitPrice: '1000.00',
    itemAmount: '1000.00',
    ...over,
  };
}

const twoItems: Item[] = [item(), item({ id: 'item-b', itemCode: 'SBA-R-2' })];

function renderPanel(over?: { items?: Item[]; canManage?: boolean }) {
  const onRefresh = vi.fn();
  render(
    <LayawayEditItems
      ledgerId="ledger-1"
      items={over?.items ?? twoItems}
      canManage={over?.canManage ?? true}
      layawayTerm={3}
      existingPayment="0.00"
      datePurchased="2026-08-01"
      remarks={null}
      interestType="custom"
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

const weighable: CaptureItem = {
  id: 'inv-1',
  itemCode: 'SBA-R-9',
  itemName: 'Ring',
  unitPrice: '1000.00',
  gramsPerPiece: '2',
  availabilityStatus: 'available',
};

/** Type into the first row's search, then pick the (single) result. */
async function pickWeighable() {
  search.mockResolvedValueOnce([weighable]);
  fireEvent.change(screen.getByTestId('layaway-add-item-search'), {
    target: { value: 'SBA-R-9' },
  });
  fireEvent.click(await screen.findByTestId('order-add-item-pick-inv-1'));
}

describe('LayawayEditItems — Edit Items (Owner / Admin)', () => {
  it('renders for a manager and hides for everyone else', () => {
    const { onRefresh } = renderPanel();
    expect(screen.getByTestId('layaway-edit-items')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();

    render(
      <LayawayEditItems
        ledgerId="ledger-1"
        items={twoItems}
        canManage={false}
        layawayTerm={3}
        existingPayment="0.00"
        datePurchased="2026-08-01"
        remarks={null}
        interestType="custom"
        onRefresh={vi.fn()}
      />,
    );
    // Still exactly one panel in the document (the manager's) — the non-manager rendered
    // nothing.
    expect(screen.getAllByTestId('layaway-edit-items')).toHaveLength(1);
  });

  it('keeps the item list with per-row Remove + Split (multi-item)', () => {
    renderPanel();
    expect(screen.getByTestId('layaway-item-remove-item-a')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-item-split-item-b')).toBeInTheDocument();
  });

  it('Remove asks to confirm, then calls the action', () => {
    removeLayaway.mockClear();
    renderPanel();
    fireEvent.click(screen.getByTestId('layaway-item-remove-item-a'));
    // Confirm modal appears; nothing called yet.
    expect(removeLayaway).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('layaway-item-edit-confirm'));
    expect(removeLayaway).toHaveBeenCalledTimes(1);
  });

  it('exposes the full New-Entry-style form (search row + term + summary + Save)', () => {
    renderPanel();
    // Item 1's inventory search carries the historical test id.
    expect(screen.getByTestId('layaway-add-item-search')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-edit-add-row')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-edit-totals')).toBeInTheDocument();
    // Term toggle reflects the account (3 mos); the button reads "Save".
    expect(screen.getByTestId('layaway-edit-term-3')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-edit-items-save')).toHaveTextContent('Save');
  });

  it('does nothing to save with no item, term change, or payment', () => {
    addLayaway.mockClear();
    renderPanel();
    fireEvent.click(screen.getByTestId('layaway-edit-items-save'));
    expect(addLayaway).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/nothing to save/i);
  });

  it('Save adds the picked item (fixed prefill) and shows the note', async () => {
    addLayaway.mockClear();
    const { onRefresh } = renderPanel({ items: [item()] });

    await pickWeighable();
    fireEvent.click(screen.getByTestId('layaway-edit-items-save'));
    // The green note appears once the add resolves (all state flushed).
    expect(await screen.findByTestId('layaway-edit-items-note')).toHaveTextContent(
      /added 1 item/i,
    );
    // The UI-computed total is sent as a FIXED price (item_amount = exact shown total).
    expect(addLayaway).toHaveBeenCalledWith('ledger-1', 'inv-1', 'fixed', '1000.00');
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  // Per-Gram must send grams × rate (via the SHARED centavo math), NOT the Fixed prefill —
  // so a piece priced here matches the Order form exactly. The item is 2g, catalogue
  // ₱1,000 (deliberately different from the per-gram result to prove the math ran).
  it('Price Per Gram: sends grams × rate as the fixed item price', async () => {
    addLayaway.mockClear();
    renderPanel({ items: [item()] });

    await pickWeighable();
    fireEvent.click(screen.getByTestId('add-item-mode-per_gram-0'));
    fireEvent.change(screen.getByTestId('add-item-pergram-0'), {
      target: { value: '750' },
    });
    // 2g × ₱750 = ₱1,500 on the row line.
    expect(screen.getByTestId('add-item-line-0')).toHaveTextContent('₱1,500');

    fireEvent.click(screen.getByTestId('layaway-edit-items-save'));
    await vi.waitFor(() => expect(addLayaway).toHaveBeenCalledTimes(1));
    // The price is the computed grams × rate ('1500.00'), not the '1000.00' Fixed prefill.
    expect(addLayaway).toHaveBeenCalledWith('ledger-1', 'inv-1', 'fixed', '1500.00');
  });
});
