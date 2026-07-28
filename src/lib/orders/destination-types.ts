/**
 * Fulfillment destination for a For-Prepare order (Orders Workflow — For Prepare).
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
] as const;

export type FulfillmentDestination = (typeof FULFILLMENT_DESTINATIONS)[number];

/** The destinations offered in For Prepare (Owner request 2026-07-27). 'shipping'
 *  stays a valid stored value but is not offered — Delivery is used instead. */
export const OFFERED_DESTINATIONS: FulfillmentDestination[] = [
  'delivery',
  'pickup',
  'layaway',
  'keep',
  'cancelled',
];

export const DESTINATION_LABEL: Record<FulfillmentDestination, string> = {
  shipping: 'Shipping',
  delivery: 'Delivery',
  layaway: 'Layaway',
  pickup: 'Pickup',
  keep: 'Keep',
  cancelled: 'Cancelled',
};

/** Which Orders status card each destination routes the order to. */
export const DESTINATION_CARD: Record<FulfillmentDestination, string> = {
  shipping: 'Ship Confirm',
  delivery: 'Delivery',
  layaway: 'For Layaway',
  pickup: 'Pickup',
  keep: 'Keep',
  cancelled: 'For Cancel',
};
