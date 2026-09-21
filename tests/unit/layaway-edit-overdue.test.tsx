import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LedgerEditAccount } from '@/components/payments/layaway-ledger-actions';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  load: vi.fn(),
  update: vi.fn(),
  transfer: vi.fn(),
  overdue: vi.fn(),
  forfeit: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/lib/payments/actions', () => ({
  addLayawayLedgerPaymentAction: vi.fn(),
  addLayawayPaymentAndTransferAction: vi.fn(),
  cancelLayawayLedgerAction: vi.fn(),
  forfeitLayawayLedgerAction: vi.fn(),
  loadLayawayLedgerDetailAction: mocks.load,
  transferLayawayToDestinationAction: mocks.transfer,
  updateLayawayLedgerAccountAction: mocks.update,
  updateLayawayLedgerAndForfeitAction: mocks.forfeit,
  updateLayawayLedgerAndTransferOverdueAction: mocks.overdue,
}));

const detail = {
  customerName: 'ERICKA DE DIOS',
  remarks: 'OK',
  datePurchased: '2026-06-01',
  itemAmount: '7000.00',
  interest: '450.00',
  nextDueDate: '2026-09-01',
  notes: 'Original note',
};

async function openEdit({ canForfeit = false } = {}) {
  render(
    <LedgerEditAccount
      id="ledger-1"
      accountNo="LAY-2026-005635"
      canTransfer
      canForfeit={canForfeit}
    />,
  );
  fireEvent.click(screen.getByTestId('ledger-edit-ledger-1'));
  return screen.findByLabelText('Transfer to Destination');
}

describe('Edit Layaway — manual Overdue destination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.load.mockResolvedValue(detail);
    mocks.update.mockResolvedValue({
      ok: true,
      grandTotal: '7450.00',
      balance: '7450.00',
      status: 'active',
    });
    mocks.transfer.mockResolvedValue({ ok: true });
    mocks.overdue.mockResolvedValue({
      ok: true,
      changed: true,
      releasedItems: 1,
      itemUniqueCodes: ['SAMPLE CODE-SC-01 1.0g'],
      grandTotal: '7450.00',
      balance: '7450.00',
      layawayCode: 'E34',
      layawayCodeReleased: true,
      status: 'overdue',
    });
    mocks.forfeit.mockResolvedValue({
      ok: true,
      changed: true,
      releasedItems: 1,
      layawayCode: 'E34',
    });
  });

  it.each([360, 390, 430])(
    'keeps the destination usable in the mobile-width modal at %ipx',
    async (width) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      const destination = await openEdit();

      expect(within(destination).getByRole('option', { name: 'Overdue' })).toHaveValue(
        'overdue',
      );
      expect(screen.getByTestId('modal')).toHaveClass('w-full');

      fireEvent.change(destination, { target: { value: 'overdue' } });
      expect(screen.getByRole('button', { name: 'Save and Transfer' })).toBeEnabled();
    },
  );

  it('shows the MineFlow confirmation and submits the single atomic action once', async () => {
    let finish: ((value: Awaited<ReturnType<typeof mocks.overdue>>) => void) | undefined;
    mocks.overdue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const destination = await openEdit();
    fireEvent.change(destination, { target: { value: 'overdue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and Transfer' }));

    expect(
      screen.getByRole('heading', { name: 'Transfer this Layaway to Overdue?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The Layaway will move to the Overdue list and the linked item(s) will return to Available Inventory.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Payment history will be preserved.')).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Confirm Transfer' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mocks.overdue).toHaveBeenCalledTimes(1);
    expect(mocks.overdue).toHaveBeenCalledWith({
      id: 'ledger-1',
      customerName: 'ERICKA DE DIOS',
      remarks: 'OK',
      datePurchased: '2026-06-01',
      itemAmount: '7000.00',
      interest: '450.00',
      nextDueDate: '2026-09-01',
      notes: 'Original note',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.transfer).not.toHaveBeenCalled();

    finish?.({
      ok: true,
      changed: true,
      releasedItems: 1,
      itemUniqueCodes: ['SAMPLE CODE-SC-01 1.0g'],
      grandTotal: '7450.00',
      balance: '7450.00',
      layawayCode: 'E34',
      layawayCodeReleased: true,
      status: 'overdue',
    });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
  });

  it('keeps the Overdue destination hidden without the existing transfer permission', async () => {
    render(
      <LedgerEditAccount id="ledger-1" accountNo="LAY-2026-005635" canTransfer={false} />,
    );
    fireEvent.click(screen.getByTestId('ledger-edit-ledger-1'));
    await screen.findByDisplayValue('ERICKA DE DIOS');

    expect(screen.queryByLabelText('Transfer to Destination')).not.toBeInTheDocument();
  });

  it('lets the Owner save edits and forfeit through one atomic action', async () => {
    const destination = await openEdit({ canForfeit: true });
    expect(within(destination).getByRole('option', { name: 'FORFEITED' })).toHaveValue(
      'forfeited',
    );

    fireEvent.change(destination, { target: { value: 'forfeited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and Transfer' }));

    expect(
      screen.getByRole('heading', { name: 'Mark this layaway as FORFEITED?' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Forfeiture' }));

    await waitFor(() => expect(mocks.forfeit).toHaveBeenCalledTimes(1));
    expect(mocks.forfeit).toHaveBeenCalledWith({
      id: 'ledger-1',
      customerName: 'ERICKA DE DIOS',
      remarks: 'OK',
      datePurchased: '2026-06-01',
      itemAmount: '7000.00',
      interest: '450.00',
      nextDueDate: '2026-09-01',
      notes: 'Original note',
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.overdue).not.toHaveBeenCalled();
    expect(mocks.transfer).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('does not expose FORFEITED to a user without Owner authority', async () => {
    const destination = await openEdit();
    expect(
      within(destination).queryByRole('option', { name: 'FORFEITED' }),
    ).not.toBeInTheDocument();
  });
});
