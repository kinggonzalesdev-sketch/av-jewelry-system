/**
 * Which order statuses may still be cancelled.
 *
 * Deliberately NOT in `cancellation.ts`: that module is `server-only` (it talks to
 * the database), while the Cancel Order button is a client component that needs the
 * same rule to decide whether to render. Keeping the list here lets both sides share
 * ONE definition instead of drifting apart.
 *
 * Completed and cancelled orders are excluded, and `for_cancel` is excluded too —
 * an order already awaiting review is finalized, not cancelled again. The database
 * enforces all of this independently; this only decides what the UI offers.
 */
export const CANCELLABLE_ORDER_STATUSES = [
  'invoiced',
  'awaiting_required_payment',
  'required_payment_verified',
  'for_preparation',
  'for_shipping_or_pickup',
  'approved_for_release',
  'exceptional_release_pending',
  'dispatched_or_picked_up',
  'expired_overdue',
  'for_layaway',
  'keep',
] as const;

/** True when a Cancel Order action should be offered for this order status. */
export function canCancelOrderStatus(status: string): boolean {
  return (CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(status);
}
