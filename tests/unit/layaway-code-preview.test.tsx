import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LayawayNewEntry } from '@/components/payments/layaway-new-entry';
import type { AdminNameContext } from '@/lib/authz/admin-name';

// The Assigned Layaway Code depends only on the customer's FIRST letter. The preview
// server action is a Supabase RPC round trip, so it must fire once per letter change,
// not once per keystroke.
const h = vi.hoisted(() => ({
  createLayawayAccountAction: vi.fn(),
  loadLayawayNewEntryDataAction: vi.fn(),
  previewLayawayCodeAction: vi.fn((name: string) => {
    const letter = (name ?? '').toUpperCase().match(/[A-Z]/)?.[0] ?? null;
    return Promise.resolve({ letter, code: letter ? `${letter}1` : null });
  }),
}));

vi.mock('@/lib/payments/actions', () => ({
  createLayawayAccountAction: h.createLayawayAccountAction,
  loadLayawayNewEntryDataAction: h.loadLayawayNewEntryDataAction,
  previewLayawayCodeAction: h.previewLayawayCodeAction,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const admins: AdminNameContext = {
  selfId: 'staff-1',
  selfName: 'King Gonzales',
  canChange: false,
  options: [{ id: 'staff-1', fullName: 'King Gonzales' }],
};

beforeEach(() => {
  h.previewLayawayCodeAction.mockClear();
  h.loadLayawayNewEntryDataAction.mockResolvedValue({
    items: [],
    customers: ['Maria Santos'],
    financers: [],
  });
});

async function open() {
  render(<LayawayNewEntry admins={admins} canCreate />);
  fireEvent.click(screen.getByTestId('layaway-new-entry'));
  await screen.findByTestId('layaway-save');
}

/** Type a name one keystroke at a time, as the operator would. */
function typeName(name: string) {
  const input = screen.getByPlaceholderText(/select a customer/i);
  for (let i = 1; i <= name.length; i++) {
    fireEvent.change(input, { target: { value: name.slice(0, i) } });
  }
}

describe('Layaway New Entry: code preview fires once per first-letter change', () => {
  it('typing an 11-character name makes ONE preview call (was 11)', async () => {
    await open();
    typeName('Abby Santos');

    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(1);
    // Sent with the name as typed when the letter first appeared.
    expect(h.previewLayawayCodeAction).toHaveBeenCalledWith('A');
    expect(await screen.findByDisplayValue('A1')).toHaveAttribute('readonly');
  });

  it('fires again only when the first letter changes', async () => {
    await open();
    typeName('Abby');
    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(1);

    const input = screen.getByPlaceholderText(/select a customer/i);
    // A different first letter → one more call, and the code follows it.
    fireEvent.change(input, { target: { value: 'Bea' } });
    fireEvent.change(input, { target: { value: 'Bea Cruz' } });
    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(2);
    expect(h.previewLayawayCodeAction).toHaveBeenLastCalledWith('Bea');
    expect(await screen.findByDisplayValue('B1')).toBeInTheDocument();

    // Leading spaces/digits don't change the letter → no call.
    fireEvent.change(input, { target: { value: '  Bea Cruz' } });
    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(2);

    // Cleared (no letter) → no call; a new letter afterwards → one call.
    fireEvent.change(input, { target: { value: '' } });
    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(2);
    typeName('Carlo');
    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(3);
    expect(await screen.findByDisplayValue('C1')).toBeInTheDocument();
  });

  it('picking a customer from the list is a single call', async () => {
    await open();
    fireEvent.change(screen.getByPlaceholderText(/select a customer/i), {
      target: { value: 'Maria Santos' },
    });
    expect(h.previewLayawayCodeAction).toHaveBeenCalledTimes(1);
    expect(h.previewLayawayCodeAction).toHaveBeenCalledWith('Maria Santos');
    expect(await screen.findByDisplayValue('M1')).toBeInTheDocument();
  });
});
