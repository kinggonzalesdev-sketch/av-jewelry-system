/**
 * State for the Team Members portal actions. Declared OUTSIDE the 'use server'
 * module. `reveal` carries a just-generated temp password to show the Owner ONCE.
 */
export type TeamActionState = {
  error: string | null;
  success: string | null;
  reveal: { email: string; tempPassword: string } | null;
};

export const EMPTY_TEAM_STATE: TeamActionState = {
  error: null,
  success: null,
  reveal: null,
};
