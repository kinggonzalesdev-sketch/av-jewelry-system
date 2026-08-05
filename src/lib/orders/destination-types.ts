/**
 * Fulfillment destination for an order (Orders Workflow — Transfer to Destination).
 *
 * Pure constants shared by the server domain and the client UI (kept OUT of any
 * `'server-only'` module so a Client Component can import them without dragging
 * server code into the browser bundle).
 */

export const FULFILLMENT_DESTINATIONS = [
  'shipping',
  'delivery',
  'layaway',
  'pickup',
  'keep',
  'cancelled',
  'completed',
  'ship_confirm',
] as const;

export type FulfillmentDestination = (typeof FULFILLMENT_DESTINATIONS)[number];

/**
 * The destinations offered by Transfer to Destination (§6).
 *
 * `completed` (labelled "Complete Order") is offered ONLY when the order is
 * actually eligible — the caller filters it out otherwise, and
 * `transfer_order_destination` routes it through the same completion gate
 * regardless, so choosing it can never skip the fully-paid / fulfilled / waybill
 * checks. `ship_confirm` ("Ship Confirmed") advances a shipping order to the Ship
 * Confirm bucket (release approved).
 */
// Owner request 2026-08-05: "For Shipping" (shipping) and "For Cancel" (cancelled)
// were removed from the Transfer to Destination dropdown. Cancelling still goes
// through the dedicated Cancel Order flow; shipping-status orders are handled by
// Ship Confirmed. Both stay valid FulfillmentDestination values for existing data —
// they are just no longer OFFERED as transfer targets.
export const OFFERED_DESTINATIONS: FulfillmentDestination[] = [
  'ship_confirm',
  'delivery',
  'pickup',
  'layaway',
  'keep',
  'completed',
];

export const DESTINATION_LABEL: Record<FulfillmentDestination, string> = {
  shipping: 'For Shipping',
  ship_confirm: 'Ship Confirmed',
  delivery: 'For Delivery',
  layaway: 'Layaway',
  pickup: 'Pickup',
  keep: 'Keep',
  cancelled: 'For Cancel',
  completed: 'Complete Order',
};

/** Which Orders status card each destination routes the order to. */
export const DESTINATION_CARD: Record<FulfillmentDestination, string> = {
  // For Shipping is its own card now; Ship Confirm means release approved.
  shipping: 'For Shipping',
  ship_confirm: 'Ship Confirm',
  delivery: 'For Delivery',
  layaway: 'For Layaway',
  pickup: 'Pickup',
  keep: 'Keep',
  cancelled: 'For Cancel',
  completed: 'Completed',
};
