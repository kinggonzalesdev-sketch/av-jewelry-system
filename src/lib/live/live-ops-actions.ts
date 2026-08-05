'use server';

import { runSystemCheck } from '@/lib/live/system-check';
import type { SystemCheckResult } from '@/lib/live/system-check-types';
import { resetTestData, setTestMode } from '@/lib/live/test-mode';
import type { ResetTestResult, TestModeResult } from '@/lib/live/test-mode-types';
import { endLiveSession, setLivePaused, startLiveSession } from '@/lib/live/live-session';
import type {
  LiveSessionResult,
  StartLiveSessionInput,
} from '@/lib/live/live-session-types';
import { listLiveErrors } from '@/lib/live/error-recovery';
import type { LiveErrorReport } from '@/lib/live/error-recovery-types';
import { listAuditEvents } from '@/lib/dashboard/service';
import type { ActivityRow } from '@/lib/live/activity-types';

/**
 * Live Operations actions (transport only). The authority + all reads live in the
 * domain modules; this just exposes them to the client panels.
 */
export async function runSystemCheckAction(): Promise<SystemCheckResult> {
  return runSystemCheck();
}

export async function setTestModeAction(active: boolean): Promise<TestModeResult> {
  return setTestMode(active);
}

export async function resetTestDataAction(): Promise<ResetTestResult> {
  return resetTestData();
}

export async function startLiveSessionAction(
  input: StartLiveSessionInput,
): Promise<LiveSessionResult> {
  return startLiveSession(input);
}

export async function endLiveSessionAction(): Promise<LiveSessionResult> {
  return endLiveSession();
}

export async function setLivePausedAction(paused: boolean): Promise<LiveSessionResult> {
  return setLivePaused(paused);
}

export async function listLiveErrorsAction(): Promise<LiveErrorReport> {
  return listLiveErrors();
}

export async function listRecentActivityAction(): Promise<ActivityRow[]> {
  return listAuditEvents();
}
