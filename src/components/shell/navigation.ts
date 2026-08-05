/**
 * Primary navigation model — the single source of truth for the production
 * shell's sidebar and mobile bottom nav.
 *
 * ORDER IS OWNER-APPROVED and must not be reordered without a new Owner decision.
 * It began as the recovered `ui-owner-approved-preview` prototype order; the Owner
 * has since (2026-07-22) removed Live from the sidebar and promoted Attendance &
 * Payroll and Scrap from Settings to standalone items (SOT change log):
 *
 *   Dashboard Profile · Orders · Customers · Items / Inventory ·
 *   Payments & Layaway · Fulfillment · Attendance & Payroll · Scrap · Settings
 *
 * (Reports was removed from the sidebar 2026-07-22; the /reports route remains.
 * Invoice was removed 2026-07-22 and folded into Orders → For Invoice; the
 * /orders/invoice route remains and redirects there.)
 *
 * NOTE ON THE FIRST LABEL: the recovered prototype named this "Dashboard Report".
 * The Owner has since renamed it to "Dashboard Profile" (explicit change-control
 * decision; docs/FINAL-UI-SOURCE-OF-TRUTH.md §1 and the lock tests were updated
 * to match, in that order). The route is unchanged (/dashboard).
 *
 * Deliberate consequences of "prototype verbatim":
 *   - Fulfillment is a STANDALONE item (as the prototype shows), even though its
 *     route lives at /orders/fulfillment.
 *   - There is NO "New Entry" item. New Entry is an in-page action inside its
 *     approved parent sections (Orders and Live), never a primary nav item.
 *   - Staff and Capabilities are NOT primary nav items. They stay reachable as
 *     functional routes (surfaced under Settings), per "functional routes may
 *     remain internally available without appearing as standalone sidebar items".
 *
 * Hiding or omitting a nav item is a CONVENIENCE, never an authorization control
 * (Bible §30.3 r2): every route re-checks permission server-side and RLS scopes
 * the data regardless of what renders here.
 */
export type NavItem = {
  readonly href: string;
  readonly label: string;
  /** Decorative glyph — aria-hidden in the UI. */
  readonly icon: string;
  /**
   * Optional sidebar group heading. A run of consecutive items sharing a section
   * renders under one small heading (e.g. "Team Management"). Convenience only —
   * never an authorization boundary.
   */
  readonly section?: string;
  /**
   * A mobile bottom-nav primary slot (the last slot is the More button). Mobile
   * primary is Orders · Customers (Live removed 2026-07-22; Invoice folded into
   * Orders → For Invoice 2026-07-22).
   */
  readonly mobilePrimary: boolean;
  /**
   * `false` → the approved nav POSITION is preserved, but the route renders an
   * honest "not available yet" state instead of a finished page. Never a dead
   * link, never a 404, never fake content.
   */
  readonly available: boolean;
  /**
   * `true` → shown in the sidebar only to the Owner. A convenience filter so a
   * non-Owner is not offered a page they cannot open; the PAGE still re-checks the
   * role server-side (nav visibility is never the authorization control — Bible
   * §30.3 r2). Review Attendance is Owner-only because only the Owner's RLS policy
   * returns every staff member's records; broadening to Selected Admin needs an
   * RLS change first (a deliberate follow-up), so it stays Owner-only for now.
   */
  readonly ownerOnly?: boolean;
  /**
   * The permission a member needs to REACH this page. The sidebar hides items the
   * member lacks, and the page itself re-checks the SAME key server-side — so
   * typing the URL gets nothing either. Nav visibility is convenience; the page
   * guard is the control (Bible §30.3 r2).
   */
  readonly permission?: string;
};

/** Route → the permission that opens it. One map, used by the sidebar AND pages. */
export const PAGE_PERMISSION: Record<string, string> = {
  '/dashboard': 'nav_dashboard',
  '/orders': 'nav_orders',
  '/customers': 'nav_customers',
  '/orders/inventory': 'nav_inventory',
  '/orders/payments': 'nav_layaway',
  '/orders/invoice': 'nav_orders',
  '/admin/scrap': 'nav_scrap',
  '/admin/attendance': 'hr_attendance',
  '/admin/attendance/review': 'hr_review_attendance',
  '/admin/payroll': 'hr_payroll',
  '/reports': 'view_reports',
  '/settings': 'view_settings',
};

