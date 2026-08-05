import 'server-only';

import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import type {
  ResetTestResult,
  TestMode,
  TestModeResult,
} from '@/lib/live/test-mode-types';

/**
 * Test Mode (Owner request, live-readiness). A single Super-Admin-controlled flag
 * that marks a private live-selling test session. Reading it is open to any active
 * staff member (the TEST MODE banner shows for everyone); the write goes through a
 * Super-Admin-gated SECURITY DEFINER function. This module manages the flag only —
 * tagging/isolating individual transactions is a follow-up increment.
 */

export async function getTestMode(): Promise<TestMode> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('live_test_state')
    .select('active, started_at, started_by')
    .maybeSingle();
  if (!data) return { active: false, startedAt: null, startedByName: null };

  let startedByName: string | null = null;
  if (data.active === true && data.started_by) {
    const { data: s } = await supabase
      .from('staff_profiles')
      .select('full_name')
      .eq('id', data.started_by as string)
      .maybeSingle<{ full_name: string }>();
    startedByName = s?.full_name ?? null;
  }

  return {
    active: data.active === true,
    startedAt: (data.started_at as string | null) ?? null,
    startedByName,
  };
}

/** Start (active=true) or end (active=false) the test session. Super Admin only. */
export async function setTestMode(active: boolean): Promise<TestModeResult> {
  const staff = await requireActiveStaff();
  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Super Admin can change Test Mode.' };
  }
  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('set_test_mode', { p_active: active })) as {
    data: boolean | null;
    error: { message: string } | null;
  };
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true, active: data === true };
}

/**
 * Delete every TEST-tagged record (orders, payments, invoices, labels, captures,
 * reminders + their children), children-first in one transaction. Super Admin only.
 * Does not touch inventory or production (is_test = false) rows.
 */
export async function resetTestData(): Promise<ResetTestResult> {
  const staff = await requireActiveStaff();
  if (staff.roleKey !== 'owner') {
    return { ok: false, error: 'Only the Super Admin can reset test data.' };
  }
  const supabase = await createClient();
  const { data, error } = (await supabase.rpc('reset_test_data')) as {
    data: Record<string, number> | null;
    error: { message: string } | null;
  };
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true, counts: data ?? {} };
}
