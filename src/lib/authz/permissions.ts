/**
 * The approved permission catalog (Bible §5.13, confirmed for Phase 2).
 *
 * 23 permissions: the 20 reconciled, plus three named directly in Bible §22 —
 * Inventory Monitoring and Miner-Allocation Review (§22.5, §22.15) and
 * Initiate High-Risk Action (§22.14).
 *
 * These keys mirror `public.permissions.key` exactly. A test asserts the two
 * lists match, so they cannot drift apart.
 *
 * Standing rules encoded by the SHAPE of this module:
 *   - no permission silently grants another (there is no hierarchy here, and no
 *     "implies" table — deliberately);
 *   - role title is not authority (no role→permission mapping exists);
 *   - assignment is not permission (scope lives elsewhere and only narrows).
 */
export const PERMISSIONS = {
  CLAIM_CAPTURE: 'claim_capture',
  CLAIM_REVIEW: 'claim_review',
  CONFIRM_CLAIM_PRINT_LABEL: 'confirm_claim_print_label',
  INVOICE_PREPARATION: 'invoice_preparation',
  PAYMENT_VERIFICATION: 'payment_verification',
  LAYAWAY_MONITORING: 'layaway_monitoring',
  FULFILLMENT_PREPARATION: 'fulfillment_preparation',
  FULFILLMENT_RELEASE: 'fulfillment_release',
  EXISTING_RECORD_ENTRY: 'existing_record_entry',
  LIVE_BATCH_OPERATION: 'live_batch_operation',
  LIVE_BATCH_CLOSURE: 'live_batch_closure',
  CURRENT_FLEX_ITEM_CONTROL: 'current_flex_item_control',
  ITEM_WITHDRAWAL: 'item_withdrawal',
  POST_LIVE_ITEM_ENTRY: 'post_live_item_entry',
  MESSAGE_PREPARATION: 'message_preparation',
  MESSAGE_SENDING: 'message_sending',
  RETRY_REPRINT_LABEL: 'retry_reprint_label',
  VOID_CANCEL_LABEL_JOB: 'void_cancel_label_job',
  EXPORT_DATA_REPORTS: 'export_data_reports',
  PAYMENT_CORRECTION: 'payment_correction',
  // Named directly in Bible §22:
  INVENTORY_MONITORING: 'inventory_monitoring',
  MINER_ALLOCATION_REVIEW: 'miner_allocation_review',
  INITIATE_HIGH_RISK_ACTION: 'initiate_high_risk_action',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSION_KEYS: readonly PermissionKey[] = Object.values(PERMISSIONS);

/**
 * The three approved roles (Bible §5).
 *
 * ⚠️  A role is a TITLE, not authority. There is deliberately no
 *     ROLE_PERMISSIONS map in this file: adding one would make role imply
 *     permission, which the Bible explicitly forbids. The Owner role is the sole
 *     exception, and only for the six non-delegable approvals below.
 */
export const ROLES = {
  OWNER: 'owner',
  SELECTED_ADMIN: 'selected_admin',
  STAFF: 'staff',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

/**
 * The six non-delegable Owner-approved actions (Bible §5.13 item 12).
 * No permission grants these. Only the Owner may decide them.
 */
export const OWNER_ONLY_ACTIONS = {
  OFFICIAL_ORDER_CANCELLATION: 'official_order_cancellation',
  LAYAWAY_FORFEITURE: 'layaway_forfeiture',
  PRICE_OVERRIDE: 'price_override',
  EXCEPTIONAL_FULFILLMENT_RELEASE: 'exceptional_fulfillment_release',
  LIVE_BATCH_REOPEN: 'live_batch_reopen',
  WRONG_PAYMENT_TO_ORDER_CORRECTION: 'wrong_payment_to_order_correction',
} as const;

export type OwnerOnlyAction =
  (typeof OWNER_ONLY_ACTIONS)[keyof typeof OWNER_ONLY_ACTIONS];

export const ALL_OWNER_ONLY_ACTIONS: readonly OwnerOnlyAction[] =
  Object.values(OWNER_ONLY_ACTIONS);
