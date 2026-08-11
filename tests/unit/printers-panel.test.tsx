import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PrintersPanel } from '@/components/printers/printers-panel';
import type { PrinterRow } from '@/lib/printers/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const registerMock = vi.fn(() => Promise.resolve({ ok: true as const }));
const updateMock = vi.fn((_id: string, _c: unknown) =>
  Promise.resolve({ ok: true as const }),
);
const deleteMock = vi.fn((_id: string) => Promise.resolve({ ok: true as const }));
vi.mock('@/lib/printers/actions', () => ({
  registerPrinterAction: (_input: unknown) => registerMock(),
  updatePrinterAction: (id: string, c: unknown) => updateMock(id, c),
  deletePrinterAction: (id: string) => deleteMock(id),
}));

const printer: PrinterRow = {
  id: 'p1',
  name: 'Counter XP-236B',
  target: '66:22:BC',
  transport: 'bluetooth',
  labelSize: '40x30',
  isActive: true,
  isDefault: false,
  lastSeenAt: null,
};

describe('PrintersPanel', () => {
  it('shows the queue snapshot and a registered printer', () => {
    render(
      <PrintersPanel
        printers={[printer]}
        queue={{ pending: 2, claimed: 1, failed: 0 }}
      />,
    );
    expect(screen.getByTestId('print-queue-status')).toHaveTextContent('Pending: 2');
    expect(screen.getByTestId('printer-row-p1')).toHaveTextContent('Counter XP-236B');
  });

  it('registers a printer once a name is entered', async () => {
    render(<PrintersPanel printers={[]} queue={{ pending: 0, claimed: 0, failed: 0 }} />);
    expect(screen.getByTestId('printer-register')).toBeDisabled();
    fireEvent.change(screen.getByTestId('printer-name-input'), {
      target: { value: 'Back office' },
    });
    expect(screen.getByTestId('printer-register')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('printer-register'));
    await waitFor(() => expect(registerMock).toHaveBeenCalled());
  });

  it('sets a printer as default and removes one', async () => {
    render(
      <PrintersPanel
        printers={[printer]}
        queue={{ pending: 0, claimed: 0, failed: 0 }}
      />,
    );
    fireEvent.click(screen.getByTestId('printer-default-p1'));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith('p1', { makeDefault: true }),
    );
    fireEvent.click(screen.getByTestId('printer-delete-p1'));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('p1'));
  });
});
