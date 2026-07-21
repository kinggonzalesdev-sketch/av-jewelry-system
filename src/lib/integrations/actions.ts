'use server';

import { testPancakeConnection } from '@/lib/integrations/pancake';
import type { IntegrationActionState } from '@/lib/integrations/action-state';

/** Integration server actions. Transport only — authority (Owner) and the real
 *  connection attempt live in the domain module. */

export async function testPancakeAction(
  _prev: IntegrationActionState,
  _formData: FormData,
): Promise<IntegrationActionState> {
  const result = await testPancakeConnection();
  return result.ok
    ? { error: null, success: result.message }
    : { error: result.message, success: null };
}
