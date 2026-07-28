/**
 * State for the New Order manual-entry action. Declared OUTSIDE the 'use server'
 * module (a 'use server' file may export async functions only). Carries a
 * `receipt` payload so the client can print exactly what was recorded.
 */
export type OrderReceipt = {
  /** The saved Official Order id — used to record the print outcome + Reprint. */
  officialOrderId: string;
  orderNumber: string;
  invoiceNumber: string;
  itemCode: string;
  customerName: string;
  itemName: string;
  quantity: number;
  /** Unique per successful save, so the client prints each once. */
  printToken: string;
};

export type ManualOrderState = {
  error: string | null;
  success: string | null;
  receipt: OrderReceipt | null;
};

export const EMPTY_MANUAL_ORDER_STATE: ManualOrderState = {
  error: null,
  success: null,
  receipt: null,
};
