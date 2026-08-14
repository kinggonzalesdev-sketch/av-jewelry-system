/**
 * The permission catalogue the Manage Access modal shows, organised as the Owner
 * specified: collapsible MODULES, each with a parent "page access" toggle and the
 * child actions that live inside it. Deliberately NOT a `server-only` module — the
 * modal is a client component and the server save re-uses the SAME structure, so
 * both sides share ONE definition (and the same parent→child cascade) instead of
 * drifting apart.
 *
 * Every entry maps to a REAL permission key that actually gates something (a page,
 * a button, a server action, an RLS policy). Redundant "view X" items are folded
 * into the module's parent, and actions that gate nothing (or are Super-Admin-only)
 * are intentionally absent — a toggle must never look authoritative while
 * controlling nothing. The Owner (Super Admin) holds every key implicitly.
 */

export type AccessToggle = {
  /** The real permission key stored in staff_permission_grants. */
  key: string;
  /** What the Owner sees. */
  label: string;
};

export type AccessModule = {
  /** Collapsible module heading (e.g. "Inventory"). */
  title: string;
  /**
   * The module enabler — its page-access key. Turning the parent OFF disables and
   * strips every child (see {@link applyModuleCascade}). `null` means a flat group
   * of INDEPENDENT toggles with no cascade (Team Management, whose Review
   * Attendance / Payroll rules are fixed and must not be reset by a parent).
   */
  parent: AccessToggle | null;
  /** The actions inside the module. */
  children: AccessToggle[];
};

export const ACCESS_MODULES: AccessModule[] = [
  {
    title: 'Dashboard & Profile',
    parent: { key: 'nav_dashboard', label: 'Dashboard' },
    // Viewing the dashboard IS the parent. Editing own profile and changing own
    // password are available to every signed-in user, so they are not permissions.
    children: [],
  },
  {
    title: 'Orders',
    parent: { key: 'nav_orders', label: 'Orders' },
    children: [
      { key: 'claim_capture', label: 'Create Order' },
      { key: 'order_add_deposit', label: 'Add Down Payment / Deposit' },
      { key: 'order_cancel', label: 'Cancel Order' },
      { key: 'fulfillment_preparation', label: 'Fulfillment' },
      { key: 'fulfillment_delivery', label: 'Fulfillment · Delivery' },
      { key: 'fulfillment_shipping', label: 'Fulfillment · Shipping' },
      { key: 'fulfillment_pickup', label: 'Fulfillment · Pickup' },
    ],
  },
  {
    title: 'Inventory',
    parent: { key: 'nav_inventory', label: 'Inventory' },
    children: [
      { key: 'post_live_item_entry', label: 'Add Inventory Item' },
      { key: 'inventory_edit', label: 'Edit Inventory' },
      { key: 'inventory_delete', label: 'Delete Inventory' },
    ],
  },
  {
    title: 'Customers',
    parent: { key: 'nav_customers', label: 'Customers' },
    // Adding a customer reuses `claim_capture` (= Create Order), so there is no
    // separate "Add Customer" toggle — it would gate the same capability twice.
    children: [
      { key: 'customer_edit', label: 'Edit Customer' },
      { key: 'customer_delete', label: 'Delete Customer' },
    ],
  },
  {
    title: 'Payments',
    parent: { key: 'nav_payments', label: 'Payments' },
    // One key gates BOTH recording and verifying a payment (across Orders and
    // Layaway). Refunds have no feature, so there is no toggle for them.
    children: [{ key: 'payment_verification', label: 'Record / Verify Payment' }],
  },
  {
    title: 'Layaway',
    parent: { key: 'nav_layaway', label: 'Layaway' },
    children: [
      { key: 'layaway_create', label: 'Create Layaway' },
      { key: 'layaway_edit', label: 'Edit Layaway' },
      { key: 'layaway_delete', label: 'Delete Layaway' },
    ],
  },
  {
    title: 'Scrap',
    parent: { key: 'nav_scrap', label: 'Scrap' },
    // Scrap has only page-level access today; there are no per-action scrap keys.
    children: [],
  },
  {
    // One key (view_reports) gates BOTH the Daily Cash Summary (/cash/daily) and
    // Reports (/reports) — they share the nav "Cash & Reports" section too. Labelled to
    // match, so granting this to a client visibly hands them the Daily Cash module, not
    // just "Reports". No grant migration: the underlying key is unchanged.
    title: 'Cash & Reports',
    parent: { key: 'view_reports', label: 'Cash & Reports' },
    // The single export key covers data/report exports system-wide.
    children: [{ key: 'export_data_reports', label: 'Export Data' }],
  },
  {
    title: 'Settings',
    parent: { key: 'view_settings', label: 'Settings' },
    // Manage Users / Manage Access / Company Settings are Super-Admin-only and not
    // delegable, so the Settings module is a single page-access toggle.
    children: [],
  },
  {
    // Fixed rules (Owner): these three are INDEPENDENT toggles with no parent
    // cascade, so enabling/disabling one never disturbs another. Review Attendance
    // and Payroll keep their existing working grants — this redesign must not
    // rename, reset, or migrate them.
    title: 'Team Management',
    parent: null,
    children: [
      { key: 'hr_attendance', label: 'Attendance' },
      { key: 'hr_review_attendance', label: 'Review Attendance' },
      { key: 'hr_payroll', label: 'Payroll' },
    ],
  },
];

