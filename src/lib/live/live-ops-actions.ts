'use server';

import { runSystemCheck } from '@/lib/live/system-check';
import type { SystemCheckResult } from '@/lib/live/system-check-types';
import { resetTestData, setTestMode } from '@/lib/live/test-mode';
import type { ResetTestResult, TestModeResult } from '@/lib/live/test-mode-types';

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
