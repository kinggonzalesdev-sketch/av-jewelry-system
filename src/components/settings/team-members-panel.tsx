'use client';

import { useActionState, useState, type ReactNode } from 'react';

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
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/page-primitives';

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

  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The cap counts ACTIVE Super Admins; the database re-checks it on every save.
  const activeSuperAdmins = members.filter(
    (m) => m.roleKey === 'owner' && m.isActive,
  ).length;
  const superAdminSlotFree = activeSuperAdmins < MAX_SUPER_ADMINS;

  // Super Admins (role 'owner') pinned to the top; everyone else keeps their existing
  // order (Array.sort is stable). Display order only — every action keys off the
  // permanent staffProfileId.
  const sortedMembers = [...members].sort(
    (a, b) => (a.roleKey === 'owner' ? 0 : 1) - (b.roleKey === 'owner' ? 0 : 1),
  );
  const q = search.trim().toLowerCase();
  const filtered = q
    ? sortedMembers.filter((m) =>
        `${m.fullName} ${m.email ?? ''}`.toLowerCase().includes(q),
      )
    : sortedMembers;
  const selected = selectedId
    ? members.find((m) => m.staffProfileId === selectedId) ?? null
    : null;

  return (
    <div className="mt-3 space-y-3">
      {/* One compact row: hint · Add Member · search. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Click a member to view details and manage access.
        </p>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          data-testid="add-member-open"
          className="h-9 whitespace-nowrap rounded-md border border-border px-3 text-sm font-medium hover:bg-accent"
        >
          ＋ Add Member
        </button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members…"
          aria-label="Search members"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold sm:w-56"
        />
      </div>

      {/* Roster — Name · Role · Status · chevron. The whole row opens the member
          drawer; password / role / access / delete controls all live there. */}
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No team members yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members match “{search}”.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table
            className="data-table w-full min-w-[420px] text-left text-sm"
            data-testid="team-roster"
          >
            <colgroup>
              <col style={{ width: '54%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '6%' }} />
            </colgroup>
            <thead className="border-b text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 text-left font-medium">Name</th>
                <th className="px-3 py-2.5 text-center font-medium">Role</th>
                <th className="px-3 py-2.5 text-center font-medium">Status</th>
                <th className="px-3 py-2.5" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr
                  key={m.staffProfileId}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(m.staffProfileId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedId(m.staffProfileId);
                    }
                  }}
                  data-testid={`member-row-${m.staffProfileId}`}
                  className="cursor-pointer border-b last:border-0 hover:bg-accent/60 focus:bg-accent/60 focus:outline-none"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                        {initials(m.fullName)}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.fullName}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {m.email ?? '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {ROLE_LABEL[m.roleKey] ?? m.roleKey}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {m.passwordIsTemp ? (
                      <StatusBadge label="Temp Password" tone="warning" />
                    ) : m.isActive ? (
                      <StatusBadge label="Active" tone="success" />
                    ) : (
                      <StatusBadge label="Inactive" tone="neutral" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">›</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Member — a compact modal (was an always-visible form). */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Member" size="sm">
        <form action={add} className="space-y-3">
          <div>
            <Label htmlFor="tm-name" className="text-xs">
              Full Name
            </Label>
            <Input
              id="tm-name"
              name="fullName"
              required
              placeholder="Full name"
              className="mt-1 h-9"
            />
          </div>
          <div>
            <Label htmlFor="tm-email" className="text-xs">
              Sign-in Email
            </Label>
            <Input
              id="tm-email"
              name="email"
              type="email"
              required
              placeholder="name@email.com"
              className="mt-1 h-9"
            />
          </div>
          {addState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {addState.error}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="submit" disabled={adding} className="font-semibold">
              {adding ? 'Adding…' : '＋ Add Member'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Member details — info + every access/password/delete action in one place. */}
      <Modal open={selected !== null} onClose={() => setSelectedId(null)} title="Member" size="sm">
        {selected ? (
          <MemberDetail
            member={selected}
            isPrimary={isPrimary}
            superAdminSlotFree={superAdminSlotFree}
          />
        ) : null}
      </Modal>
    </div>
  );
}

/** Two-letter initials for the roster avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

/** A label/value row in the member drawer. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/**
 * Member details drawer body — account info + the SAME guarded controls that used
 * to sit in the table row (MemberAccessControls, SetPasswordCell, DeleteMemberCell).
 * Nothing about the actions changed; they only moved here so the roster stays clean.
 */
function MemberDetail({
  member,
  isPrimary,
  superAdminSlotFree,
}: {
  member: TeamMemberRow;
  isPrimary: boolean;
  superAdminSlotFree: boolean;
}) {
  const isSuperAdmin = member.roleKey === 'owner';
  return (
    <div className="space-y-4" data-testid="member-detail">
      <div className="flex items-center gap-3 border-b border-border pb-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {initials(member.fullName)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{member.fullName}</p>
          <p className="text-xs text-muted-foreground">
            {ROLE_LABEL[member.roleKey] ?? member.roleKey}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Account Information
        </p>
        <dl className="text-sm">
          <DetailRow label="Email" value={member.email ?? '—'} />
          <DetailRow label="Sign-in method" value="Email" />
          <DetailRow
            label="Status"
            value={
              member.passwordIsTemp ? (
                <StatusBadge label="Temp Password" tone="warning" />
              ) : member.isActive ? (
                <StatusBadge label="Active" tone="success" />
              ) : (
                <StatusBadge label="Inactive" tone="neutral" />
              )
            }
          />
        </dl>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Access &amp; Role
        </p>
        <MemberAccessControls
          member={member}
          isPrimary={isPrimary}
          superAdminSlotFree={superAdminSlotFree}
        />
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Actions
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SetPasswordCell member={member} />
          {isSuperAdmin ? (
            <span
              className="text-[11px] text-muted-foreground"
              title="Super Admins are protected and cannot be deleted here."
            >
              Protected — cannot be deleted
            </span>
          ) : (
            <DeleteMemberCell member={member} />
          )}
        </div>
      </div>
    </div>
  );
}
