import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Audit writing (Bible §31).
 *
 * Rules this module exists to enforce:
 *   - Attribution is captured from the VERIFIED SESSION, never from client input
 *     (§31). A caller cannot claim to be someone else.
 *   - `actor_label` is an immutable SNAPSHOT taken at event time, so attribution
 *     survives rename, reassignment, and deactivation (§31).
 *   - Failed and DENIED actions are logged too, not just successes (§31 r7).
 *     "Nothing happened" is itself a fact worth recording.
 *   - Context never carries secrets (§31 r12).
 *
 * The table is append-only at the database level; there is no update or delete
 * path here because none exists there.
 */

export type AuditOutcome = 'succeeded' | 'failed' | 'denied';

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: AuditOutcome;
  reason?: string | null;
  context?: Record<string, unknown>;
};

/**
 * Writes one audit event attributed to the current session.
 *
 * Deliberately never throws. An audit write must not be able to roll back or
 * mask the outcome of the action it describes — a failure to log is a logging
 * problem, surfaced to the server console, not a reason to tell the user their
 * action failed when it did not.
 */
export async function recordAuditEvent(entry: AuditEntry): Promise<void> {
  try {
    const supabase = await createClient();

    // Identity comes from the session. Never a parameter.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return;
    }

    // Snapshot the label now — §31 requires attribution to survive later renames.
    const { data: profile } = await supabase
      .from('staff_profiles')
      .select('full_name, role_key')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    const actorLabel = profile
      ? `${profile.full_name as string} (${profile.role_key as string})`
      : (user.email ?? 'unknown');

    await supabase.from('audit_events').insert({
      actor_auth_uid: user.id,
      actor_kind: 'staff',
      actor_label: actorLabel,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      outcome: entry.outcome ?? 'succeeded',
      reason: entry.reason ?? null,
      context: entry.context ?? {},
    });
  } catch (cause) {
    // Never rethrow: see the note above.
    console.error('audit: failed to record event', entry.action, cause);
  }
}

/**
 * Records a refused action (§31 r7).
 *
 * A denial is a real event: it proves the boundary held. Call this from the
 * catch side of an authorization failure so "someone tried and was refused"
 * is recoverable later.
 */
export async function recordDeniedAction(
  action: string,
  entityType: string,
  reason: string,
  context?: Record<string, unknown>,
): Promise<void> {
  await recordAuditEvent({
    action,
    entityType,
    outcome: 'denied',
    reason,
    // Spread rather than assign: `exactOptionalPropertyTypes` treats an explicit
    // `undefined` as different from an absent key.
    ...(context ? { context } : {}),
  });
}
