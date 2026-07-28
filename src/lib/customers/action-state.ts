/**
 * Customer action state — declared OUTSIDE the 'use server' module (a 'use server'
 * file may export async functions only).
 */
export type CustomerActionState = { error: string | null; success: string | null };

export const EMPTY_CUSTOMER_STATE: CustomerActionState = { error: null, success: null };
