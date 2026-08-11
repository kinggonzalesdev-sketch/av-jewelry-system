/**
 * Shared types for the Pre-Live System Check. Deliberately NOT `server-only` so the
 * client panel can import them without dragging the server domain module (and its
 * next/headers Supabase client) into the browser bundle.
 */

export type CheckStatus = 'ready' | 'warning' | 'failed' | 'not_configured';

export type SystemCheckItem = {
  key: string;
  label: string;
  status: CheckStatus;
  /** One short line the operator reads — never a raw error or secret. */
  detail: string;
};

export type SystemCheckResult =
  { ok: true; items: SystemCheckItem[] } | { ok: false; error: string };
