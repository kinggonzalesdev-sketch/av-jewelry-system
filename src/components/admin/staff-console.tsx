'use client';

import { useActionState, useState } from 'react';

import {
  EMPTY_STAFF_ADMIN_STATE,
  assignScopeAction,
  deactivateAccountAction,
  grantPermissionAction,
  reactivateAccountAction,
  removeScopeAction,
  revokePermissionAction,
  setSelectedAdminAction,
  type StaffAdminActionState,
} from '@/lib/authz/actions';
import type { StaffAccountRow } from '@/lib/authz/account-management';
import { PERMISSIONS } from '@/lib/authz/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Staff administration console — Owner only (Bible §5.3, §5.4, §5.13, §30.5).
 *
 * What this screen refuses to imply:
 *   - that a role title carries authority (it does not — §5.13)
 *   - that an assignment is a permission (a scope narrows; it never grants — §5)
 *   - that what is visible here is what is enforced (RLS and requireOwner() are)
 *
 * Every control below re-checks Owner authority server-side. Deleting this whole
 * file would remove no protection at all — which is the point (§30.3 r2).
 */

const ALL_PERMISSIONS = Object.values(PERMISSIONS).sort();

/** §5.13 item 10: at most two Selected Admins, ever. */
const MAX_SELECTED_ADMINS = 2;

function Result({ state }: { state: StaffAdminActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="text-xs font-medium text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p role="status" className="text-xs font-medium">
        {state.success}
      </p>
    );
  }
  return null;
}

