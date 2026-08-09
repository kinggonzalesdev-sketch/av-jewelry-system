'use client';

import { useActionState, useState } from 'react';

import {
  addTeamMemberAction,
  deleteTeamMemberAction,
  setTeamPasswordAction,
} from '@/lib/authz/team-actions';
import { EMPTY_TEAM_STATE, type TeamActionState } from '@/lib/authz/team-action-state';
import type { TeamMemberRow } from '@/lib/authz/team-accounts';
import { MAX_SUPER_ADMINS } from '@/lib/authz/access-catalogue';
import { MemberAccessControls } from '@/components/settings/member-access-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Super Admin',
  selected_admin: 'Admin',
  staff: 'Staff',
};

/**
 * The "Set password" cell. Collapsed it is a button; clicking it reveals an inline
 * input where the Owner TYPES the password (min 8) and clicks Set. Each row owns
 * its own action state so one row's error/success never leaks into another.
 */
function SetPasswordCell({ member }: { member: TeamMemberRow }) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState<TeamActionState, FormData>(
    setTeamPasswordAction,
    EMPTY_TEAM_STATE,
  );

  // Collapse back to the button once a NEW success arrives. Adjusting state during
  // render (guarded so it runs once per success) is React's recommended pattern and
  // avoids the cascading-render pitfall of doing this in an effect.
  const [handledSuccess, setHandledSuccess] = useState<string | null>(null);
  if (state.success && state.success !== handledSuccess) {
    setHandledSuccess(state.success);
    setOpen(false);
  }

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid={`set-password-${member.staffProfileId}`}
      >
        {member.isSelf ? 'Set my password' : 'Set password'}
      </Button>
    );
  }

  return (
    <form action={submit} className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input type="hidden" name="staffProfileId" value={member.staffProfileId} />
        <Input
          name="newPassword"
          type="text"
          required
          minLength={8}
          autoFocus
          autoComplete="new-password"
          placeholder="new password (min 8)"
          className="h-8 w-44"
          aria-label={`New password for ${member.fullName}`}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '…' : 'Set'}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * The "Delete" cell. Deleting a team member is destructive, so it is a two-step
 * confirm: the button reveals "Delete? Yes / No". Only the actual account and the
 * member's OWN data are removed (the server refuses if they have activity). Never
 * shown for your own row — you cannot delete yourself.
 */
function DeleteMemberCell({ member }: { member: TeamMemberRow }) {
  const [confirming, setConfirming] = useState(false);
  const [state, submit, pending] = useActionState<TeamActionState, FormData>(
    deleteTeamMemberAction,
    EMPTY_TEAM_STATE,
  );

  if (member.isSelf) return null;

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        data-testid={`delete-member-${member.staffProfileId}`}
        className="rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={submit} className="flex items-center gap-2">
        <input type="hidden" name="staffProfileId" value={member.staffProfileId} />
        <span className="text-xs text-muted-foreground">Delete?</span>
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          disabled={pending}
          data-testid={`delete-confirm-${member.staffProfileId}`}
        >
          {pending ? '…' : 'Yes'}
        </Button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          No
        </button>
      </form>
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The generated temporary password is deliberately NOT shown after adding a member
 * (Owner request). The account is still created with one; the Owner hands over
 * access using the per-row "Set password" control instead, which is why removing
 * this banner does not strip the only way for a new member to sign in.
 */

export function TeamMembersPanel({
  members,
  isPrimary = false,
}: {
  members: TeamMemberRow[];
  /** True when the SIGNED-IN user is the Primary Super Admin. */
  isPrimary?: boolean;
}) {
  const [addState, add, adding] = useActionState<TeamActionState, FormData>(
    addTeamMemberAction,
    EMPTY_TEAM_STATE,
  );

  const error = addState.error;
  const onTemp = members.filter((m) => m.passwordIsTemp).length;
  // The cap counts ACTIVE Super Admins; the database re-checks it on every save.
  const activeSuperAdmins = members.filter(
    (m) => m.roleKey === 'owner' && m.isActive,
  ).length;
  const superAdminSlotFree = activeSuperAdmins < MAX_SUPER_ADMINS;

  return (
    <div className="space-y-3">
      {/* Count cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-2xl font-bold tabular-nums">{members.length}</div>
          <div className="text-xs text-muted-foreground">Team members</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-2xl font-bold tabular-nums">{onTemp}</div>
          <div className="text-xs text-muted-foreground">On a temp password</div>
        </div>
      </div>

      {/* Add a team member */}
      <form
        action={add}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-3"
      >
        <div className="min-w-[8rem] flex-1">
          <Label htmlFor="tm-name" className="text-xs">
            Name
          </Label>
          <Input
            id="tm-name"
            name="fullName"
            required
            placeholder="Full name"
            className="h-9"
          />
        </div>
        <div className="min-w-[10rem] flex-1">
          <Label htmlFor="tm-email" className="text-xs">
            Sign-in email
          </Label>
          <Input
            id="tm-email"
            name="email"
            type="email"
            required
            placeholder="name@email.com"
            className="h-9"
          />
        </div>
        <Button type="submit" disabled={adding} className="font-semibold">
          {adding ? 'Adding…' : '＋ Add member'}
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* Roster */}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team members yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table
            className="data-table w-full min-w-[520px] text-left text-sm"
            data-testid="team-roster"
          >
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-center font-medium">Team member</th>
                <th className="px-3 py-2.5 text-left font-medium">Sign-in email</th>
                <th className="px-3 py-2.5 text-center font-medium">Password</th>
                <th className="px-3 py-2.5 text-center font-medium">Role &amp; Access</th>
                <th className="col-actions px-3 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.staffProfileId} className="border-b last:border-0">
                  <td className="px-3 py-2.5 text-center">
                    <div className="font-medium">{m.fullName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {ROLE_LABEL[m.roleKey] ?? m.roleKey}
                      {m.isActive ? '' : ' · disabled'}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{m.email ?? '—'}</td>
                  <td className="px-3 py-2.5 text-center">
                    {m.passwordIsTemp ? (
                      <span className="whitespace-nowrap rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                        Temp (Not Changed)
                      </span>
                    ) : (
                      <span className="whitespace-nowrap text-xs text-gold-strong">Changed by them</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <MemberAccessControls
                      member={m}
                      isPrimary={isPrimary}
                      superAdminSlotFree={superAdminSlotFree}
                    />
                  </td>
                  <td className="col-actions px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <SetPasswordCell member={m} />
                      {/* The Primary Super Admin can never be deleted. */}
                      {m.isPrimarySuperAdmin ? (
                        <span
                          className="text-[11px] text-muted-foreground"
                          title="The Primary Super Admin cannot be deleted."
                        >
                          Protected
                        </span>
                      ) : (
                        <DeleteMemberCell member={m} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
