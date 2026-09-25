import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { requireActiveStaff } from '@/lib/authz/guard';
import {
  DEFAULT_MESSAGE_SEQUENCE,
  DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
  DEFAULT_TEXT_SEND_ATTEMPTS,
  attemptSettingFor,
  isMessageSequence,
  parseScreenshotSendAttempts,
  parseTextSendAttempts,
  type MessageSequence,
} from '@/lib/capture/message-sequence';
import { createClient } from '@/lib/supabase/server';

/**
 * Settings → Live Selling / Messaging (Owner 2026-09-24): the Private Reply Sequence, the Text
 * Send Attempts (Screenshot First) and the Screenshot Send Attempts (Computation First, Owner
 * 2026-09-25), stored on the existing single-row Pancake settings table (migrations 20260924120000
 * and 20260925120000) and read/written only through Super-Admin-gated database functions — the
 * same pattern as the Private Reply sender. A change applies to NEW messaging flows; a capture
 * already in flight keeps the sequence it started with.
 */

export type MessagingSequenceSettings = {
  mode: MessageSequence;
  /** Text Send Attempts (Screenshot First). */
  attempts: number;
  /** Screenshot Send Attempts (Computation First). */
  screenshotAttempts: number;
  updatedAt: string | null;
  /** False when the database does not have the setting yet (migration not applied). */
  available: boolean;
  /** False when the database cannot store Computation First yet (migration 20260925120000). */
  computationFirstAvailable: boolean;
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
      screenshotAttempts: DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
      updatedAt: null,
      available: false,
      computationFirstAvailable: false,
    };
  }
  const row = data as {
    mode?: unknown;
    attempts?: unknown;
    screenshot_attempts?: unknown;
    updated_at?: unknown;
  };
  return {
    mode: isMessageSequence(row.mode) ? row.mode : DEFAULT_MESSAGE_SEQUENCE,
    attempts: parseTextSendAttempts(row.attempts) ?? DEFAULT_TEXT_SEND_ATTEMPTS,
    screenshotAttempts:
      parseScreenshotSendAttempts(row.screenshot_attempts) ?? DEFAULT_SCREENSHOT_SEND_ATTEMPTS,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
    available: true,
    // The database reports Screenshot Send Attempts only once it can store Computation First.
    computationFirstAvailable: 'screenshot_attempts' in row,
  };
}

export type SaveMessagingSequenceResult =
  | { ok: true; settings: MessagingSequenceSettings }
  | { ok: false; error: string };

/**
 * Save the sequence with ITS attempt setting: `attempts` is Text Send Attempts on Screenshot First
 * (and Classic, as before) and Screenshot Send Attempts on Computation First. The database keeps
 * the other setting's saved value.
 */
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
  const screenshotSetting = attemptSettingFor(input.mode) === 'screenshot';
  const attempts = screenshotSetting
    ? parseScreenshotSendAttempts(input.attempts)
    : parseTextSendAttempts(input.attempts);
  if (attempts === null) {
    return {
      ok: false,
      error: screenshotSetting
        ? 'Screenshot Send Attempts must be 1, 2 or 3.'
        : 'Text Send Attempts must be 1, 2 or 3.',
    };
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

  // Read back both attempt settings (the one saved and the one kept), as the database now has them.
  const saved = await getMessagingSequenceSettings();
  const row = (data ?? {}) as { updated_at?: unknown };
  return {
    ok: true,
    settings: {
      ...saved,
      mode: input.mode,
      ...(screenshotSetting ? { screenshotAttempts: attempts } : { attempts }),
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : saved.updatedAt,
      available: true,
    },
  };
}
