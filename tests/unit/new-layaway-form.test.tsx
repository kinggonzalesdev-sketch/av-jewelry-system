import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewLayawayForm } from '@/components/payments/new-layaway-form';
import type { PayableOrderRow } from '@/lib/payments/workspace';

vi.mock('@/lib/payments/actions', () => ({ activateLayawayAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const orders = [
  {
    officialOrderId: 'o1',
    orderNumber: 'ORD-1',
    invoiceNumber: 'INV-1',
    customerDisplayName: 'Ana Cruz',
    status: 'invoiced',
    totalAmountPayable: '10000.00',
    verifiedNetPayments: '2000.00',
    outstandingBalance: '8000.00',
  } as PayableOrderRow,
];

const verifiedPayments = [
  { paymentId: 'p1', orderNumber: 'ORD-1', verifiedAmount: '2000.00' },
  { paymentId: 'p2', orderNumber: 'ORD-9', verifiedAmount: '500.00' },
];

describe('NewLayawayForm', () => {
  it('is collapsed to a New Layaway Entry action by default', () => {
    render(<NewLayawayForm payableOrders={orders} verifiedPayments={verifiedPayments} />);
    expect(screen.getByTestId('new-layaway-entry')).toBeInTheDocument();
    expect(screen.queryByText(/Activate Layaway/i)).not.toBeInTheDocument();
  });

  it('opens the activation form with order, deposit, months, and due date', () => {
    render(<NewLayawayForm payableOrders={orders} verifiedPayments={verifiedPayments} />);
    fireEvent.click(screen.getByTestId('new-layaway-entry'));

    expect(screen.getByRole('option', { name: /ORD-1/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Months/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Final due date/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Activate Layaway/i })).toBeInTheDocument();
    // The honest 20%-verified rule is stated.
    expect(screen.getByText(/at least 20%/i)).toBeInTheDocument();
  });

  it('offers only the SELECTED order’s verified deposits', () => {
    render(<NewLayawayForm payableOrders={orders} verifiedPayments={verifiedPayments} />);
    fireEvent.click(screen.getByTestId('new-layaway-entry'));

    const orderSelect = screen.getByLabelText('Official Order');
    fireEvent.change(orderSelect, { target: { value: 'o1' } });

    const deposit = screen.getByLabelText(/Verified deposit/i);
    // p1 belongs to ORD-1 (the selected order); p2 (ORD-9) must not appear.
    expect(within(deposit).getByRole('option', { name: /p1/ })).toBeInTheDocument();
    expect(within(deposit).queryByRole('option', { name: /p2/ })).not.toBeInTheDocument();
  });
});
