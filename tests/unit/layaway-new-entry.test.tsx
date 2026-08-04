import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LayawayNewEntry } from '@/components/payments/layaway-new-entry';
import type { CaptureItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';

// Server actions are transport (covered by the domain + SQL rollback probes);
// stub them so this focuses on the form's structure and its money rules.
vi.mock('@/lib/payments/actions', () => ({
  createLayawayAccountAction: vi.fn(),
  // The code preview is derived from the customer's first letter, server-side.
  previewLayawayCodeAction: vi.fn((name: string) => {
    const letter = (name ?? '').toUpperCase().match(/[A-Z]/)?.[0] ?? null;
    return Promise.resolve({ letter, code: letter ? `${letter}1` : null });
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const items: CaptureItem[] = [
  {
    id: 'i1',
    itemCode: 'SBA-R-2276',
    itemName: 'Ring',
    unitPrice: '30000.00',
    gramsPerPiece: '2',
    availabilityStatus: 'available',
  },
  {
    id: 'i2',
    itemCode: 'SBA-B-1000',
    itemName: 'Bangle',
    unitPrice: '5000.00',
    gramsPerPiece: '1',
    availabilityStatus: 'available',
  },
];

const admins: AdminNameContext = {
  selfId: 'staff-1',
  selfName: 'King Gonzales',
  canChange: false,
  options: [{ id: 'staff-1', fullName: 'King Gonzales' }],
};

function open() {
  render(
    <LayawayNewEntry
      items={items}
      customers={['Maria Santos']}
      financers={['Lalyn']}
      admins={admins}
      canCreate
    />,
  );
  fireEvent.click(screen.getByTestId('layaway-new-entry'));
}

const totals = () => screen.getByTestId('layaway-totals');

/** Fill the FIRST item row (Ring, 2g) at a fixed price. */
function priceFirstItem(price = '30000') {
  open();
  fireEvent.change(screen.getAllByPlaceholderText(/search active inventory/i)[0]!, {
    target: { value: 'SBA-R-2276 · Ring' },
  });
  fireEvent.change(screen.getAllByTestId('layaway-item-price')[0]!, {
    target: { value: price },
  });
}

describe('Layaway New Entry — the form', () => {
  it('offers every required field', () => {
    open();
    for (const id of [
      'layaway-code',
      'layaway-interest',
      'layaway-date',
      'layaway-payment',
      'layaway-payment-date',
      'layaway-mop',
      'layaway-no-interest',
      'layaway-save',
      'layaway-add-item',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    expect(screen.getByTestId('admin-name')).toHaveValue('King Gonzales');
  });

  it('has NO photo or file controls (Owner request)', () => {
    open();
    expect(screen.queryByText(/take photo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/choose file/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('offers 1, 2 and 3-month terms', () => {
    open();
    for (const t of [1, 2, 3]) {
      expect(screen.getByTestId(`layaway-term-${t}`)).toBeInTheDocument();
    }
  });
});

describe('Layaway New Entry — interest reflects the FULL term', () => {
  // The fixture item is 2g, so monthly interest = 2 × ₱150 = ₱300.
  it('term 3 → interest = monthly × 3 in the grand total', () => {
    priceFirstItem('30000');
    fireEvent.click(screen.getByTestId('layaway-term-3'));

    expect(screen.getByTestId<HTMLInputElement>('layaway-interest')).toHaveValue('₱300');
    // Grand Total = 30,000 + (300 × 3 = 900) = ₱30,900.
    expect(within(totals()).getAllByText('₱30,900').length).toBeGreaterThanOrEqual(1);
    // The old "Month 1 only" total and the removed rows are gone.
    expect(within(totals()).queryByText('₱30,300')).not.toBeInTheDocument();
    expect(totals()).not.toHaveTextContent(/Remaining possible months/i);
    expect(totals()).not.toHaveTextContent(/Month 1/i);
    // The whole term's interest is shown.
    expect(totals()).toHaveTextContent(/Total interest \(3 mos\)/i);
    expect(within(totals()).getByText('₱900')).toBeInTheDocument();
  });

  it('term 1 → a single month of interest', () => {
    priceFirstItem('30000');
    fireEvent.click(screen.getByTestId('layaway-term-1'));
    // Grand Total = 30,000 + 300 = ₱30,300.
    expect(within(totals()).getAllByText('₱30,300').length).toBeGreaterThanOrEqual(1);
  });

  it('No Interest pins interest to ₱0 and Grand Total = item amount', () => {
    priceFirstItem('30000');
    fireEvent.click(screen.getByTestId('layaway-no-interest'));
    const interest = screen.getByTestId<HTMLInputElement>('layaway-interest');
    expect(interest).toHaveValue('0% Interest');
    expect(within(totals()).getAllByText('₱30,000').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Layaway New Entry — multiple items', () => {
  it('adds a second item and sums the item amounts', () => {
    priceFirstItem('30000'); // Ring
    fireEvent.click(screen.getByTestId('layaway-add-item'));

    const combos = screen.getAllByPlaceholderText(/search active inventory/i);
    expect(combos.length).toBe(2);
    fireEvent.change(combos[1]!, { target: { value: 'SBA-B-1000 · Bangle' } });
    fireEvent.change(screen.getAllByTestId('layaway-item-price')[1]!, {
      target: { value: '5000' },
    });
    // Isolate the item-amount sum from interest.
    fireEvent.click(screen.getByTestId('layaway-no-interest'));

    // Item amount total = 30,000 + 5,000 = ₱35,000 (also the grand total, no interest).
    expect(within(totals()).getAllByText('₱35,000').length).toBeGreaterThanOrEqual(2);
  });
});

describe('Layaway New Entry — automatic code', () => {
  it('shows a read-only Assigned Layaway Code derived from the customer name', async () => {
    open();
    fireEvent.change(screen.getByPlaceholderText(/select a customer/i), {
      target: { value: 'Abby Santos' },
    });
    const code = await screen.findByTestId<HTMLInputElement>('layaway-code');
    expect(code).toHaveValue('A1');
    expect(code).toHaveAttribute('readonly');
    expect(screen.getByTestId('layaway-code-note')).toHaveTextContent(/assigned automatically/i);
  });
});

describe('Layaway New Entry — validation', () => {
  it('refuses a save with no customer', () => {
    open();
    fireEvent.click(screen.getByTestId('layaway-save'));
    expect(screen.getByTestId('layaway-error')).toHaveTextContent(/enter the customer name/i);
  });

  it('refuses a payment larger than the grand total', () => {
    priceFirstItem('10000');
    fireEvent.change(screen.getByPlaceholderText(/select a customer/i), {
      target: { value: 'Maria Santos' },
    });
    fireEvent.click(screen.getByTestId('layaway-no-interest'));
    fireEvent.change(screen.getByTestId('layaway-payment'), { target: { value: '99999' } });
    fireEvent.click(screen.getByTestId('layaway-save'));
    expect(screen.getByTestId('layaway-error')).toHaveTextContent(/exceeds the remaining balance/i);
  });
});
