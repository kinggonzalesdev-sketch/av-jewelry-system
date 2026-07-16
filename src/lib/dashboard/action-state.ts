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

export type DashboardActionState = {
  error: string | null;
  success: string | null;
  report: {
    from: string;
    to: string;
    verifiedCollected: string;
    paymentsRecorded: number;
    paymentsVerified: number;
    paymentsUnverified: number;
  } | null;
};

export const EMPTY_DASHBOARD_STATE: DashboardActionState = {
  error: null,
  success: null,
  report: null,
};
