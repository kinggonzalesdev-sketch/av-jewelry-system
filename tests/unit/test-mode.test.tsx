import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestModeBanner } from '@/components/live/test-mode-banner';
import { TestModeControls } from '@/components/live/test-mode-controls';

vi.mock('@/lib/live/live-ops-actions', () => ({
  setTestModeAction: vi.fn((active: boolean) => Promise.resolve({ ok: true, active })),
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
      <TestModeControls initial={{ active: false, startedAt: null, startedByName: null }} />,
    );
    expect(screen.getByTestId('test-mode-status')).toHaveTextContent(/production/i);

    fireEvent.click(screen.getByTestId('start-test-session'));

    expect(await screen.findByTestId('end-test-session')).toBeInTheDocument();
    expect(screen.getByTestId('test-mode-status')).toHaveTextContent(/active/i);
  });

  it('ends an active test session', async () => {
    render(
      <TestModeControls initial={{ active: true, startedAt: null, startedByName: 'X' }} />,
    );
    fireEvent.click(screen.getByTestId('end-test-session'));
    expect(await screen.findByTestId('start-test-session')).toBeInTheDocument();
  });
});
