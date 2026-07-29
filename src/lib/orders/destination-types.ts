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
] as const;

export type FulfillmentDestination = (typeof FULFILLMENT_DESTINATIONS)[number];

/**
 * The destinations offered by Transfer to Destination (§6).
 *
 * `completed` is offered ONLY when the order is actually eligible — the caller
 * filters it out otherwise, and `transfer_order_destination` routes it through the
 * same completion gate regardless, so choosing it can never skip the fully-paid
 * and fulfilled checks.
 */
export const OFFERED_DESTINATIONS: FulfillmentDestination[] = [
  'shipping',
  'delivery',
  'pickup',
  'layaway',
  'keep',
  'cancelled',
  'completed',
];

export const DESTINATION_LABEL: Record<FulfillmentDestination, string> = {
  shipping: 'For Shipping',
  delivery: 'Delivery',
  layaway: 'Layaway',
  pickup: 'Pickup',
  keep: 'Keep',
  cancelled: 'For Cancel',
  completed: 'Completed',
};

/** Which Orders status card each destination routes the order to. */
export const DESTINATION_CARD: Record<FulfillmentDestination, string> = {
  // For Shipping is its own card now; Ship Confirm means release approved.
  shipping: 'For Shipping',
  delivery: 'Delivery',
  layaway: 'For Layaway',
  pickup: 'Pickup',
  keep: 'Keep',
  cancelled: 'For Cancel',
  completed: 'Completed',
};
