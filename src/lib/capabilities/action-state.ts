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

export type CapabilityActionState = { error: string | null; success: string | null };

export const EMPTY_CAPABILITY_STATE: CapabilityActionState = {
  error: null,
  success: null,
};