/** Every toggle key a module can offer (parents + children) — flat. */
function moduleKeys(m: AccessModule): string[] {
  return [...(m.parent ? [m.parent.key] : []), ...m.children.map((c) => c.key)];
}

/** Every key the modal can toggle — the whitelist a save is filtered against. */
export const ALL_ACCESS_KEYS: string[] = ACCESS_MODULES.flatMap(moduleKeys);

/**
 * Normalise a granted set into the module state the modal shows: a parent counts as
 * ON when it is granted OR any of its children is granted. This keeps a member who
 * holds a child action but not the page-access key from having that child stripped
 * on the next save (parent-off would cascade it away), and presents each module in a
 * coherent state. Only affects parented modules; independent toggles pass through.
 */
export function deriveModuleState(granted: ReadonlySet<string>): Set<string> {
  const next = new Set<string>();
  for (const m of ACCESS_MODULES) {
    const childOn = m.children.filter((c) => granted.has(c.key));
    for (const c of childOn) next.add(c.key);
    if (m.parent) {
      if (granted.has(m.parent.key) || childOn.length > 0) next.add(m.parent.key);
    }
  }
  return next;
}

/**
 * Parent→child cascade: for every module WITH a parent, if the parent is OFF, drop
 * all of its children (an action inside a disabled module cannot be granted).
 * Independent modules (parent === null) are untouched. Applied in the modal on save
 * AND server-side, so a crafted request can never grant a child without its parent.
 */
export function applyModuleCascade(keys: ReadonlySet<string>): Set<string> {
  // Children of any parented module whose parent is OFF are dropped. Built as a
  // "blocked" set and filtered out (rather than mutating in place) so this pure data
  // transform never looks like a database write.
  const blocked = new Set<string>();
  for (const m of ACCESS_MODULES) {
    if (m.parent && !keys.has(m.parent.key)) {
      for (const c of m.children) blocked.add(c.key);
    }
  }
  return new Set([...keys].filter((k) => !blocked.has(k)));
}

/** Role vocabulary. Super Admin IS the `owner` role (confirmed with the Owner). */
export const ROLE_OPTIONS = [
  { key: 'owner', label: 'Super Admin' },
  { key: 'selected_admin', label: 'Admin' },
  { key: 'staff', label: 'Staff' },
] as const;

export function roleLabel(roleKey: string): string {
  return ROLE_OPTIONS.find((r) => r.key === roleKey)?.label ?? roleKey;
}

/** The cap on ACTIVE Super Admin accounts, primary included. */
export const MAX_SUPER_ADMINS = 2;
export const MAX_SUPER_ADMINS_MESSAGE = 'Maximum of 2 Super Admin accounts reached.';
