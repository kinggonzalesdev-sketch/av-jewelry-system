'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  loadTeamMemberAccessAction,
  setTeamMemberPermissionsAction,
  setTeamMemberRoleAction,
} from '@/lib/authz/team-actions';
import {
  ACCESS_GROUPS,
  MAX_SUPER_ADMINS_MESSAGE,
  ROLE_OPTIONS,
  roleLabel,
} from '@/lib/authz/access-catalogue';
import type { TeamMemberRow } from '@/lib/authz/team-accounts';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/**
 * Manage Access + Change Role for one team member.
 *
 * Every rule here is ALSO enforced in the database — this only decides what the
 * screen offers, and the server's refusal is surfaced verbatim when they disagree:
 *
 *   - Only the PRIMARY Super Admin sees the Super Admin option, and only while a
 *     slot is free; otherwise it is disabled with the cap message.
 *   - A Super Admin's permissions are never editable — they hold everything.
 *   - Nobody edits their own role or access.
 *   - The Primary Super Admin can never be demoted.
 *
 * Toggles are staged locally and committed only by Save Access, so a half-finished
 * edit never reaches the server; a submit ref blocks a double-save.
 */
export function MemberAccessControls({
  member,
  isPrimary,
  superAdminSlotFree,
}: {
  member: TeamMemberRow;
  /** True when the SIGNED-IN user is the Primary Super Admin. */
  isPrimary: boolean;
  /** True when fewer than 2 active Super Admins exist. */
  superAdminSlotFree: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [roleBusy, setRoleBusy] = useState(false);
  const submittingRef = useRef(false);

  const isSuperAdmin = member.roleKey === 'owner';
  // A Super Admin holds every permission implicitly, and nobody edits their own.
  const accessEditable = !isSuperAdmin && !member.isSelf;

  const openModal = async () => {
    setOpen(true);
    setError(null);
    setSaved(false);
    setLoading(true);
    try {
      const access = await loadTeamMemberAccessAction(member.staffProfileId);
      setKeys(new Set(access?.permissionKeys ?? []));
    } catch {
      setError('That team member could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (key: string) =>
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = async () => {
    if (pending || submittingRef.current || !accessEditable) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await setTeamMemberPermissionsAction(member.staffProfileId, [...keys]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setPending(false);
      submittingRef.current = false;
    }
  };

  const changeRole = async (roleKey: string) => {
    if (roleBusy || roleKey === member.roleKey) return;
    setRoleBusy(true);
    setError(null);
    try {
      const res = await setTeamMemberRoleAction(member.staffProfileId, roleKey);
      if (!res.ok) {
        // Surfaced on the row so it is visible without opening the modal.
        window.alert(res.error);
        return;
      }
      router.refresh();
    } finally {
      setRoleBusy(false);
    }
  };

  // Super Admin is offered ONLY by the Primary, and only while a slot is free.
  const roleDisabled = (key: string): boolean => {
    if (key === 'owner') {
      if (!isPrimary) return true;
      if (!superAdminSlotFree && member.roleKey !== 'owner') return true;
    }
    // Removing a Super Admin is equally Primary-only.
    if (member.roleKey === 'owner' && key !== 'owner' && !isPrimary) return true;
    return false;
  };

  const roleLocked = member.isPrimarySuperAdmin || member.isSelf;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {/* Change Role */}
      <select
        value={member.roleKey}
        disabled={roleLocked || roleBusy}
        onChange={(e) => void changeRole(e.target.value)}
        aria-label={`Change role for ${member.fullName}`}
        data-testid={`member-role-${member.staffProfileId}`}
        title={
          member.isPrimarySuperAdmin
            ? 'The Primary Super Admin cannot be demoted.'
            : member.isSelf
              ? 'You cannot change your own role.'
              : undefined
        }
        className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-gold disabled:cursor-not-allowed disabled:opacity-50"
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r.key} value={r.key} disabled={roleDisabled(r.key)}>
            {r.label}
            {r.key === 'owner' && !superAdminSlotFree && member.roleKey !== 'owner'
              ? ' (limit reached)'
              : ''}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => void openModal()}
        data-testid={`member-access-${member.staffProfileId}`}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
      >
        Manage Access
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Manage access"
        description="Permissions apply as soon as they are saved."
        size="lg"
        footer={
          accessEditable ? (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void save()}
                disabled={pending || loading}
                data-testid="member-access-save"
              >
                {pending ? 'Saving…' : 'Save Access'}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setOpen(false)}>
              Close
            </Button>
          )
        }
      >
        <div className="space-y-3">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-border p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{member.fullName}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Email</span>
              <span className="truncate font-medium">{member.email ?? '—'}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Current Role</span>
              <span className="font-medium">
                {roleLabel(member.roleKey)}
                {member.isPrimarySuperAdmin ? ' · Primary' : ''}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Account Status</span>
              <span className="font-medium">{member.isActive ? 'Active' : 'Disabled'}</span>
            </div>
          </div>

          {!accessEditable ? (
            <p
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700"
              data-testid="member-access-locked"
            >
              {isSuperAdmin
                ? 'A Super Admin holds every permission — these toggles do not apply and cannot be edited.'
                : 'You cannot edit your own permissions.'}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setKeys(new Set(ACCESS_GROUPS.flatMap((g) => g.toggles.map((t) => t.key))))
                }
              >
                Enable All
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setKeys(new Set())}
              >
                Disable All
              </Button>
              <span className="text-xs text-muted-foreground">
                {keys.size} enabled — changes apply only after Save Access.
              </span>
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3">
              {ACCESS_GROUPS.map((group) => (
                <div key={group.title}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </p>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {group.toggles.map((t) => {
                      const on = keys.has(t.key);
                      return (
                        <label
                          key={t.key}
                          className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                        >
                          <span>{t.label}</span>
                          <span className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-semibold uppercase ${
                                on ? 'text-green-700' : 'text-muted-foreground'
                              }`}
                            >
                              {on ? 'Enabled' : 'Disabled'}
                            </span>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={!accessEditable}
                              onChange={() => toggle(t.key)}
                              data-testid={`access-toggle-${t.key}`}
                              className="h-4 w-4 accent-gold"
                            />
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!superAdminSlotFree ? (
            <p className="text-[11px] text-muted-foreground">{MAX_SUPER_ADMINS_MESSAGE}</p>
          ) : null}
          {saved ? (
            <p className="text-sm text-green-700" role="status">
              Access saved.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
