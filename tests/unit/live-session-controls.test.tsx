import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LiveSessionControls } from '@/components/live/live-session-controls';
import type { LiveSessionFormData } from '@/lib/live/live-session-types';

const startAction = vi.fn(() => Promise.resolve({ ok: true, session: null }));
vi.mock('@/lib/live/live-ops-actions', () => ({
  startLiveSessionAction: (...a: unknown[]) => startAction(...a),
  endLiveSessionAction: vi.fn(() => Promise.resolve({ ok: true, session: null })),
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
          },
        }}
      />,
    );
    const panel = screen.getByTestId('live-session-active');
    expect(panel).toHaveTextContent(/Friday Night Live/);
    expect(panel).toHaveTextContent(/TEST/);
    expect(screen.getByTestId('end-live-session')).toBeInTheDocument();
  });
});
