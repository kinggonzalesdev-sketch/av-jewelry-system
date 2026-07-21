import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ItemCustodyEditor } from '@/components/inventory/item-custody-editor';

vi.mock('@/lib/inventory/actions', () => ({ updateItemCustodyAction: vi.fn() }));

describe('ItemCustodyEditor', () => {
  it('shows On-hand vs Financer and the location, read-only without permission', () => {
    render(
      <ItemCustodyEditor
        inventoryItemId="i1"
        custodyHolder="financer"
        storageLocation="Vault A"
        handlerName="Ana"
        canEdit={false}
      />,
    );
    expect(screen.getByText('Financer')).toBeInTheDocument();
    expect(screen.getByText(/Vault A/)).toBeInTheDocument();
    expect(screen.getByText(/Held by Ana/)).toBeInTheDocument();
    // No edit affordance without permission.
    expect(screen.queryByTestId('custody-edit-i1')).not.toBeInTheDocument();
  });

  it('shows "No location set" honestly when none is recorded', () => {
    render(
      <ItemCustodyEditor
        inventoryItemId="i2"
        custodyHolder="av_jewelry"
        storageLocation={null}
        handlerName={null}
        canEdit={false}
      />,
    );
    expect(screen.getByText('On-hand')).toBeInTheDocument();
    expect(screen.getByText(/No location set/)).toBeInTheDocument();
  });

  it('opens an editor with holder + location when permitted', () => {
    render(
      <ItemCustodyEditor
        inventoryItemId="i3"
        custodyHolder="av_jewelry"
        storageLocation={null}
        handlerName={null}
        canEdit
      />,
    );
    fireEvent.click(screen.getByTestId('custody-edit-i3'));

    const form = screen.getByTestId('custody-form');
    expect(form).toBeInTheDocument();
    expect(screen.getByLabelText('Custody holder')).toBeInTheDocument();
    expect(screen.getByLabelText('Storage location')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });
});
