/**
 * The permission catalogue the Manage Access modal shows, grouped as the Owner
 * specified. Deliberately NOT a `server-only` module: the modal is a client
 * component and must render the same groups the server saves, so both sides share
 * ONE definition instead of drifting apart.
 *
 * Every entry maps to a REAL permission key that actually gates something. Where a
 * capability already existed under an operational name (claim_capture gates order
 * creation, payment_verification gates recording a payment) the toggle reuses that
 * key rather than inventing a parallel one — otherwise a toggle would look
 * authoritative while gating nothing.
 */

export type AccessToggle = {
  /** The real permission key stored in staff_permission_grants. */
  key: string;
  /** What the Owner sees. */
  label: string;
};

export type AccessGroup = {
  title: string;
  toggles: AccessToggle[];
};

export const ACCESS_GROUPS: AccessGroup[] = [
  {
    title: 'Main System',
    toggles: [
      { key: 'nav_dashboard', label: 'Dashboard' },
      { key: 'nav_orders', label: 'Orders' },
      { key: 'nav_customers', label: 'Customers' },
      { key: 'nav_payments', label: 'Payments' },
      { key: 'nav_layaway', label: 'Layaway' },
      { key: 'nav_scrap', label: 'Scrap' },
    ],
  },
  {
    // Inventory access + actions in one place. "Add Inventory Item" is INDEPENDENT
    // from opening/editing/deleting inventory: a member can have Inventory + Edit
    // but NOT Add, and then cannot create new items.
    title: 'Inventory',
    toggles: [
      { key: 'nav_inventory', label: 'Inventory' },
      { key: 'post_live_item_entry', label: 'Add Inventory Item' },
      { key: 'inventory_edit', label: 'Edit Inventory' },
      { key: 'inventory_delete', label: 'Delete Inventory' },
      { key: 'export_data_reports', label: 'Export Data' },
    ],
  },
  {
    title: 'Orders and Fulfillment',
    toggles: [
      { key: 'claim_capture', label: 'Create Order' },
      { key: 'payment_verification', label: 'Add Payment' },
      { key: 'order_add_deposit', label: 'Add Down Payment / Deposit' },
      { key: 'order_cancel', label: 'Cancel Order' },
      { key: 'fulfillment_preparation', label: 'Fulfillment' },
      { key: 'fulfillment_delivery', label: 'Delivery' },
      { key: 'fulfillment_shipping', label: 'Shipping' },
      { key: 'fulfillment_pickup', label: 'Pickup' },
    ],
  },
  {
    // Layaway record actions. Opening the Layaway workspace is `nav_layaway`
    // (Main System); these two gate the row-level Edit and Delete of a layaway
    // account — independent of each other and of viewing/adding a payment.
    title: 'Layaway',
    toggles: [
      { key: 'layaway_edit', label: 'Edit Layaway' },
      { key: 'layaway_delete', label: 'Delete Layaway' },
    ],
  },
  {
    title: 'Customers',
    toggles: [
      { key: 'customer_edit', label: 'Edit Customer' },
      { key: 'customer_delete', label: 'Delete Customer' },
    ],
  },
  {
    title: 'Team Management',
    toggles: [
      { key: 'hr_attendance', label: 'Attendance' },
      { key: 'hr_review_attendance', label: 'Review Attendance' },
      { key: 'hr_payroll', label: 'Payroll' },
    ],
  },
  {
    title: 'System',
    toggles: [
      { key: 'view_reports', label: 'Reports' },
      { key: 'view_settings', label: 'Settings' },
    ],
  },
];

/** Every key the modal can toggle — the whitelist a save is filtered against. */
export const ALL_ACCESS_KEYS: string[] = ACCESS_GROUPS.flatMap((g) =>
  g.toggles.map((t) => t.key),
);

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
