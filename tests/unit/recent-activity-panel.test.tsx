import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RecentActivityPanel } from '@/components/live/recent-activity-panel';
import type { ActivityRow } from '@/lib/live/activity-types';

const listMock = vi.fn<() => Promise<ActivityRow[]>>();
vi.mock('@/lib/live/live-ops-actions', () => ({
  listRecentActivityAction: () => listMock(),
}));

describe('RecentActivityPanel', () => {
  it('shows the empty state when there is no activity (once expanded)', async () => {
    listMock.mockResolvedValueOnce([]);
    render(<RecentActivityPanel />);
    // Collapsed by default — expand to load + show the log.
    fireEvent.click(screen.getByTestId('recent-activity-toggle'));
    expect(await screen.findByTestId('recent-activity-empty')).toBeInTheDocument();
  });

  it('renders a humanised activity row with its actor and outcome', async () => {
    listMock.mockResolvedValueOnce([
      {
        id: 'a1',
        occurredAt: '2026-08-05T10:00:00Z',
        actorLabel: 'King Gonzales',
        action: 'layaway_ledger.add_payment',
        entityType: 'layaway_ledger',
        outcome: 'success',
        reason: null,
      },
    ]);
    render(<RecentActivityPanel />);
    fireEvent.click(screen.getByTestId('recent-activity-toggle'));
    const panel = await screen.findByTestId('recent-activity-panel');
    expect(await screen.findByText('Layaway Ledger Add Payment')).toBeInTheDocument();
    expect(panel).toHaveTextContent('Layaway Ledger Add Payment');
    expect(panel).toHaveTextContent('King Gonzales');
    expect(panel).toHaveTextContent('success');
  });
});
