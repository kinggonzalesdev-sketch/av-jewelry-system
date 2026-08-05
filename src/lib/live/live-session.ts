import 'server-only';

import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { getSelectedPancakePage } from '@/lib/integrations/pancake';
import type {
  LiveMode,
  LivePausedState,
  LiveSession,
  LiveSessionFormData,
  LiveSessionResult,
  Operator,
  StartLiveSessionInput,
} from '@/lib/live/live-session-types';

/**
 * Live Session (Owner request, §3). One named session controls a live: operator,
 * mode (Review/Automatic), and Test/Production. Only ONE is active (the DB enforces
 * it), and its id is stamped on every screenshot/order/invoice/print job created
 * while it runs. Starting a TEST session turns Test Mode on so the inventory/message
 * safety already shipped applies. Super Admin only.
 */

function mode(v: unknown): LiveMode {
  return v === 'automatic' ? 'automatic' : 'review';
}

/** The currently-active session (with the operator's name), or null. */
export async function getActiveLiveSession(): Promise<LiveSession | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('live_sessions')
    .select('id, name, mode, is_test, started_at, operator_staff_id, paused_at')
    .eq('active', true)
    .maybeSingle();
  if (!data) return null;

  let operatorName: string | null = null;
  if (data.operator_staff_id) {
    const { data: s } = await supabase
      .from('staff_profiles')
      .select('full_name')
      .eq('id', data.operator_staff_id as string)
      .maybeSingle<{ full_name: string }>();
    operatorName = s?.full_name ?? null;
  }

  return {
    id: data.id as string,
    name: (data.name as string) ?? 'Live Session',
    operatorName,
    mode: mode(data.mode),
    isTest: data.is_test === true,
    startedAt: (data.started_at as string | null) ?? null,
    paused: (data.paused_at as string | null) != null,
  };
}

/** A cheap paused check for the app-wide banner — one indexed read, no joins. */
export async function getLivePausedState(): Promise<LivePausedState> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('live_sessions')
    .select('name, paused_at')
    .eq('active', true)
    .maybeSingle();
  if (!data || (data.paused_at as string | null) == null) {
    return { paused: false, sessionName: null };
  }
  return { paused: true, sessionName: (data.name as string | null) ?? null };
}

/** Active staff to choose the operator from (Super Admin reads all via RLS). */
async function listOperators(): Promise<Operator[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('staff_profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name');
  return ((data ?? []) as Array<{ id: string; full_name: string | null }>).map((r) => ({
    id: r.id,
    name: r.full_name ?? '—',
  }));
}

/** Everything the Start Live Session form needs. Super Admin only. */
export async function getLiveSessionFormData(): Promise<LiveSessionFormData> {
  const [active, operators, page] = await Promise.all([
    getActiveLiveSession(),
    listOperators(),
    getSelectedPancakePage(),
  ]);
  return {
    active,
    operators,
    facebookPageId: page?.pageId ?? null,
    facebookPageName: page?.pageName ?? null,
  };
}

export async function startLiveSession(
  input: StartLiveSessionInput,
): Promise<LiveSessionResult> {
  const staff = await requireActiveStaff();
  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Super Admin can start a live session.' };
  }
  const name = (input.name ?? '').trim();
  if (!name) return { ok: false, error: 'Enter a live session name.' };

  const page = await getSelectedPancakePage();
  const supabase = await createClient();
  const { error } = (await supabase.rpc('start_live_session', {
    p_name: name,
    p_operator: input.operatorStaffId,
    p_screenshot_device: null,
    p_printer_device: null,
    p_facebook_page_id: page?.pageId ?? null,
    p_mode: input.mode,
    p_is_test: input.isTest,
  })) as { data: string | null; error: { message: string } | null };
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true, session: await getActiveLiveSession() };
}

export async function endLiveSession(): Promise<LiveSessionResult> {
  const staff = await requireActiveStaff();
  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Super Admin can end a live session.' };
  }
  const supabase = await createClient();
  const { error } = (await supabase.rpc('end_live_session')) as {
    data: boolean | null;
    error: { message: string } | null;
  };
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true, session: null };
}

/**
 * Emergency pause / resume of the active live session (Super Admin only). While
 * paused, the database refuses all new order/capture intake — the operator can stop
 * taking orders instantly, then resume. Existing orders keep working throughout.
 */
export async function setLivePaused(paused: boolean): Promise<LiveSessionResult> {
  const staff = await requireActiveStaff();
  if (staff.roleKey !== 'owner') {
    return {
      ok: false,
      error: `Only the Super Admin can ${paused ? 'pause' : 'resume'} live selling.`,
    };
  }
  const supabase = await createClient();
  const { error } = (await supabase.rpc(
    paused ? 'pause_live_session' : 'resume_live_session',
  )) as { data: unknown; error: { message: string } | null };
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true, session: await getActiveLiveSession() };
}