export const PRIMARY_NAV: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard Profile',
    icon: '▥',
    mobilePrimary: false,
    available: true,
  },
  { href: '/orders', label: 'Orders', icon: '□', mobilePrimary: true, available: true },
  // Invoice was removed as a standalone item (Owner request 2026-07-22): the
  // Invoice workspace now lives INSIDE Orders → For Invoice. The /orders/invoice
  // route still exists and redirects there, so old links never 404.
  // Customers was removed from the sidebar (Owner request). The /customers route,
  // its data, and the nav_customers permission are untouched — customer records are
  // still reached from the order and layaway screens that reference them.
  {
    href: '/orders/inventory',
    label: 'Inventory',
    icon: '◈',
    mobilePrimary: false,
    available: true,
  },
  // "Layaway" (Owner request 2026-07-24 — shortened from "Payments & Layaway";
  // layaway is the primary workspace here, payment verification lives within it).
  {
    href: '/orders/payments',
    label: 'Layaway',
    icon: '₱',
    mobilePrimary: false,
    available: true,
  },
  // Fulfillment was removed as a standalone sidebar item (Owner request): it
  // duplicated the Orders workflow. The /orders/fulfillment route is preserved as
  // a fallback (its actions still work); the goal is one Orders-centred workflow.
  {
    href: '/admin/scrap',
    label: 'Scrap',
    icon: '♻',
    mobilePrimary: false,
    available: true,
  },
  // Team Management — a collapsible group (Owner request 2026-07-22). The
  // /admin/attendance route is preserved (the Attendance page); Payroll and
  // Review Attendance are their own routes. Review Attendance is admin-only.
  {
    href: '/admin/attendance',
    label: 'Attendance',
    icon: '⏱',
    section: 'Team Management',
    mobilePrimary: false,
    available: true,
  },
  {
    // Now permission-gated (hr_review_attendance), not owner-only: a granted member
    // sees it, the page re-checks the key, and RLS lets them read all records.
    href: '/admin/attendance/review',
    label: 'Review Attendance',
    icon: '☑',
    section: 'Team Management',
    mobilePrimary: false,
    available: true,
  },
  {
    href: '/admin/payroll',
    label: 'Payroll',
    icon: '▤',
    section: 'Team Management',
    mobilePrimary: false,
    available: true,
  },
  // Special Calculator (Owner request 2026-08-01): a staff utility to quickly compute
  // fixed / per-gram item prices and the 10/20/30% down payment + remaining balance.
  // Placed LAST — below Team Management, in the lower sidebar area (Owner request). It
  // only calculates; it changes no order, payment, inventory, or layaway record.
  {
    href: '/calculator',
    label: 'Special Calculator',
    icon: '🧮',
    mobilePrimary: false,
    available: true,
  },
] as const;

/**
 * Settings lives in the fixed sidebar FOOTER (with Logout), not the scrolling nav
 * (Owner request 2026-07-22). Kept as a NavItem so the footer and mobile menu reuse
 * the same shape and route.
 */
export const SETTINGS_ITEM = {
  href: '/settings',
  label: 'Settings',
  icon: '⚙',
  mobilePrimary: false,
  available: true,
} as const satisfies NavItem;

/** A rendered nav row: a standalone item, or a titled group of items. */
export type NavRow =
  | { readonly kind: 'item'; readonly item: NavItem }
  | { readonly kind: 'group'; readonly section: string; readonly items: NavItem[] };

/**
 * Groups PRIMARY_NAV into rows — consecutive items sharing a `section` become one
 * group (rendered as a collapsible parent); everything else stays a flat item. One
 * place builds the structure so the sidebar markup is not hardcoded per item.
 */
export function navRows(): NavRow[] {
  const rows: NavRow[] = [];
  for (const item of PRIMARY_NAV) {
    if (!item.section) {
      rows.push({ kind: 'item', item });
      continue;
    }
    const last = rows[rows.length - 1];
    if (last && last.kind === 'group' && last.section === item.section) {
      last.items.push(item);
    } else {
      rows.push({ kind: 'group', section: item.section, items: [item] });
    }
  }
  return rows;
}

/**
 * True when this member may SEE `item` in the sidebar.
 *
 * Two filters: the legacy `ownerOnly` flag, and the page permission from
 * PAGE_PERMISSION. `allowed` is the member's granted key set — when it is
 * undefined the permission filter is skipped (callers that do not know the grants
 * yet keep the previous behaviour rather than hiding everything).
 *
 * Hiding a link is CONVENIENCE. The page re-checks the same key server-side, so a
 * member who types the URL still gets nothing.
 */
export function canSeeNavItem(
  item: NavItem,
  roleKey: string | undefined,
  allowed?: ReadonlySet<string>,
): boolean {
  if (item.ownerOnly && roleKey !== 'owner') return false;
  if (allowed) {
    const needed = item.permission ?? PAGE_PERMISSION[item.href];
    if (needed && !allowed.has(needed)) return false;
  }
  return true;
}

/** The four mobile bottom-nav destinations (before the More button). */
export const mobilePrimaryItems = (): readonly NavItem[] =>
  PRIMARY_NAV.filter((item) => item.mobilePrimary);

/**
 * Everything not in the mobile primary four, in approved order. Dashboard Profile
 * leads because it is not one of the mobile primary four but is the landing page.
 */
export const mobileMoreItems = (): readonly NavItem[] =>
  PRIMARY_NAV.filter((item) => !item.mobilePrimary);

/** The short label the mobile bottom nav shows (prototype uses the first word). */
export const mobileLabel = (item: NavItem): string =>
  item.label.split(' ')[0] ?? item.label;
