import { redirect } from 'next/navigation';

/**
 * Orders-first landing.
 *
 * The approved rule for PRODUCTION (Phase 3+), not implemented here:
 *   - a user with Orders access lands on Orders;
 *   - a user without Orders access lands on their first authorized page;
 *   - otherwise Not Authorized.
 *
 * The prototype has no permissions, so it always lands on Orders.
 */
export default function PreviewIndexPage() {
  redirect('/preview/orders');
}
