/**
 * ONE stage-to-actions configuration for the Order View modal.
 *
 * The rule this module exists to enforce: an order shows only the actions its
 * CURRENT stage allows. Visibility rules used to be scattered across the modal's
 * sub-views (`status === 'invoiced' ? … : …` in several places), so a new stage
 * meant hunting through components and a stale branch could offer an action the
 * database would refuse. This is the single place that decides.
 *
 * Deliberately NOT `server-only`: the modal is a client component and must read the
 * same table the server checks against, so the two cannot drift.
 *
 * Visibility is CONVENIENCE. Every action still re-checks its own permission and
 * the database still enforces the transition — hiding a button never authorizes
 * anything, and showing one never grants it.
 */

/** The workflow stages an order can be in, as the modal understands them. */
export type OrderStage =
  | 'invoiced'
  | 'awaiting_required_payment'
  | 'required_payment_verified'
  | 'for_preparation'
  | 'for_shipping_or_pickup'
  | 'approved_for_release'
  | 'exceptional_release_pending'
  | 'dispatched_or_picked_up'
  | 'for_layaway'
  | 'keep'
  | 'for_cancel'
  | 'cancelled'
  | 'completed'
  | 'expired_overdue';

export type StageConfig = {
  /** What the operator calls this stage. */
  label: string;
  /** May money be recorded here (Add Payment / Add Down Payment · Deposit)? */
  allowsPayment: boolean;
  /** May the order be cancelled from here? Drives the Danger Zone. */
  allowsCancel: boolean;
  /** Read-only stages show details and history, never workflow actions. */
  readOnly: boolean;
  /** Which detail tabs are worth showing. Never force the same tabs everywhere. */
  tabs: ReadonlyArray<'items' | 'payments' | 'fulfillment' | 'layaway' | 'history'>;
};

const BASE_TABS = ['items', 'history'] as const;

/**
 * The table. Payment is allowed wherever an order is live and still owes money;
 * it is refused once the order is closed (completed / cancelled) or is itself
 * awaiting a cancellation decision, because money should not move under review.
 */
export const STAGE_ACTIONS: Record<OrderStage, StageConfig> = {
  invoiced: {
    label: 'For Invoice',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: [...BASE_TABS],
  },
  awaiting_required_payment: {
    label: 'For Reminder',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: [...BASE_TABS],
  },
  required_payment_verified: {
    label: 'For Confirm',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: [...BASE_TABS],
  },
  for_preparation: {
    label: 'For Prepare',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: ['items', 'fulfillment', 'history'],
  },
  for_shipping_or_pickup: {
    label: 'For Shipping',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: ['items', 'fulfillment', 'history'],
  },
  approved_for_release: {
    label: 'Ship Confirm',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: ['items', 'fulfillment', 'history'],
  },
  exceptional_release_pending: {
    label: 'Ship Confirm',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: ['items', 'fulfillment', 'history'],
  },
  dispatched_or_picked_up: {
    label: 'Delivery / Pickup',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: ['items', 'fulfillment', 'history'],
  },
  for_layaway: {
    label: 'For Layaway',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: ['items', 'layaway', 'history'],
  },
  keep: {
    label: 'Keep',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: [...BASE_TABS],
  },
  expired_overdue: {
    label: 'Expired / Overdue',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    tabs: [...BASE_TABS],
  },
  // Awaiting a cancellation decision: the order is frozen. No money moves, and it
  // cannot be cancelled again — it is already in the cancellation queue.
  for_cancel: {
    label: 'For Cancel',
    allowsPayment: false,
    allowsCancel: false,
    readOnly: false,
    tabs: [...BASE_TABS],
  },
  // Closed. Read-only: details and history, never workflow or money actions.
  cancelled: {
    label: 'Cancelled',
    allowsPayment: false,
    allowsCancel: false,
    readOnly: true,
    tabs: [...BASE_TABS],
  },
  completed: {
    label: 'Completed',
    allowsPayment: false,
    allowsCancel: false,
    readOnly: true,
    tabs: ['items', 'payments', 'history'],
  },
};

/** The config for a stage, falling back to a safe read-only shape for the unknown. */
export function stageConfig(status: string): StageConfig {
  return (
    STAGE_ACTIONS[status as OrderStage] ?? {
      label: status.replace(/_/g, ' '),
      allowsPayment: false,
      allowsCancel: false,
      readOnly: true,
      tabs: [...BASE_TABS],
    }
  );
}

/**
 * May the payment controls be OFFERED right now?
 *
 * All three must hold: the stage allows money, a balance actually remains, and the
 * user may record a payment. A fully-paid order says so rather than offering a
 * button that would be refused.
 */
export function canOfferPayment(args: {
  status: string;
  paidInFull: boolean;
  balanceUnavailable: boolean;
  canRecordPayment: boolean;
}): boolean {
  if (args.balanceUnavailable) return false;
  if (args.paidInFull) return false;
  if (!args.canRecordPayment) return false;
  return stageConfig(args.status).allowsPayment;
}

/** May Cancel Order be offered? Never for For Cancel, Cancelled, or Completed. */
export function canOfferCancel(status: string): boolean {
  return stageConfig(status).allowsCancel;
}
