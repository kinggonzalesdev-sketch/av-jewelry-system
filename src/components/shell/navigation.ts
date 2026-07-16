/**
 * Primary navigation model — the single source of truth for the production
 * shell's sidebar and mobile bottom nav.
 *
 * ORDER IS THE OWNER-APPROVED PROTOTYPE ORDER, VERBATIM. It is recovered from the
 * frozen `ui-owner-approved-preview` prototype (`components/preview/shell.tsx`,
 * `PREVIEW_NAV`) and must not be reordered without a new Owner decision:
 *
 *   Dashboard Report · Orders · Invoice · Live · Customers · Items / Inventory ·
 *   Payments & Layaway · Fulfillment · Reports · Settings
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
   * One of the four mobile bottom-nav slots (the fifth slot is the More button).
   * The prototype's mobile primary is Orders · Invoice · Live · Customers.
   */
  readonly mobilePrimary: boolean;
  /**
   * `false` → the approved nav POSITION is preserved, but the route renders an
   * honest "not available yet" state instead of a finished page. Never a dead
   * link, never a 404, never fake content.
   */
  readonly available: boolean;
};

export const PRIMARY_NAV: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard Report',
    icon: '▥',
    mobilePrimary: false,
    available: true,
  },
  { href: '/orders', label: 'Orders', icon: '□', mobilePrimary: true, available: true },
  {
    href: '/orders/invoice',
    label: 'Invoice',
    icon: '▤',
    mobilePrimary: true,
    available: true,
  },
  { href: '/live', label: 'Live', icon: '◉', mobilePrimary: true, available: true },
  {
    href: '/customers',
    label: 'Customers',
    icon: '☺',
    mobilePrimary: true,
    available: false,
  },
  {
    href: '/orders/inventory',
    label: 'Items / Inventory',
    icon: '◈',
    mobilePrimary: false,
    available: true,
  },
  // "Payments & Layaway", not "Payments": layaway is a distinct workspace with
  // its own queues and Owner-gated forfeiture (Owner-approved label).
  {
    href: '/orders/payments',
    label: 'Payments & Layaway',
    icon: '₱',
    mobilePrimary: false,
    available: true,
  },
  {
    href: '/orders/fulfillment',
    label: 'Fulfillment',
    icon: '➤',
    mobilePrimary: false,
    available: true,
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: '▦',
    mobilePrimary: false,
    available: false,
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: '⚙',
    mobilePrimary: false,
    available: false,
  },
] as const;

/** The four mobile bottom-nav destinations (before the More button). */
export const mobilePrimaryItems = (): readonly NavItem[] =>
  PRIMARY_NAV.filter((item) => item.mobilePrimary);

/**
 * Everything not in the mobile primary four, in approved order. Dashboard Report
 * leads because it is not one of the mobile primary four but is the landing page.
 */
export const mobileMoreItems = (): readonly NavItem[] =>
  PRIMARY_NAV.filter((item) => !item.mobilePrimary);

/** The short label the mobile bottom nav shows (prototype uses the first word). */
export const mobileLabel = (item: NavItem): string =>
  item.label.split(' ')[0] ?? item.label;
