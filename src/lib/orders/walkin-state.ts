/**
 * State for the Walk-In sale action. Declared OUTSIDE the 'use server' module
 * (a 'use server' file may export async functions only).
 */
export type WalkInOrderState = {
  error: string | null;
  success: string | null;
  order: { orderNumber: string; invoiceNumber: string; itemCode: string } | null;
};

export const EMPTY_WALKIN_STATE: WalkInOrderState = {
  error: null,
  success: null,
  order: null,
};
