'use client';

import type { AdminNameContext } from '@/lib/authz/admin-name';

/**
 * The "Admin Name" field shared by New Order, Walk-In and Layaway New Entry
 * (formerly "Salesperson").
 *
 * It is ALWAYS the signed-in account, always read-only, and never a dropdown
 * (Owner request): nobody — Super Admin included — records an entry under another
 * person's name from these forms. The earlier Super-Admin picker was removed
 * outright rather than merely hidden, so there is no selectable option to reach.
 *
 * The displayed name is never hardcoded: it comes from the authenticated session
 * via `getAdminNameContext()`. The value that travels with the entry is the
 * PERMANENT staff profile id, so renaming a team member never re-attributes their
 * history — and `resolveAdminName()` re-derives it server-side, so the posted id
 * is a claim the server checks, not a fact it trusts.
 */
export function AdminNameField({
  admins,
  className,
  id,
  name,
}: {
  admins: AdminNameContext;
  className?: string;
  id?: string;
  name?: string;
}) {
  return (
    <>
      <input
        className={className}
        value={admins.selfName}
        readOnly
        data-testid="admin-name"
        {...(id ? { id } : {})}
      />
      {/* The id still posts, so the server records the permanent relationship. */}
      <input type="hidden" name={name ?? 'adminId'} value={admins.selfId} />
    </>
  );
}
