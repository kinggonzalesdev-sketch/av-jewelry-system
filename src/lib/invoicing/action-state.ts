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

export type InvoiceActionState = {
  error: string | null;
  success: string | null;
  /** Set when the ORDER exists. Never cleared by a message failure. */
  order: { officialOrderId: string; orderNumber: string; invoiceNumber: string } | null;
  /** Set when the order was created but the message did not go out. */
  messageProblem: string | null;
  /** The prepared message body, for Copy Invoice Message. */
  messageBody: string | null;
  messageId: string | null;
};

export const EMPTY_INVOICE_STATE: InvoiceActionState = {
  error: null,
  success: null,
  order: null,
  messageProblem: null,
  messageBody: null,
  messageId: null,
};
