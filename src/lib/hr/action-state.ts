/**
 * Action state — deliberately OUTSIDE the "use server" module (a "use server"
 * file may export async functions only).
 */

export type HrActionState = {
  error: string | null;
  success: string | null;
  /** Set by a successful clock-in so the client can attach the selfie to the new
   *  attendance record. Absent for every other HR action. */
  recordId?: string | null;
};

export const EMPTY_HR_STATE: HrActionState = { error: null, success: null };
