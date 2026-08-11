import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestModeBanner } from '@/components/live/test-mode-banner';
import { TestModeControls } from '@/components/live/test-mode-controls';

vi.mock('@/lib/live/live-ops-actions', () => ({
  setTestModeAction: vi.fn((active: boolean) => Promise.resolve({ ok: true, active })),
  resetTestDataAction: vi.fn(() =>
    Promise.resolve({ ok: true, counts: { orders: 2, payments: 1 } }),
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe('TestModeBanner', () => {
  it('names who started the session', () => {
    render(<TestModeBanner startedByName="King Gonzales" />);
    const banner = screen.getByTestId('test-mode-banner');
    expect(banner).toHaveTextContent(/test mode/i);
    expect(banner).toHaveTextContent(/started by King Gonzales/i);
  });
});

describe('TestModeControls', () => {
  it('starts a test session, then offers End', async () => {
    render(
      <TestModeControls
        initial={{ active: false, startedAt: null, startedByName: null }}
      />,
    );
    expect(screen.getByTestId('test-mode-status')).toHaveTextContent(/production/i);

    fireEvent.click(screen.getByTestId('start-test-session'));

    expect(await screen.findByTestId('end-test-session')).toBeInTheDocument();
    expect(screen.getByTestId('test-mode-status')).toHaveTextContent(/active/i);
  });

  it('ends an active test session', async () => {
    render(
      <TestModeControls
        initial={{ active: true, startedAt: null, startedByName: 'X' }}
      />,
    );
    fireEvent.click(screen.getByTestId('end-test-session'));
    expect(await screen.findByTestId('start-test-session')).toBeInTheDocument();
  });

  it('reset requires typing DELETE, then reports the deleted counts', async () => {
    render(
      <TestModeControls
        initial={{ active: false, startedAt: null, startedByName: null }}
      />,
    );
    fireEvent.click(screen.getByTestId('reset-test-data'));
    // Confirm is disabled until DELETE is typed.
    expect(screen.getByTestId('reset-test-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('reset-test-confirm-input'), {
      target: { value: 'DELETE' },
    });
    expect(screen.getByTestId('reset-test-confirm')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('reset-test-confirm'));
    expect(await screen.findByTestId('reset-result')).toHaveTextContent(/2 order/i);
  });
});
