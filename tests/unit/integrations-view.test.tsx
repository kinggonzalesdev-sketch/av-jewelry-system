import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IntegrationsView } from '@/components/integrations/integrations-view';

vi.mock('@/lib/integrations/actions', () => ({
  saveSelectedPageAction: vi.fn(),
  saveSelectedSenderAction: vi.fn(),
  sendPancakeTestAction: vi.fn(),
  syncPancakeConversationsAction: vi.fn(),
}));

describe('IntegrationsView', () => {
  it('offers Load Pancake Pages to the Primary Super Admin', () => {
    render(<IntegrationsView canManagePages />);
    expect(screen.getByTestId('pancake-load-pages')).toBeInTheDocument();
    expect(screen.getByText(/Managed Pages/i)).toBeInTheDocument();
  });

  it('shows the currently-saved Page when one is selected', () => {
    render(
      <IntegrationsView
        canManagePages
        selectedPage={{
          pageId: '588622885161430',
          pageName: 'A.V. Jewelry',
          platform: 'facebook',
          selectedByName: 'King Gonzales',
          selectedAt: null,
        }}
      />,
    );
    expect(screen.getByTestId('pancake-selected-page')).toHaveTextContent(
      '588622885161430',
    );
  });

  it('hides Page management from non-Primary-Super-Admins', () => {
    render(<IntegrationsView canManagePages={false} />);
    expect(screen.queryByTestId('pancake-load-pages')).not.toBeInTheDocument();
    expect(screen.getByText(/Primary Super Admin only/i)).toBeInTheDocument();
  });

  it('shows "Pancake Sender User Required" when no Private Reply sender is selected', () => {
    render(<IntegrationsView canManagePages />);
    expect(screen.getByTestId('pancake-load-users')).toBeInTheDocument();
    expect(screen.getByTestId('pancake-sender-required')).toBeInTheDocument();
    expect(screen.queryByTestId('pancake-selected-sender')).not.toBeInTheDocument();
  });

  it('shows the current Private Reply sender when one is selected', () => {
    render(
      <IntegrationsView
        canManagePages
        selectedSender={{ userId: 'pancake-user-123', userName: 'A.V. Live Agent' }}
      />,
    );
    const chip = screen.getByTestId('pancake-selected-sender');
    expect(chip).toHaveTextContent('pancake-user-123');
    expect(chip).toHaveTextContent('A.V. Live Agent');
    expect(screen.queryByTestId('pancake-sender-required')).not.toBeInTheDocument();
  });
});
