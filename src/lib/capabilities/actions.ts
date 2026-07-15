'use server';

import { revalidatePath } from 'next/cache';

import {
  recordValidation,
  setCapabilityEnabled,
  type CapabilityKey,
} from '@/lib/capabilities/service';

/**
 * Phase 10 server actions (Bible §27, §14, §13).
 *
 * Transport only. Owner authority and the validation gate live in the domain
 * module and the database.
 */

export type CapabilityActionState = { error: string | null; success: string | null };

export const EMPTY_CAPABILITY_STATE: CapabilityActionState = {
  error: null,
  success: null,
};

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export async function recordValidationAction(
  _prev: CapabilityActionState,
  formData: FormData,
): Promise<CapabilityActionState> {
  const key = text(formData, 'capabilityKey');
  const device = text(formData, 'deviceOrVendor');
  const outcome = text(formData, 'outcome');
  const note = text(formData, 'evidenceNote');

  if (!key) return { error: 'A capability is required.', success: null };
  if (!device) return { error: 'Name the device or vendor you tested.', success: null };
  if (!note) return { error: 'Describe the evidence.', success: null };
  if (outcome !== 'passed' && outcome !== 'failed') {
    return { error: 'An outcome is required.', success: null };
  }

  const result = await recordValidation({
    capabilityKey: key as CapabilityKey,
    deviceOrVendor: device,
    outcome,
    evidenceNote: note,
  });

  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/capabilities');

  return {
    error: null,
    // Recording evidence is not enabling. Say so.
    success:
      outcome === 'passed'
        ? 'Validation recorded. The capability is still off — enabling it is a separate, deliberate step.'
        : 'Failed validation recorded. The capability stays off.',
  };
}

export async function setCapabilityAction(
  _prev: CapabilityActionState,
  formData: FormData,
): Promise<CapabilityActionState> {
  const key = text(formData, 'capabilityKey');
  const enabled = text(formData, 'enabled') === 'true';

  if (!key) return { error: 'A capability is required.', success: null };

  const result = await setCapabilityEnabled(key as CapabilityKey, enabled);
  if (!result.ok) return { error: result.error, success: null };

  revalidatePath('/admin/capabilities');

  return {
    error: null,
    success: enabled
      ? 'Capability enabled, backed by a passing real-device validation.'
      : 'Capability disabled. The manual fallback is in use — it always works.',
  };
}
