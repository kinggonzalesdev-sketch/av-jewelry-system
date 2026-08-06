import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SystemCheckPanel } from '@/components/live/system-check-panel';

vi.mock('@/lib/live/live-ops-actions', () => ({
  runSystemCheckAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      items: [
        { key: 'database', label: 'Supabase Database', status: 'ready', detail: 'Connected.' },
        { key: 'pancake', label: 'Pancake Connection', status: 'failed', detail: 'Down.' },
      ],
    }),
  ),
}));

// The Realtime check reads the shared socket state; stub it as connected → Ready.
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    realtime: { isConnected: () => true, connect: () => {} },
    removeChannel: () => Promise.resolve('ok'),
  }),
}));

describe('SystemCheckPanel', () => {
  it('runs the check and merges server + client results', async () => {
    render(<SystemCheckPanel />);
    expect(screen.getByTestId('run-system-check')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('run-system-check'));

    // Server items.
    expect(await screen.findByTestId('system-check-database')).toBeInTheDocument();
    // Client-only items are merged in.
    expect(screen.getByTestId('system-check-internet')).toBeInTheDocument();
    expect(screen.getByTestId('system-check-realtime')).toBeInTheDocument();
  });

  it('warns not to start Automatic Mode when a check has Failed', async () => {
    render(<SystemCheckPanel />);
    fireEvent.click(screen.getByTestId('run-system-check'));
    expect(await screen.findByTestId('system-check-blocker')).toHaveTextContent(
      /do not start Automatic Mode/i,
    );
  });
});