function AccountCard({
  account,
  scopes,
  selectedAdminCount,
  auditTrail,
}: {
  account: StaffAccountRow;
  scopes: Array<{ id: string; label: string }>;
  selectedAdminCount: number;
  auditTrail: Array<{
    occurredAt: string;
    action: string;
    entityType: string;
    outcome: string;
  }>;
}) {
  const [grantState, grant, granting] = useActionState<StaffAdminActionState, FormData>(
    grantPermissionAction,
    EMPTY_STAFF_ADMIN_STATE,
  );
  const [revokeState, revoke, revoking] = useActionState<StaffAdminActionState, FormData>(
    revokePermissionAction,
    EMPTY_STAFF_ADMIN_STATE,
  );
  const [statusState, changeStatus, changingStatus] = useActionState<
    StaffAdminActionState,
    FormData
  >(
    account.isActive ? deactivateAccountAction : reactivateAccountAction,
    EMPTY_STAFF_ADMIN_STATE,
  );
  const [adminState, setAdmin, settingAdmin] = useActionState<
    StaffAdminActionState,
    FormData
  >(setSelectedAdminAction, EMPTY_STAFF_ADMIN_STATE);
  const [scopeState, addScope, addingScope] = useActionState<
    StaffAdminActionState,
    FormData
  >(assignScopeAction, EMPTY_STAFF_ADMIN_STATE);
  const [dropScopeState, dropScope, droppingScope] = useActionState<
    StaffAdminActionState,
    FormData
  >(removeScopeAction, EMPTY_STAFF_ADMIN_STATE);

  const [showTrail, setShowTrail] = useState(false);

  const isOwner = account.roleKey === 'owner';
  const isSelectedAdmin = account.roleKey === 'selected_admin';

  // The cap is enforced by the database; this only avoids offering a click that
  // is certain to be refused.
  const adminSlotsFull = !isSelectedAdmin && selectedAdminCount >= MAX_SELECTED_ADMINS;

  const ungranted = ALL_PERMISSIONS.filter((p) => !account.permissions.includes(p));
  const unassignedScopes = scopes.filter(
    (s) => !account.scopes.some((a) => a.id === s.id),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span>{account.fullName}</span>
          <span
            className="rounded-full border px-2 py-0.5 text-xs font-normal"
            data-testid="role-label"
          >
            {account.roleKey}
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-xs font-normal"
            data-testid="status-label"
          >
            {account.isActive ? 'Active' : 'Deactivated'}
          </span>
          {account.mfaEnrolled && (
            <span className="rounded-full border px-2 py-0.5 text-xs font-normal">
              MFA
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* --- Granted permissions ---------------------------------------- */}
        <section className="space-y-2">
          <p className="text-sm font-medium">
            Granted permissions ({account.permissions.length})
          </p>

          {account.permissions.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="zero-grants">
              None. A new account starts with <strong>zero</strong> grants, and the role
              title adds nothing — every permission is granted explicitly.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {account.permissions.map((p) => (
                <li key={p}>
                  <form action={revoke} className="inline">
                    <input type="hidden" name="staffProfileId" value={account.id} />
                    <input type="hidden" name="permission" value={p} />
                    <button
                      type="submit"
                      disabled={revoking}
                      className="rounded-full border px-2 py-0.5 text-xs hover:bg-destructive/10"
                      title={`Revoke ${p}`}
                    >
                      {p} ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <Result state={revokeState} />

          {ungranted.length > 0 && (
            <form action={grant} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="staffProfileId" value={account.id} />
              <div className="space-y-1">
                <Label htmlFor={`grant-${account.id}`} className="text-xs">
                  Grant a permission
                </Label>
                <select
                  id={`grant-${account.id}`}
                  name="permission"
                  className="flex h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {ungranted.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={granting}>
                Grant
              </Button>
            </form>
          )}
          <Result state={grantState} />
        </section>

        {/* --- Scopes ------------------------------------------------------ */}
        <section className="space-y-2">
          <p className="text-sm font-medium">Assigned scopes ({account.scopes.length})</p>
          <p className="text-xs text-muted-foreground">
            A scope <strong>narrows</strong> where a granted permission applies. It grants
            nothing on its own — assignment is not permission.
          </p>

          {account.scopes.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {account.scopes.map((s) => (
                <li key={s.id}>
                  <form action={dropScope} className="inline">
                    <input type="hidden" name="staffProfileId" value={account.id} />
                    <input type="hidden" name="scopeId" value={s.id} />
                    <button
                      type="submit"
                      disabled={droppingScope}
                      className="rounded-full border px-2 py-0.5 text-xs hover:bg-destructive/10"
                      title={`Remove ${s.label}`}
                    >
                      {s.label} ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <Result state={dropScopeState} />

          {unassignedScopes.length > 0 && (
            <form action={addScope} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="staffProfileId" value={account.id} />
              <div className="space-y-1">
                <Label htmlFor={`scope-${account.id}`} className="text-xs">
                  Assign a scope
                </Label>
                <select
                  id={`scope-${account.id}`}
                  name="scopeId"
                  className="flex h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {unassignedScopes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={addingScope}>
                Assign
              </Button>
            </form>
          )}
          <Result state={scopeState} />
        </section>

        {/* --- Selected Admin status --------------------------------------- */}
        {!isOwner && (
          <section className="space-y-2">
            <p className="text-sm font-medium">Selected Admin</p>
            <form action={setAdmin} className="flex items-center gap-2">
              <input type="hidden" name="staffProfileId" value={account.id} />
              <input
                type="hidden"
                name="makeSelectedAdmin"
                value={isSelectedAdmin ? 'false' : 'true'}
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={settingAdmin || adminSlotsFull}
              >
                {isSelectedAdmin ? 'Remove Selected Admin' : 'Make Selected Admin'}
              </Button>
              {adminSlotsFull && (
                <span className="text-xs text-muted-foreground">
                  Both Selected Admin slots are taken (maximum {MAX_SELECTED_ADMINS}).
                </span>
              )}
            </form>
            <Result state={adminState} />
          </section>
        )}

        {/* --- Activate / Deactivate --------------------------------------- */}
        {!isOwner && (
          <section className="space-y-2">
            <p className="text-sm font-medium">
              {account.isActive ? 'Deactivate account' : 'Reactivate account'}
            </p>
            <form action={changeStatus} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="staffProfileId" value={account.id} />
              {account.isActive && (
                <div className="space-y-1">
                  <Label htmlFor={`reason-${account.id}`} className="text-xs">
                    Reason (required)
                  </Label>
                  <Input
                    id={`reason-${account.id}`}
                    name="reason"
                    required
                    className="h-9 text-xs"
                  />
                </div>
              )}
              <Button
                type="submit"
                size="sm"
                variant={account.isActive ? 'destructive' : 'outline'}
                disabled={changingStatus}
              >
                {account.isActive ? 'Deactivate' : 'Reactivate'}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              Deactivating removes future access immediately. Grants and audit history are
              preserved — history is never rewritten.
            </p>
            <Result state={statusState} />
          </section>
        )}

        {/* --- Audit trail -------------------------------------------------- */}
        <section className="space-y-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowTrail((v) => !v)}
          >
            {showTrail ? 'Hide audit trail' : 'View audit trail'}
          </Button>

          {showTrail &&
            (auditTrail.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No audit events recorded for this account yet.
              </p>
            ) : (
              <ul className="space-y-1 text-xs" data-testid="audit-trail">
                {auditTrail.map((e, i) => (
                  <li key={i} className="flex flex-wrap gap-2 border-b pb-1">
                    <span className="text-muted-foreground">
                      {new Date(e.occurredAt).toLocaleString()}
                    </span>
                    <span className="font-medium">{e.action}</span>
                    <span className="text-muted-foreground">{e.entityType}</span>
                    <span
                      className={
                        e.outcome === 'succeeded' ? '' : 'font-medium text-destructive'
                      }
                    >
                      {e.outcome}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </CardContent>
    </Card>
  );
}

export function StaffConsole({
  accounts,
  scopes,
  auditTrails,
}: {
  accounts: StaffAccountRow[];
  scopes: Array<{ id: string; label: string }>;
  auditTrails: Record<
    string,
    Array<{ occurredAt: string; action: string; entityType: string; outcome: string }>
  >;
}) {
  const selectedAdminCount = accounts.filter(
    (a) => a.roleKey === 'selected_admin',
  ).length;

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        <p>
          <strong>Owner-only.</strong> Every control here re-checks Owner authority
          server-side and RLS refuses underneath it — what this screen shows or hides is
          never the protection.
        </p>
        <p className="mt-1">
          Selected Admins: {selectedAdminCount} of {MAX_SELECTED_ADMINS}. Staff invitation
          is not available in the app: creating an account needs the service-role key,
          which bypasses RLS and is deliberately unwired (ADR §11). Accounts are
          provisioned out-of-band.
        </p>
      </div>

      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          scopes={scopes}
          selectedAdminCount={selectedAdminCount}
          auditTrail={auditTrails[account.id] ?? []}
        />
      ))}
    </div>
  );
}
