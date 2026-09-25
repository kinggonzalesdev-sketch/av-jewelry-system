import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewOrderModal } from '@/components/orders/new-order-workflow';
import type { CaptureItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';

/**
 * Incoming Captures → Use → Save (Owner 2026-09-26):
 *   - the order saves with each line's pricing snapshot (the exact rate + grams typed),
 *   - NOTHING is queued for printing on save — only "Print sticker" (an explicit click) prints,
 *   - a plain "+ New Order" still prints on save, exactly as before.
 */

const save = vi.fn((..._a: unknown[]) =>
  Promise.resolve({
    ok: true as const,
    officialOrderId: 'o1',
    orderNumber: '',
    invoiceNumber: '',
    itemCount: 1,
    customerName: 'Ana Cruz',
  }),
);
const enqueue = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ ok: true as const, queued: 1, duplicates: 0, jobIds: ['job-1'] }),
);
const link = vi.fn((..._a: unknown[]) => Promise.resolve({ ok: true }));

vi.mock('@/lib/orders/actions', () => ({
  captureManualOrderAction: (...a: unknown[]) => save(...a),
  completeWalkInOrderAction: vi.fn(),
  loadNewOrderDataAction: vi.fn(),
  recordOrderPrintAction: vi.fn(() => Promise.resolve()),
  saveWalkInOrderAction: vi.fn(),
  searchCaptureItemsAction: vi.fn(() => Promise.resolve([])),
  transferOrderDestinationAction: vi.fn(),
  transferWalkInToReminderAction: vi.fn(),
  updateInventoryGramsAction: vi.fn(),
}));
vi.mock('@/lib/print/order-print-queue', () => ({
  enqueueOrderStickersAction: (...a: unknown[]) => enqueue(...a),
  getPrintJobsStatusAction: vi.fn(() => Promise.resolve([])),
  retryPrintJobAction: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock('@/lib/capture/pending-actions', () => ({
  linkCaptureToOrderAction: (...a: unknown[]) => link(...a),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/attachments/photo-capture', () => ({
  PhotoCapture: () => <div data-testid="photo-capture" />,
}));

const customers = [{ id: 'c1', displayName: 'Ana Cruz' }];
const items: CaptureItem[] = [
  {
    id: 'i1',
    itemCode: 'SBA-R-6301 1.12g',
    itemName: 'Ring',
    unitPrice: '7000.00',
    gramsPerPiece: '1.12',
    availabilityStatus: 'available',
  },
];
const admins: AdminNameContext = {
  selfId: 'staff-1',
  selfName: 'UAT Owner',
  canChange: false,
  options: [{ id: 'staff-1', fullName: 'UAT Owner' }],
};

function renderUse(autoPrintOnSave?: boolean) {
  return render(
    <NewOrderModal
      customers={customers}
      items={items}
      walkInItems={[]}
      admins={admins}
      newEntryOnly
      prefill={{ customerName: 'Ana Cruz', captureRecordId: 'cap-1' }}
      {...(autoPrintOnSave === undefined ? {} : { autoPrintOnSave })}
      onClose={vi.fn()}
    />,
  );
}

/** Pick the 1.12 g ring, price it at ₱6,800/g (= ₱7,616), and confirm. */
async function saveAt6800() {
  const row0 = screen.getByTestId('order-item-row-0');
  fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
    target: { value: 'SBA-R-6301 1.12g — Ring' },
  });
  fireEvent.click(within(row0).getByRole('button', { name: 'Price Per Gram' }));
  fireEvent.change(within(row0).getByPlaceholderText('0.00'), {
    target: { value: '6800' },
  });
  expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱7,616');
  fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
  await screen.findByTestId('order-saved');
}

describe('Incoming Captures → Use → Save', () => {
  beforeEach(() => {
    save.mockClear();
    enqueue.mockClear();
    link.mockClear();
  });

  it('saves the order with the EXACT Price Per Gram and grams as the line snapshot', async () => {
    renderUse(false);
    await saveAt6800();
    expect(save).toHaveBeenCalledTimes(1);
    const input = save.mock.calls[0]?.[0] as { items: unknown[] };
    expect(input.items).toEqual([
      {
        inventoryItemId: 'i1',
        unitPrice: '7616.00',
        quantity: 1,
        pricing: { mode: 'per_gram', price_per_gram: '6800.00', grams: '1.120' },
      },
    ]);
    // The capture is still linked to its order.
    expect(link).toHaveBeenCalledWith('cap-1', 'o1');
  });

  it('queues NO print on save; "Print sticker" prints once, on an explicit click', async () => {
    renderUse(false);
    await saveAt6800();
    expect(enqueue).not.toHaveBeenCalled();
    expect(screen.getByTestId('print-idle')).toHaveTextContent(/no sticker was printed/i);

    fireEvent.click(screen.getByRole('button', { name: /print sticker/i }));
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    // A FIRST print (not a reprint): the fixed per-sticker queue key keeps a double click to one.
    expect(enqueue.mock.calls[0]?.[0]).toBe('o1');
    expect(enqueue.mock.calls[0]?.[2]).toEqual({ reprint: false });
    // The button is gone once the print is on its way — no second queue from this panel.
    expect(
      screen.queryByRole('button', { name: /print sticker/i }),
    ).not.toBeInTheDocument();
  });

  it('a plain New Order still prints on save (unchanged)', async () => {
    renderUse(undefined);
    await saveAt6800();
    await vi.waitFor(() => expect(enqueue).toHaveBeenCalledTimes(1));
    expect(enqueue.mock.calls[0]?.[2]).toEqual({ reprint: false });
    expect(screen.queryByTestId('print-idle')).not.toBeInTheDocument();
  });

  it('a Fixed Price row saves as fixed — no grams, no rate', async () => {
    renderUse(false);
    const row0 = screen.getByTestId('order-item-row-0');
    fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
      target: { value: 'SBA-R-6301 1.12g — Ring' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirm order/i }));
    await screen.findByTestId('order-saved');
    const input = save.mock.calls[0]?.[0] as { items: Array<Record<string, unknown>> };
    expect(input.items[0]).toEqual({
      inventoryItemId: 'i1',
      unitPrice: '7000.00',
      quantity: 1,
      pricing: { mode: 'fixed' },
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
