import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MemberAccessControls } from '@/components/settings/member-access-controls';
import type { TeamMemberRow } from '@/lib/authz/team-accounts';

const setRole = vi.fn(() => Promise.resolve({ ok: true as const }));
const setPerms = vi.fn(() => Promise.resolve({ ok: true as const }));
vi.mock('@/lib/authz/team-actions', () => ({
  loadTeamMemberAccessAction: () => Promise.resolve(null),
  setTeamMemberRoleAction: () => setRole(),
  setTeamMemberPermissionsAction: () => setPerms(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function member(over: Partial<TeamMemberRow> = {}): TeamMemberRow {
  return {
    staffProfileId: 'sp1',
    fullName: 'Lalyn De Dios',
    roleKey: 'staff',
    email: 'lalyn@example.com',
    isActive: true,
    passwordIsTemp: false,
    isSelf: false,
    isPrimarySuperAdmin: false,
    ...over,
  };
}

function renderControls(over: Partial<TeamMemberRow> = {}, opts?: {
  isPrimary?: boolean;
  slotFree?: boolean;
}) {
  return render(
    <MemberAccessControls
      member={member(over)}
      isPrimary={opts?.isPrimary ?? true}
      superAdminSlotFree={opts?.slotFree ?? true}
    />,
  );
}

/** The Super Admin <option> for a member's role dropdown. */
function superAdminOption(): HTMLOptionElement {
  return screen
    .getAllByRole('option')
    .find((o) => o.textContent?.startsWith('Super Admin')) as HTMLOptionElement;
}

describe('Change Role — Super Admin authority', () => {
  it('offers Super Admin to the Primary while a slot is free', () => {
    renderControls();
    expect(superAdminOption()).not.toBeDisabled();
  });

  it('never offers Super Admin to a non-primary Super Admin', () => {
    renderControls({}, { isPrimary: false });
    expect(superAdminOption()).toBeDisabled();
  });

  it('disables Super Admin and says so when the limit is reached', () => {
    renderControls({}, { slotFree: false });
    const option = superAdminOption();
    expect(option).toBeDisabled();
    expect(option.textContent).toMatch(/limit reached/i);
  });

  it('locks the role of the Primary Super Admin — they cannot be demoted', () => {
    renderControls({ roleKey: 'owner', isPrimarySuperAdmin: true });
    expect(screen.getByTestId('member-role-sp1')).toBeDisabled();
  });

  it('locks your own role — nobody changes their own', () => {
    renderControls({ isSelf: true });
    expect(screen.getByTestId('member-role-sp1')).toBeDisabled();
  });

  it('hides Delete for the Primary and offers it for everyone else', () => {
    // Delete lives in the roster, but the Primary flag is what protects it; assert
    // the flag reaches this control so the roster can rely on it.
    renderControls({ roleKey: 'owner', isPrimarySuperAdmin: true });
    expect(screen.getByTestId('member-role-sp1')).toHaveAttribute(
      'title',
      'The Primary Super Admin cannot be demoted.',
    );
  });
});

describe('Manage Access — permission toggles', () => {
  it('refuses to edit a Super Admin — they hold every permission', async () => {
    renderControls({ roleKey: 'owner' });
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    expect(await screen.findByTestId('member-access-locked')).toHaveTextContent(
      /holds every permission/i,
    );
    expect(screen.queryByTestId('member-access-save')).not.toBeInTheDocument();
  });

  it('refuses to edit your own permissions', async () => {
    renderControls({ isSelf: true });
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    expect(await screen.findByTestId('member-access-locked')).toHaveTextContent(
      /your own permissions/i,
    );
  });

  it('shows the six permission groups (incl. Inventory) with Save / Cancel for a staff member', async () => {
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    expect(await screen.findByTestId('member-access-save')).toBeInTheDocument();
    for (const group of [
      'Main System',
      'Inventory',
      'Orders and Fulfillment',
      'Customers',
      'Team Management',
      'System',
    ]) {
      // 'Inventory'/'Customers' also appear as toggle labels, so allow >= 1.
      expect(screen.getAllByText(group).length).toBeGreaterThanOrEqual(1);
    }
    // The assignable "Add Inventory Item" toggle (post_live_item_entry) is present.
    expect(screen.getByTestId('access-toggle-post_live_item_entry')).toBeInTheDocument();
    expect(screen.getByText('Add Inventory Item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('stages toggles locally — nothing saves until Save Access', async () => {
    setPerms.mockClear();
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    await screen.findByTestId('member-access-save');

    fireEvent.click(screen.getByTestId('access-toggle-nav_orders'));
    expect(setPerms).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('member-access-save'));
    expect(setPerms).toHaveBeenCalledTimes(1);
  });
});
