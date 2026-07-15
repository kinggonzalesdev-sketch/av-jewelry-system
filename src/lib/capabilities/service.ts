import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Conditional capability gating (Bible §27, §14, §13, §26; roadmap Phase 10).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  NO INTEGRATION HERE IS IMPLEMENTED OR VALIDATED.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The Xprinter XP-236B, Pancake, Meta, and native capture are all UNVERIFIED.
 * The Bible states the printer is "treated as unverified until tested" (§24.18).
 * This module builds the GATE, not the integrations — because an untested
 * integration that LOOKS functional is how a Live night discovers the printer
 * never worked.
 *
 * The roadmap's Phase 10 exit gate: real-device tests pass BEFORE readiness is
 * claimed; otherwise the feature stays off and launch proceeds on manual
 * fallback. That is enforced in the database, not here — a flag anyone can flip
 * without evidence is not a gate.
 */

export type CapabilityKey =
  | 'printer_xp236b_bluetooth'
  | 'pancake_adapter'
  | 'meta_direct_send'
  | 'android_floating_capture'
  | 'ios_share_intake';

export type CapabilityStatus = {
  key: CapabilityKey;
  label: string;
  bibleReference: string;
  isEnabled: boolean;
  hasPassingValidation: boolean;
  blockedReason: string;
  /** Always present. A disabled integration degrades the workflow, never blocks it. */
  manualFallback: string;
};

/** Reads every capability and its manual fallback. */
export async function listCapabilities(): Promise<CapabilityStatus[]> {
  const supabase = await createClient();
  const response = await supabase.rpc('capability_status');

  if (response.error || !response.data) return [];

  return (
    response.data as Array<{
      key: string;
      label: string;
      bible_reference: string;
      is_enabled: boolean;
      has_passing_validation: boolean;
      blocked_reason: string;
      manual_fallback: string;
    }>
  ).map((r) => ({
    key: r.key as CapabilityKey,
    label: r.label,
    bibleReference: r.bible_reference,
    isEnabled: r.is_enabled,
    hasPassingValidation: r.has_passing_validation,
    blockedReason: r.blocked_reason,
    manualFallback: r.manual_fallback,
  }));
}

/**
 * Whether a capability may be used right now.
 *
 * FAILS CLOSED: an unreadable flag is treated as OFF. If we cannot prove a
 * capability was validated, we must not use it — the manual fallback always
 * works, so falling back costs a little time, while wrongly assuming a printer
 * works costs a customer their label.
 */
export async function isCapabilityEnabled(key: CapabilityKey): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('conditional_capabilities')
    .select('is_enabled')
    .eq('key', key)
    .maybeSingle();

  if (error || !data) return false;

  return data.is_enabled === true;
}

/**
 * Records a real-device validation (§34 stages 12–14).
 *
 * Owner-only: this is the evidence that unlocks a capability, so it must not be
 * self-served by whoever wants the feature switched on.
 */
export async function recordValidation(input: {
  capabilityKey: CapabilityKey;
  deviceOrVendor: string;
  outcome: 'passed' | 'failed';
  evidenceNote: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let owner;
  try {
    owner = await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'capability.validation_recorded',
        entityType: 'conditional_capability',
        entityId: null,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  if (!input.deviceOrVendor?.trim() || !input.evidenceNote?.trim()) {
    return {
      ok: false,
      error:
        'A validation must name the device or vendor tested and describe the evidence.',
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('capability_validations').insert({
    capability_key: input.capabilityKey,
    device_or_vendor: input.deviceOrVendor.trim(),
    outcome: input.outcome,
    evidence_note: input.evidenceNote.trim(),
    tested_by: owner.staffProfileId,
  });

  if (error) return { ok: false, error: 'The validation could not be recorded.' };

  await recordAuditEvent({
    action: 'capability.validation_recorded',
    entityType: 'conditional_capability',
    context: {
      capability_key: input.capabilityKey,
      device_or_vendor: input.deviceOrVendor.trim(),
      outcome: input.outcome,
      // Recording evidence is not enabling. The Owner still has to flip it.
      capability_enabled_by_this_action: false,
    },
  });

  return { ok: true };
}

/**
 * Turns a capability on or off.
 *
 * Enabling is refused by the database unless a PASSING validation exists.
 * Disabling is always permitted — retreating to the manual fallback must never
 * be harder than staying on the untested path.
 */
export async function setCapabilityEnabled(
  key: CapabilityKey,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let owner;
  try {
    owner = await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: enabled ? 'capability.enable' : 'capability.disable',
        entityType: 'conditional_capability',
        outcome: 'denied',
        reason: cause.message,
        context: { capability_key: key },
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('conditional_capabilities')
    .update(
      enabled
        ? {
            is_enabled: true,
            validated_at: new Date().toISOString(),
            validated_by: owner.staffProfileId,
          }
        : { is_enabled: false },
    )
    .eq('key', key);

  if (error) {
    await recordAuditEvent({
      action: enabled ? 'capability.enable' : 'capability.disable',
      entityType: 'conditional_capability',
      outcome: 'failed',
      reason: error.message,
      context: { capability_key: key },
    });
    // The database explains exactly why the gate refused. Surface it.
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: enabled ? 'capability.enable' : 'capability.disable',
    entityType: 'conditional_capability',
    context: {
      capability_key: key,
      backed_by_passing_validation: enabled,
      manual_fallback_remains_available: true,
    },
  });

  return { ok: true };
}
