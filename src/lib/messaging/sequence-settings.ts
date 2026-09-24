import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { requireActiveStaff } from '@/lib/authz/guard';
import {
  DEFAULT_MESSAGE_SEQUENCE,
  DEFAULT_TEXT_SEND_ATTEMPTS,
  isMessageSequence,
  parseTextSendAttempts,
  type MessageSequence,
} from '@/lib/capture/message-sequence';
import { createClient } from '@/lib/supabase/server';

/**
 * Settings → Live Selling / Messaging (Owner 2026-09-24): the Private Reply Sequence and the
 * Text Send Attempts, stored on the existing single-row Pancake settings table (migration
 * 20260924120000) and read/written only through Super-Admin-gated database functions — the
 * same pattern as the Private Reply sender. A change applies to NEW messaging flows; a capture
 * already in flight keeps the sequence it started with.
 */

export type MessagingSequenceSettings = {
  mode: MessageSequence;
  attempts: number;
  updatedAt: string | null;
  /** False when the database does not have the setting yet (migration not applied). */
  available: boolean;
};

export async function getMessagingSequenceSettings(): Promise<MessagingSequenceSettings> {
  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('get_capture_messaging_settings')) as {
    data: unknown;
    error: unknown;
  };
  if (error || !data || typeof data !== 'object') {
    return {
      mode: DEFAULT_MESSAGE_SEQUENCE,
      attempts: DEFAULT_TEXT_SEND_ATTEMPTS,
      updatedAt: null,
      available: false,
    };
  }
  const row = data as { mode?: unknown; attempts?: unknown; updated_at?: unknown };
  return {
    mode: isMessageSequence(row.mode) ? row.mode : DEFAULT_MESSAGE_SEQUENCE,
    attempts: parseTextSendAttempts(row.attempts) ?? DEFAULT_TEXT_SEND_ATTEMPTS,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    available: true,
  };
}

export type SaveMessagingSequenceResult =
  | { ok: true; settings: MessagingSequenceSettings }
  | { ok: false; error: string };

export async function saveMessagingSequenceSettings(input: {
  mode: string;
  attempts: number;
}): Promise<SaveMessagingSequenceResult> {
  const staff = await requireActiveStaff();
  // Super Admin = the owner role. The database function refuses anyone else as well.
  if (staff.roleKey !== 'owner') {
    await recordAuditEvent({
      action: 'settings.messaging_sequence',
      entityType: 'settings',
      outcome: 'denied',
      reason: 'not_super_admin',
    }).catch(() => undefined);
    return { ok: false, error: 'Only the Super Admin can change the messaging sequence.' };
  }
  if (!isMessageSequence(input.mode)) {
    return { ok: false, error: 'Choose a Private Reply Sequence.' };
  }
  const attempts = parseTextSendAttempts(input.attempts);
  if (attempts === null) {
    return { ok: false, error: 'Text Send Attempts must be 1, 2 or 3.' };
  }

  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('save_capture_messaging_settings', {
    p_mode: input.mode,
    p_attempts: attempts,
  })) as { data: unknown; error: unknown };
  if (error) {
    await recordAuditEvent({
      action: 'settings.messaging_sequence',
      entityType: 'settings',
      outcome: 'failed',
      reason: 'save_failed',
      context: { mode: input.mode, attempts },
    }).catch(() => undefined);
    return {
      ok: false,
      error:
        'The setting could not be saved. If this keeps happening, the database update for this setting may not be applied yet.',
    };
  }
  await recordAuditEvent({
    action: 'settings.messaging_sequence',
    entityType: 'settings',
    outcome: 'succeeded',
    context: { mode: input.mode, attempts },
  }).catch(() => undefined);

  const row = (data ?? {}) as { updated_at?: unknown };
  return {
    ok: true,
    settings: {
      mode: input.mode,
      attempts,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      available: true,
    },
  };
}
