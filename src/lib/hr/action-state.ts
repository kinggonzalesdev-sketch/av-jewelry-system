/**
 * Action state — deliberately OUTSIDE the "use server" module (a "use server"
 * file may export async functions only).
 */

export type HrActionState = { error: string | null; success: string | null };

export const EMPTY_HR_STATE: HrActionState = { error: null, success: null };
