'use server';

import { runSystemCheck } from '@/lib/live/system-check';
import type { SystemCheckResult } from '@/lib/live/system-check-types';

/**
 * Live Operations actions (transport only). The authority + all reads live in the
 * domain module; this just exposes them to the client panel.
 */
export async function runSystemCheckAction(): Promise<SystemCheckResult> {
  return runSystemCheck();
}
