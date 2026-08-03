import { redirect } from 'next/navigation';

/**
 * Retired route (Owner request). Fulfillment moved INTO the Order View modal, and
 * the Owner Approval Center — the last thing this page still owned — now lives on
 * the Orders page. Nothing here is unique any more, so the route redirects instead
 * of showing a second, divergent copy of the same work.
 *
 * The page is kept (rather than deleted) so old links, bookmarks, and the waybill
 * sub-route at /orders/fulfillment/[officialOrderId]/waybill keep working.
 */
export const dynamic = 'force-dynamic';

export default function FulfillmentPage() {
  redirect('/orders');
}
