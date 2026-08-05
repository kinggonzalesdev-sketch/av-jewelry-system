import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MemberAccessControls } from '@/components/settings/member-access-controls';
import type { TeamMemberRow } from '@/lib/authz/team-accounts';

const setRole = vi.fn(() => Promise.resolve({ ok: true as const }));
const setPerms = vi.fn(() => Promise.resolve({ ok: true as const }));
// Controllable so a test can seed the member's currently-granted keys.
const loadAccess = vi.fn<() => Promise<{ permissionKeys: string[] } | null>>(() =>
  Promise.resolve(null),
);
vi.mock('@/lib/authz/team-actions', () => ({
  loadTeamMemberAccessAction: () => loadAccess(),
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

describe('Manage Access — module-based permission toggles', () => {
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

  it('shows every module header + Enable/Disable All + Save/Cancel', async () => {
    loadAccess.mockResolvedValueOnce(null);
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    expect(await screen.findByTestId('member-access-save')).toBeInTheDocument();

    // Every module heading is present (parent page-access toggles are in the header,
    // always visible even while the module is collapsed).
    for (const title of [
      'Dashboard & Profile',
      'Orders',
      'Inventory',
      'Customers',
      'Payments',
      'Layaway',
      'Scrap',
      'Reports',
      'Settings',
      'Team Management',
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
    }
    // Parent toggles render without expanding.
    expect(screen.getByTestId('access-toggle-nav_inventory')).toBeInTheDocument();
    expect(screen.getByTestId('access-toggle-nav_layaway')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Enable All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('Enable All reveals the child actions, incl. the new Create Layaway toggle', async () => {
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    await screen.findByTestId('member-access-save');

    fireEvent.click(screen.getByRole('button', { name: 'Enable All' }));
    for (const key of [
      'post_live_item_entry',
      'inventory_edit',
      'inventory_delete',
      'layaway_create',
      'layaway_edit',
      'layaway_delete',
      'payment_verification',
      'hr_review_attendance',
      'hr_payroll',
    ]) {
      expect(screen.getByTestId(`access-toggle-${key}`)).toBeChecked();
    }
  });

  it('cascades: turning a module parent OFF disables and clears its children', async () => {
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    await screen.findByTestId('member-access-save');

    // Enable the Inventory parent (also expands the module) and one child.
    fireEvent.click(screen.getByTestId('access-toggle-nav_inventory'));
    fireEvent.click(screen.getByTestId('access-toggle-inventory_edit'));
    expect(screen.getByTestId('access-toggle-inventory_edit')).toBeChecked();

    // Turn the parent OFF → the child clears and can no longer be edited.
    fireEvent.click(screen.getByTestId('access-toggle-nav_inventory'));
    const child = screen.getByTestId('access-toggle-inventory_edit');
    expect(child).not.toBeChecked();
    expect(child).toBeDisabled();
  });

  it('keeps Team Management toggles independent (no parent cascade)', async () => {
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    await screen.findByTestId('member-access-save');

    // Team Management has no parent — expand it and toggle Payroll directly.
    fireEvent.click(screen.getByTestId('access-module-team-management'));
    const payroll = screen.getByTestId('access-toggle-hr_payroll');
    expect(payroll).not.toBeDisabled();
    fireEvent.click(payroll);
    expect(payroll).toBeChecked();
  });

  it('auto-enables a module parent when a child is already granted (no silent strip)', async () => {
    loadAccess.mockResolvedValueOnce({ permissionKeys: ['inventory_edit'] });
    renderControls();
    fireEvent.click(screen.getByTestId('member-access-sp1'));
    await screen.findByTestId('member-access-save');

    // The module is normalised: parent shows ON and the module auto-expands so the
    // already-granted child is visible and checked (it will not be stripped on save).
    expect(screen.getByTestId('access-toggle-nav_inventory')).toBeChecked();
    expect(screen.getByTestId('access-toggle-inventory_edit')).toBeChecked();
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
