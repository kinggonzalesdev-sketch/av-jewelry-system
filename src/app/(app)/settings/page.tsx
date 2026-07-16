import type { Metadata } from 'next';
import Link from 'next/link';

import { UnavailablePage } from '@/components/shell/unavailable';
import { requireActiveStaff } from '@/lib/authz/guard';

export const metadata: Metadata = {
  title: 'Settings — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

/**
 * Settings is an approved nav item whose full screen is not built yet, so it
 * renders an honest "not available yet" state.
 *
 * It is also the approved home for administration. Staff Administration and
 * Capabilities are functional routes that are intentionally NOT standalone
 * sidebar items (prototype-verbatim nav); surfacing their real links here keeps
 * them reachable in the UI. The Staff link is Owner-only as a convenience — the
 * page itself and RLS both re-check authority (Bible §30.3 r2).
 */
export default async function SettingsPage() {
  const staff = await requireActiveStaff();
  const isOwner = staff.roleKey === 'owner';

  return (
    <UnavailablePage title="Settings">
      <section
        aria-labelledby="administration-heading"
        className="rounded-xl border border-border bg-card p-4"
      >
        <h2 id="administration-heading" className="text-sm font-semibold text-foreground">
          Administration
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          These tools are available now, outside the primary navigation.
        </p>
        <ul className="mt-3 space-y-1.5">
          {isOwner ? (
            <li>
              <Link
                href="/admin/staff"
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                <span aria-hidden="true" className="w-4 text-center text-xs">
                  ◆
                </span>
                Staff Administration
              </Link>
            </li>
          ) : null}
          <li>
            <Link
              href="/admin/capabilities"
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <span aria-hidden="true" className="w-4 text-center text-xs">
                ⚙
              </span>
              Capabilities
            </Link>
          </li>
          <li>
            <Link
              href="/security"
              className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <span aria-hidden="true" className="w-4 text-center text-xs">
                ⛨
              </span>
              Security
            </Link>
          </li>
        </ul>
      </section>
    </UnavailablePage>
  );
}
