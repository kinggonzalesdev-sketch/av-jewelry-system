import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LiveSessionControls } from '@/components/live/live-session-controls';
import type { LiveSessionFormData } from '@/lib/live/live-session-types';

const startAction = vi.fn((_input?: unknown) => Promise.resolve({ ok: true, session: null }));
const pauseAction = vi.fn((_paused?: boolean) => Promise.resolve({ ok: true, session: null }));
vi.mock('@/lib/live/live-ops-actions', () => ({
  startLiveSessionAction: (input: unknown) => startAction(input),
  endLiveSessionAction: vi.fn(() => Promise.resolve({ ok: true, session: null })),
  setLivePausedAction: (paused: boolean) => pauseAction(paused),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const base: LiveSessionFormData = {
  active: null,
  operators: [{ id: 's1', name: 'King Gonzales' }],
  facebookPageId: 'p1',
  facebookPageName: 'A.V. Jewelry',
};

describe('LiveSessionControls', () => {
  it('requires a name, then starts the session', () => {
    startAction.mockClear();
    render(<LiveSessionControls data={base} />);
    expect(screen.getByTestId('live-session-start')).toBeInTheDocument();
    expect(screen.getByTestId('start-live-session')).toBeDisabled();

    fireEvent.change(screen.getByTestId('live-session-name'), {
      target: { value: 'Friday Night Live' },
    });
    expect(screen.getByTestId('start-live-session')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('start-live-session'));
    expect(startAction).toHaveBeenCalledTimes(1);
  });

  it('shows the active session and an End control', () => {
    render(
      <LiveSessionControls
        data={{
          ...base,
          active: {
            id: 'x',
            name: 'Friday Night Live',
            operatorName: 'King Gonzales',
            mode: 'review',
            isTest: true,
            startedAt: null,
            paused: false,
          },
        }}
      />,
    );
    const panel = screen.getByTestId('live-session-active');
    expect(panel).toHaveTextContent(/Friday Night Live/);
    expect(panel).toHaveTextContent(/TEST/);
    expect(screen.getByTestId('end-live-session')).toBeInTheDocument();
  });

  it('offers Pause while running, and Resume with a banner while paused', () => {
    const activeBase = {
      id: 'x',
      name: 'Friday Night Live',
      operatorName: 'King Gonzales',
      mode: 'review' as const,
      isTest: true,
      startedAt: null,
    };

    const { rerender } = render(
      <LiveSessionControls data={{ ...base, active: { ...activeBase, paused: false } }} />,
    );
    // Running (not paused): a Pause button, no paused banner.
    expect(screen.getByTestId('pause-live-selling')).toBeInTheDocument();
    expect(screen.queryByTestId('live-session-paused')).not.toBeInTheDocument();
    pauseAction.mockClear();
    fireEvent.click(screen.getByTestId('pause-live-selling'));
    expect(pauseAction).toHaveBeenCalledWith(true);

    // Paused: a Resume button and the paused notice.
    rerender(
      <LiveSessionControls data={{ ...base, active: { ...activeBase, paused: true } }} />,
    );
    expect(screen.getByTestId('live-session-paused')).toBeInTheDocument();
    expect(screen.getByTestId('resume-live-selling')).toBeInTheDocument();
  });
});
