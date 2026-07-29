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

function totals() {
  return screen.getByTestId('layaway-totals');
}

describe('Layaway New Entry — the form', () => {
  it('offers every required field', () => {
    open();
    expect(screen.getByTestId('layaway-code')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-grams')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-interest')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-date')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-mop')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-no-interest')).toBeInTheDocument();
    expect(screen.getByTestId('layaway-save')).toBeInTheDocument();
    // Admin Name shows the signed-in account, read-only for a non-Super-Admin.
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

describe('Layaway New Entry — per-gram interest (Grams × ₱150)', () => {
  // The fixture item is 2g, so monthly interest = 2 × 150 = ₱300.
  function priceIt() {
    open();
    fireEvent.change(screen.getByPlaceholderText(/search active inventory/i), {
      target: { value: 'SBA-R-2276 · Ring' },
    });
    fireEvent.change(screen.getByTestId('layaway-price'), {
      target: { value: '30000' },
    });
  }

  it('charges MONTH 1 ONLY in the grand total, whatever the term', () => {
    priceIt();
    fireEvent.click(screen.getByTestId('layaway-term-3'));

    // Monthly interest = 2g × ₱150 = ₱300; the field shows it.
    expect(screen.getByTestId<HTMLInputElement>('layaway-interest')).toHaveValue('₱300');
    // Grand Total = item 30,000 + month 1 (300) = 30,300 — NOT all three months.
    expect(within(totals()).getAllByText('₱30,300').length).toBeGreaterThanOrEqual(1);
    // The whole term's interest (₱900) is never added to the current total.
    expect(within(totals()).queryByText('₱30,900')).not.toBeInTheDocument();
    // Two more months could still be charged later.
    expect(totals()).toHaveTextContent('Remaining possible months');
    expect(within(totals()).getByText('2')).toBeInTheDocument();
  });

  it('No Interest pins monthly interest to ₱0 and Grand Total = item amount', () => {
    priceIt();
    fireEvent.click(screen.getByTestId('layaway-no-interest'));

    const interest = screen.getByTestId<HTMLInputElement>('layaway-interest');
    expect(interest).toHaveValue('0% Interest');
    expect(interest).toHaveAttribute('readonly');

    // Grand Total EQUALS the item amount.
    expect(within(totals()).getAllByText('₱30,000').length).toBeGreaterThanOrEqual(2);
  });

  it('No Interest STAYS on until changed, and keeps all three terms available', () => {
    priceIt();
    fireEvent.click(screen.getByTestId('layaway-no-interest'));
    const btn = screen.getByTestId('layaway-no-interest');
    expect(btn).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('layaway-term-1'));
    expect(screen.getByTestId('layaway-no-interest')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(btn);
    expect(screen.getByTestId('layaway-no-interest')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
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
    expect(screen.getByTestId('layaway-code-note')).toHaveTextContent(
      /assigned automatically/i,
    );
  });

  it('has NO manual letter selector or code dropdown', () => {
    open();
    expect(screen.queryByTestId('layaway-letter')).not.toBeInTheDocument();
    // The only "layaway-code" element is the read-only input, never a <select>.
    expect(screen.getByTestId('layaway-code').tagName).toBe('INPUT');
  });
});

describe('Layaway New Entry — validation', () => {
  it('refuses a save with no customer', () => {
    open();
    fireEvent.click(screen.getByTestId('layaway-save'));
    expect(screen.getByTestId('layaway-error')).toHaveTextContent(
      /enter the customer name/i,
    );
  });

  it('refuses a payment larger than the grand total', () => {
    open();
    fireEvent.change(screen.getByPlaceholderText(/select a customer/i), {
      target: { value: 'Maria Santos' },
    });
    fireEvent.change(screen.getByPlaceholderText(/search active inventory/i), {
      target: { value: 'SBA-R-2276 · Ring' },
    });
    fireEvent.change(screen.getByTestId('layaway-price'), { target: { value: '10000' } });
    fireEvent.click(screen.getByTestId('layaway-no-interest'));
    fireEvent.change(screen.getByTestId('layaway-payment'), { target: { value: '99999' } });
    fireEvent.click(screen.getByTestId('layaway-save'));
    expect(screen.getByTestId('layaway-error')).toHaveTextContent(
      /exceeds the remaining balance/i,
    );
  });
});
