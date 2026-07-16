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

export type ConfirmActionState = {
  error: string | null;
  /** Set when the claim IS confirmed. Never cleared by a print failure. */
  confirmed: { claimId: string; labelJobId: string; deduplicated: boolean } | null;
  /** Set when confirmation succeeded but the label did not reach paper. */
  printProblem: string | null;
  success: string | null;
};

export const EMPTY_CONFIRM_STATE: ConfirmActionState = {
  error: null,
  confirmed: null,
  printProblem: null,
  success: null,
};

export type LabelActionState = { error: string | null; success: string | null };

export const EMPTY_LABEL_STATE: LabelActionState = { error: null, success: null };
