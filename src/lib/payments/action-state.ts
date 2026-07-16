/**
 * Action state — deliberately OUTSIDE the "use server" module.
 *
 * Next.js allows a "use server" file to export async functions ONLY. Exporting
 * a plain object from one makes the whole server-actions module fail to
 * evaluate at request time, which takes down every action on the page — not
 * just the one that touched the object. The build does not catch it; nothing
 * fails until a user presses a button.
 *
 * So the shape and its empty value live here, and actions.ts imports the type.
 */

export type PaymentActionState = { error: string | null; success: string | null };

export const EMPTY_PAYMENT_STATE: PaymentActionState = { error: null, success: null };

/**
 * Recording carries one extra fact the caller must see: whether the reference
 * number collided with an existing payment. It is FLAGGED, never rejected
 * (approved decision §3) — rejecting it would hide the collision instead of
 * putting it in front of a human.
 */
export type RecordPaymentActionState = PaymentActionState & {
  duplicateReferenceFlagged: boolean;
};

export const EMPTY_RECORD_PAYMENT_STATE: RecordPaymentActionState = {
  error: null,
  success: null,
  duplicateReferenceFlagged: false,
};
