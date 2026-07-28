import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntegrationsView } from '@/components/integrations/integrations-view';

vi.mock('@/lib/integrations/actions', () => ({
  testPancakeAction: vi.fn(),
  syncPancakeAction: vi.fn(),
}));

describe('IntegrationsView', () => {
  it('shows Pancake as Not Connected when not configured — never a fake connected', () => {
    render(
      <IntegrationsView
        pancake={{ state: 'not_configured', detail: 'API access is not configured.' }}
        canTest
      />,
    );
    expect(screen.getByTestId('pancake-status')).toHaveTextContent('Not Connected');
    expect(screen.getByText(/To enable Pancake sync/i)).toBeInTheDocument();
    // The Owner can test the connection.
    expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
  });

  it('hides the test button from non-Owners', () => {
    render(
      <IntegrationsView
        pancake={{ state: 'configured_unverified', detail: 'Set but unverified.' }}
        canTest={false}
      />,
    );
    expect(screen.getByTestId('pancake-status')).toHaveTextContent(
      'Configured — Unverified',
    );
    expect(
      screen.queryByRole('button', { name: /test connection/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Only the Owner can test/i)).toBeInTheDocument();
  });
});
