'use server';

import type { DashboardActionState } from '@/lib/dashboard/action-state';
import { EMPTY_DASHBOARD_STATE } from '@/lib/dashboard/action-state';
import { revalidatePath } from 'next/cache';

import { acknowledgeNotification, getSalesSummary } from '@/lib/dashboard/service';

/**
 * Phase 9 server actions (Bible §7, §25, §26).
 *
 * Transport only. Authority, the export gate, and audit live in the domain
 * module and the database.
 */

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Manual refresh (§7). Re-reads; changes nothing.
 *
 * There is genuinely nothing to await — invalidating the cache is synchronous —
 * but Next requires every Server Action to be declared `async`, and that
 * contract is not negotiable. So `require-await` is disabled here rather than
 * faking an await, which would be the same thing wearing a disguise.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function refreshDashboardAction(
  _prev: DashboardActionState,
  _formData: FormData,
): Promise<DashboardActionState> {
  revalidatePath('/dashboard');
  return { ...EMPTY_DASHBOARD_STATE, success: 'Refreshed.' };
}

export async function acknowledgeNotificationAction(
  _prev: DashboardActionState,
  formData: FormData,
): Promise<DashboardActionState> {
  const id = text(formData, 'notificationId');
  if (!id) return { ...EMPTY_DASHBOARD_STATE, error: 'A reminder is required.' };

  const result = await acknowledgeNotification(id);
  if (!result.ok) return { ...EMPTY_DASHBOARD_STATE, error: result.error };

  revalidatePath('/dashboard');
  return {
    ...EMPTY_DASHBOARD_STATE,
    // Says plainly that nothing else moved.
    success: 'Reminder acknowledged. No business record changed.',
  };
}

export async function runSalesReportAction(
  _prev: DashboardActionState,
  formData: FormData,
): Promise<DashboardActionState> {
  const from = text(formData, 'from');
  const to = text(formData, 'to');

  if (!from || !to) {
    return { ...EMPTY_DASHBOARD_STATE, error: 'A date range is required.' };
  }

  const result = await getSalesSummary(
    new Date(from).toISOString(),
    new Date(to).toISOString(),
  );

  if (!result.ok) return { ...EMPTY_DASHBOARD_STATE, error: result.error };

  return {
    ...EMPTY_DASHBOARD_STATE,
    report: result.data,
    success: 'Report generated from records you can already see.',
  };
}
