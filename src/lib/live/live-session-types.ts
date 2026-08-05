/** Shared Live Session types. Not `server-only` so the client controls can import. */

export type LiveMode = 'review' | 'automatic';

export type LiveSession = {
  id: string;
  name: string;
  operatorName: string | null;
  mode: LiveMode;
  isTest: boolean;
  startedAt: string | null;
};

export type Operator = { id: string; name: string };

export type StartLiveSessionInput = {
  name: string;
  operatorStaffId: string | null;
  mode: LiveMode;
  isTest: boolean;
};

export type LiveSessionFormData = {
  active: LiveSession | null;
  operators: Operator[];
  facebookPageId: string | null;
  facebookPageName: string | null;
};

export type LiveSessionResult =
  | { ok: true; session: LiveSession | null }
  | { ok: false; error: string };
