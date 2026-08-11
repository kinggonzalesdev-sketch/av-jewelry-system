/** Shared Test Mode types. Not `server-only` so client controls can import them. */

export type TestMode = {
  active: boolean;
  startedAt: string | null;
  startedByName: string | null;
};

export type TestModeResult = { ok: true; active: boolean } | { ok: false; error: string };

export type ResetTestResult =
  { ok: true; counts: Record<string, number> } | { ok: false; error: string };
