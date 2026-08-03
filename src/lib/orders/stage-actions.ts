/**
 * ONE stage-to-actions configuration for the Order View modal (§7).
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
 * anything, and showing one never grants it. In particular the completion helpers
 * only decide whether the BUTTON appears; `order_completion_block()` in SQL is
 * what actually decides whether an order may complete.
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

/** The workflow buttons a stage may offer, beyond payment and cancellation. */
export type StageAction =
  /** Move the order to another section (§6). */
  | 'transfer_destination'
  /** Delivery's single finishing action: hand over + complete (§5). */
  | 'done'
  /** Fully paid + fulfilled → Completed (§5). */
  | 'transfer_completed'
  /** Pickup's handover confirmation. */
  | 'confirm_released';

export type StageConfig = {
  /** What the operator calls this stage. Also the badge shown at the top of the
   *  modal, so the header can never disagree with the section (§7). */
  label: string;
  /** May money be recorded here (Add Payment)? */
  allowsPayment: boolean;
  /** May the order be cancelled from here? Drives the Danger Zone. */
  allowsCancel: boolean;
  /** Read-only stages show details and history, never workflow actions. */
  readOnly: boolean;
  /** The workflow actions this stage offers, in the order they should render. */
  actions: readonly StageAction[];
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
    actions: [],
    tabs: [...BASE_TABS],
  },
  awaiting_required_payment: {
    label: 'For Reminder',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: [],
    tabs: [...BASE_TABS],
  },
  // For Confirm: confirmation or transfer only — no handover actions, because
  // nothing has been prepared yet.
  required_payment_verified: {
    label: 'For Confirm',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: [...BASE_TABS],
  },
  for_preparation: {
    label: 'For Prepare',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: ['items', 'fulfillment', 'history'],
  },
  // For Shipping keeps Transfer to Destination (§6) alongside its own workflow
  // confirmation.
  for_shipping_or_pickup: {
    label: 'For Shipping',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: ['items', 'fulfillment', 'history'],
  },
  // Ship Confirm: shipping confirmation or transfer, nothing else.
  approved_for_release: {
    label: 'Ship Confirm',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: ['items', 'fulfillment', 'history'],
  },
  exceptional_release_pending: {
    label: 'Ship Confirm',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: ['items', 'fulfillment', 'history'],
  },
  // Delivery / Pickup — the handover stage. Done finishes a delivery; Confirm
  // Picked Up / Released finishes a pickup; Transfer to Completed covers the case
  // where the handover was already recorded.
  dispatched_or_picked_up: {
    label: 'Delivery / Pickup',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['done', 'confirm_released', 'transfer_completed', 'transfer_destination'],
    tabs: ['items', 'fulfillment', 'history'],
  },
  for_layaway: {
    label: 'For Layaway',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: ['items', 'layaway', 'history'],
  },
  // Keep is a holding state (Owner request 2026-07-30, revised): the item is set
  // aside for the customer. The Keep modal offers ONLY Cancel Order (header) and
  // Transfer to Completed — no Add Payment — so payment is disallowed here; the
  // database (`order_completion_block`) still gates completion.
  keep: {
    label: 'Keep',
    allowsPayment: false,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_completed'],
    tabs: [...BASE_TABS],
  },
  expired_overdue: {
    label: 'Expired / Overdue',
    allowsPayment: true,
    allowsCancel: true,
    readOnly: false,
    actions: ['transfer_destination'],
    tabs: [...BASE_TABS],
  },
  // Awaiting a cancellation decision: the order is frozen. No money moves, it
  // cannot be cancelled again, and it cannot be transferred out from under the
  // pending decision.
  for_cancel: {
    label: 'For Cancel',
    allowsPayment: false,
    allowsCancel: false,
    readOnly: false,
    actions: [],
    tabs: [...BASE_TABS],
  },
  // Closed. Read-only: details and history, never workflow or money actions.
  cancelled: {
    label: 'Cancelled',
    allowsPayment: false,
    allowsCancel: false,
    readOnly: true,
    actions: [],
    tabs: [...BASE_TABS],
  },
  completed: {
    label: 'Completed',
    allowsPayment: false,
    allowsCancel: false,
    readOnly: true,
    actions: [],
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
      actions: [],
      tabs: [...BASE_TABS],
    }
  );
}

/** The status label to show at the top of the modal. Single source, so the header
 *  always matches the section the order is actually in (§7). */
export function stageLabel(status: string): string {
  return stageConfig(status).label;
}

/** Destination → the Orders card/section label it routes an order into. */
const DESTINATION_STAGE_LABEL: Record<string, string> = {
  shipping: 'For Shipping',
  delivery: 'For Delivery',
  pickup: 'Pickup',
  layaway: 'For Layaway',
  keep: 'Keep',
};

/**
 * Statuses whose OWN label is authoritative and must win over the fulfillment
 * destination — a closed / cancelled / ship-confirmed order shows its true status
 * even though it still carries the destination it was routed to.
 */
const STATUS_WINS_OVER_DESTINATION = new Set([
  'cancelled',
  'for_cancel',
  'completed',
  'closed',
  'delivered',
  'picked_up',
  'released',
  'approved_for_release',
  'exceptional_release_pending',
  'dispatched_or_picked_up',
]);

/**
 * The label to show in the order modal so the popup's status ALWAYS matches the
 * Orders card the order sits in (Owner request). When an order was routed to a
 * destination (For Shipping / Delivery / Pickup / For Layaway / Keep) but its
 * underlying status is still a generic prepare/confirm stage, we show the
 * destination's label — never the stale prepare/confirm label. Once the order
 * reaches an authoritative status (Ship Confirm, Cancelled, Completed, …) that
 * status wins.
 */
export function resolveStageLabel(
  status: string,
  fulfillmentDestination?: string | null,
): string {
  if (
    fulfillmentDestination &&
    DESTINATION_STAGE_LABEL[fulfillmentDestination] &&
    !STATUS_WINS_OVER_DESTINATION.has(status)
  ) {
    return DESTINATION_STAGE_LABEL[fulfillmentDestination];
  }
  return stageLabel(status);
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

/** Does this stage offer the given workflow action at all? */
export function stageOffers(status: string, action: StageAction): boolean {
  return stageConfig(status).actions.includes(action);
}

/**
 * May Transfer to Completed / Done be OFFERED?
 *
 * The stage must list it, the order must be fully paid, and the caller must hold
 * the release permission. `completionBlock` is the database's own verdict
 * (order_completion_block) and wins over everything here when present — the UI
 * never claims an order is completable when SQL says otherwise.
 */
export function canOfferCompletion(args: {
  status: string;
  action: Extract<StageAction, 'done' | 'transfer_completed'>;
  paidInFull: boolean;
  balanceUnavailable: boolean;
  canRelease: boolean;
  completionBlock: string | null;
}): boolean {
  if (!args.canRelease) return false;
  if (!stageOffers(args.status, args.action)) return false;
  if (args.balanceUnavailable) return false;
  if (!args.paidInFull) return false;
  return args.completionBlock === null;
}
