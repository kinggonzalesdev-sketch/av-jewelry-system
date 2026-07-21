export type IntegrationActionState = { error: string | null; success: string | null };

export const EMPTY_INTEGRATION_STATE: IntegrationActionState = {
  error: null,
  success: null,
};
