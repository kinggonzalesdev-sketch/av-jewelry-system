import Link from 'next/link';

import { SignOutButton } from '@/components/shell/sign-out-button';

/**
 * Application header: identity, the authenticated-user area, and the Global Search
 * entry point.
 *
 * Global Search lives in the header, not as a sixth bottom-nav item (Bible §8.2).
 * Phase 0 renders the entry point as an explicitly disabled affordance — search is
 * delivered in Roadmap Phase 9. It is disabled rather than omitted so the approved
 * navigation model is visible without pretending the feature works.
 */
/** Human role label. The prototype's hardcoded "Owner" is replaced by this. */
const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  selected_admin: 'Selected Admin',
  staff: 'Staff',
};

export function AppHeader({
  userEmail,
  fullName,
  roleKey,
}: {
  userEmail: string;
  fullName: string;
  roleKey?: string | undefined;
}) {
  const roleLabel = roleKey ? (ROLE_LABEL[roleKey] ?? roleKey) : null;
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-sm font-semibold tracking-tight">
            A.V. Jewelry Operations
          </span>
          <span className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline">
            Phase 0 foundation
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/*
            Owner-only entry point. Hiding it from non-Owners is a CONVENIENCE,
            not a security control (Bible §30.3 r2): the page itself re-checks
            Owner authority server-side, and RLS restricts the underlying data to
            the Owner regardless of what this header renders.
          */}
          {roleKey === 'owner' ? (
            <Link
              href="/admin/staff"
              className="hidden h-9 items-center rounded-md border border-border px-3 text-xs font-medium sm:flex"
            >
              Staff
            </Link>
          ) : null}
          <Link
            href="/security"
            className="hidden h-9 items-center rounded-md border border-border px-3 text-xs font-medium sm:flex"
          >
            Security
          </Link>
          <button
            type="button"
            disabled
            aria-label="Global search (not implemented — Phase 9)"
            title="Global Search is not implemented yet (Phase 9)"
            className="hidden h-9 items-center rounded-md border border-border px-3 text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:flex"
          >
            Search — not implemented
          </button>
          {/* Real authenticated identity — never a hardcoded "A.V. Owner".
              The full name comes from the caller's own staff_profiles row
              (self-read RLS); the role label is derived from their real role. */}
          <span
            className="hidden min-w-0 flex-col items-end leading-tight sm:flex"
            data-testid="authenticated-identity"
          >
            <span
              className="max-w-[20ch] truncate text-xs font-medium text-foreground"
              data-testid="authenticated-full-name"
            >
              {fullName}
            </span>
            {roleLabel ? (
              <span
                className="text-[10px] text-muted-foreground"
                data-testid="authenticated-role"
              >
                {roleLabel}
              </span>
            ) : null}
          </span>
          {/* Kept for the title attribute so the email is still discoverable. */}
          <span className="sr-only" data-testid="authenticated-user-email">
            {userEmail}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
