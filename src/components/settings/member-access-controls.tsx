'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  loadTeamMemberAccessAction,
  setTeamMemberPermissionsAction,
  setTeamMemberRoleAction,
} from '@/lib/authz/team-actions';
import {
  ACCESS_MODULES,
  ALL_ACCESS_KEYS,
  applyModuleCascade,
  deriveModuleState,
  MAX_SUPER_ADMINS_MESSAGE,
  ROLE_OPTIONS,
  roleLabel,
  type AccessModule,
} from '@/lib/authz/access-catalogue';
import type { TeamMemberRow } from '@/lib/authz/team-accounts';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';

/** Stable slug for a module title (used for test ids and expand state). */
function moduleSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Titles of modules that currently hold at least one enabled key. */
function modulesWithEnabled(keys: ReadonlySet<string>): Set<string> {
  const open = new Set<string>();
  for (const m of ACCESS_MODULES) {
    const has =
      (m.parent && keys.has(m.parent.key)) || m.children.some((c) => keys.has(c.key));
    if (has) open.add(m.title);
  }
  return open;
}

/**
 * Manage Access + Change Role for one team member.
 *
 * Access is organised as collapsible MODULES (Owner request): each module has a
 * parent page-access toggle and the child actions inside it. Turning a parent OFF
 * disables and clears its children (parent→child cascade); Team Management is a
 * fixed group of INDEPENDENT toggles (Review Attendance / Payroll rules are not
 * disturbed by any parent). The same cascade runs server-side, and every rule here
 * is ALSO enforced in the database — this only decides what the screen offers:
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
      // Normalise so a child-without-parent member is not stripped on save, and
      // present each module coherently.
      const derived = deriveModuleState(new Set(access?.permissionKeys ?? []));
      setKeys(derived);
      // Start collapsed for a compact view; open the modules already in use.
      setExpanded(modulesWithEnabled(derived));
    } catch {
      setError('That team member could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (title: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  // Parent on: add the page-access key. Parent off: remove it AND every child
  // (cascade) so a disabled module never leaves an orphaned action granted.
  const setParent = (m: AccessModule, on: boolean) => {
    if (!m.parent) return;
    setKeys((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(m.parent!.key);
      } else {
        next.delete(m.parent!.key);
        for (const c of m.children) next.delete(c.key);
      }
      return next;
    });
    if (on) setExpanded((prev) => new Set(prev).add(m.title));
  };

  const setKey = (key: string, on: boolean) =>
    setKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const enableAll = () => {
    setKeys(new Set(ALL_ACCESS_KEYS));
    setExpanded(new Set(ACCESS_MODULES.map((m) => m.title)));
  };
  const disableAll = () => setKeys(new Set());

  const save = async () => {
    if (pending || submittingRef.current || !accessEditable) return;
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      // Defensive cascade before submit (the DB re-applies it too).
      const effective = [...applyModuleCascade(keys)];
      const res = await setTeamMemberPermissionsAction(member.staffProfileId, effective);
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

  /** One checkbox row (parent or child). */
  const toggleRow = (
    label: string,
    key: string,
    checked: boolean,
    disabled: boolean,
    onChange: (on: boolean) => void,
    emphasis = false,
  ) => (
    <label
      key={key}
      className={`flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm ${
        emphasis ? 'bg-accent/30 font-medium' : ''
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <span
          className={`text-[10px] font-semibold uppercase ${
            checked ? 'text-green-700' : 'text-muted-foreground'
          }`}
        >
          {checked ? 'Enabled' : 'Disabled'}
        </span>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          data-testid={`access-toggle-${key}`}
          className="h-4 w-4 accent-gold"
        />
      </span>
    </label>
  );

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
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
                {pending ? 'Saving…' : saved ? '✓ Saved' : 'Save Access'}
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
              <Button type="button" size="sm" variant="outline" onClick={enableAll}>
                Enable All
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={disableAll}>
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
            <div className="space-y-2">
              {ACCESS_MODULES.map((m) => {
                const slug = moduleSlug(m.title);
                const isOpen = expanded.has(m.title);
                const parentOn = m.parent ? keys.has(m.parent.key) : true;
                const enabledCount = [
                  ...(m.parent && keys.has(m.parent.key) ? [1] : []),
                  ...m.children.filter((c) => keys.has(c.key)),
                ].length;
                const collapsible = m.children.length > 0;
                return (
                  <div key={m.title} className="rounded-lg border border-border">
                    {/* Module header: chevron + title + parent toggle */}
                    <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                      <button
                        type="button"
                        onClick={() => (collapsible ? toggleExpanded(m.title) : undefined)}
                        data-testid={`access-module-${slug}`}
                        aria-expanded={collapsible ? isOpen : undefined}
                        className={`flex items-center gap-2 text-sm font-semibold ${
                          collapsible ? 'hover:text-gold' : 'cursor-default'
                        }`}
                      >
                        {collapsible ? (
                          <span aria-hidden="true" className="text-xs text-muted-foreground">
                            {isOpen ? '▼' : '▶'}
                          </span>
                        ) : null}
                        {m.title}
                        {m.children.length > 0 ? (
                          <span className="text-[10px] font-normal text-muted-foreground">
                            {enabledCount}/{m.children.length + (m.parent ? 1 : 0)}
                          </span>
                        ) : null}
                      </button>

                      {m.parent ? (
                        <label className="flex items-center gap-2 text-xs">
                          <span
                            className={`font-semibold uppercase ${
                              keys.has(m.parent.key) ? 'text-green-700' : 'text-muted-foreground'
                            }`}
                          >
                            {keys.has(m.parent.key) ? 'Enabled' : 'Disabled'}
                          </span>
                          <input
                            type="checkbox"
                            checked={keys.has(m.parent.key)}
                            disabled={!accessEditable}
                            onChange={(e) => setParent(m, e.target.checked)}
                            data-testid={`access-toggle-${m.parent.key}`}
                            className="h-4 w-4 accent-gold"
                          />
                        </label>
                      ) : null}
                    </div>

                    {/* Children (independent for the parentless Team Management module) */}
                    {collapsible && isOpen ? (
                      <div className="border-t border-border p-2.5">
                        {m.parent && !parentOn ? (
                          <p className="mb-2 text-[11px] text-muted-foreground">
                            Enable {m.parent.label} to manage these actions.
                          </p>
                        ) : null}
                        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                          {m.children.map((c) =>
                            toggleRow(
                              c.label,
                              c.key,
                              keys.has(c.key),
                              !accessEditable || (m.parent ? !parentOn : false),
                              (on) => setKey(c.key, on),
                            ),
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {!superAdminSlotFree ? (
            <p className="text-[11px] text-muted-foreground">{MAX_SUPER_ADMINS_MESSAGE}</p>
          ) : null}
          {saved ? (
            <p
              className="flex items-center gap-2 rounded-md border border-green-600/40 bg-green-600/10 px-3 py-2 text-sm font-medium text-green-700"
              role="status"
              data-testid="member-access-saved"
            >
              <span aria-hidden="true">✓</span> Access permissions updated successfully. They
              apply on the member&apos;s next page load.
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
