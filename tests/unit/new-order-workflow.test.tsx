import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import type { CaptureItem } from '@/lib/orders/service';

// The capture action is transport (tested via the live/capture suites); the photo
// control is exercised by its own tests. Stub both so this focuses on the
// workflow + form structure.
vi.mock('@/lib/live/actions', () => ({ captureClaimAction: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/attachments/photo-capture', () => ({
  PhotoCapture: () => <div data-testid="photo-capture-stub" />,
}));

const customers = [
  { id: 'c1', displayName: 'Ana Cruz' },
  { id: 'c2', displayName: 'Ben Santos' },
];
const items: CaptureItem[] = [
  {
    id: 'i1',
    itemCode: 'UAT-M01',
    itemName: 'Bangle',
    unitPrice: '8000.00',
    availabilityStatus: 'available',
  },
];

function renderWorkflow(canCreate = true) {
  return render(
    <NewOrderWorkflow
      customers={customers}
      items={items}
      canCreate={canCreate}
      shopName="A.V. Jewelry"
      salesperson="UAT Owner"
    />,
  );
}

describe('NewOrderWorkflow — the New Order control', () => {
  it('renders only New Order (the Invoice/Confirm/Layaway shortcuts were removed)', () => {
    renderWorkflow();
    expect(screen.getByTestId('orders-new-order')).toBeInTheDocument();
    // The removed shortcut buttons must not reappear — the sidebar owns that nav.
    expect(screen.queryByRole('button', { name: 'Invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Layaway' })).not.toBeInTheDocument();
  });

  it('disables New Order without the capture permission', () => {
    renderWorkflow(false);
    expect(screen.getByTestId('orders-new-order')).toBeDisabled();
  });
});

describe('NewOrderWorkflow — the New Order form', () => {
  it('opens the approved form with real customers and items', () => {
    renderWorkflow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('orders-new-order'));

    const dialog = screen.getByRole('dialog', { name: /new order/i });
    expect(dialog).toBeInTheDocument();
    // Session identity, read-only.
    expect(screen.getByDisplayValue('A.V. Jewelry')).toBeInTheDocument();
    expect(screen.getByDisplayValue('UAT Owner')).toBeInTheDocument();
    // Real customer + item options, and the honest capture note + Confirm.
    expect(screen.getByRole('option', { name: 'Ana Cruz' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /UAT-M01 — Bangle/ })).toBeInTheDocument();
    expect(screen.getByText(/Pending Claim only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reprint last/i })).toBeInTheDocument();
  });

  it('closes the form on Close', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('orders-new-order'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
