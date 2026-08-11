import 'server-only';

import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import type { LiveErrorReport, LiveErrorRow } from '@/lib/live/error-recovery-types';

const LIMIT = 50;

/**
 * The Error Recovery Center reader (Live Operations). Surfaces the two failures a
 * live session can hit — an invoice/reminder that failed to auto-send, and a label
 * that failed to print — so the operator can see and retry them in one place.
 *
 * Purely read-only: retry reuses the order's existing Resend action. Reads are
 * RLS-scoped, so a caller only ever sees rows they may already read. Test-mode rows
 * are INCLUDED (tagged), so a private test surfaces its own failures for practice.
 */
export async function listLiveErrors(): Promise<LiveErrorReport> {
  await requireActiveStaff();
  const supabase = await createClient();

  // --- Failed message sends (the auto-deliver step marked them direct_send_failed).
  const messages: LiveErrorRow[] = [];
  const { data: msgData, error: msgErr } = await supabase
    .from('customer_messages')
    .select('id, official_order_id, customer_id, is_test, updated_at')
    .eq('status', 'direct_send_failed')
    .order('updated_at', { ascending: false })
    .limit(LIMIT);
  if (msgErr) return { ok: false, reason: msgErr.message };

  const msgRows = (msgData ?? []) as Array<Record<string, unknown>>;
  // Resolve customer names + order numbers in one round-trip each (tiny sets).
  const customerIds = [
    ...new Set(
      msgRows.map((r) => r.customer_id).filter((v): v is string => typeof v === 'string'),
    ),
  ];
  const orderIds = [
    ...new Set(
      msgRows
        .map((r) => r.official_order_id)
        .filter((v): v is string => typeof v === 'string'),
    ),
  ];
  const names = new Map<string, string>();
  if (customerIds.length) {
    const { data } = await supabase
      .from('customers')
      .select('id, display_name')
      .in('id', customerIds);
    for (const c of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
      names.set(c.id, c.display_name ?? '');
    }
  }
  const orderNos = new Map<string, string>();
  if (orderIds.length) {
    const { data } = await supabase
      .from('official_orders')
      .select('id, order_number')
      .in('id', orderIds);
    for (const o of (data ?? []) as Array<{ id: string; order_number: string | null }>) {
      orderNos.set(o.id, o.order_number ?? '');
    }
  }
  for (const r of msgRows) {
    const cid = typeof r.customer_id === 'string' ? r.customer_id : null;
    const oid = typeof r.official_order_id === 'string' ? r.official_order_id : null;
    const who = (cid && names.get(cid)) || 'Customer';
    const ord = oid && orderNos.get(oid) ? ` · ${orderNos.get(oid)}` : '';
    messages.push({
      id: r.id as string,
      kind: 'message',
      title: `${who}${ord}`,
      detail: null,
      occurredAt: (r.updated_at as string | null) ?? null,
      orderId: oid,
      isTest: Boolean(r.is_test),
    });
  }

  // --- Failed prints (label_jobs the printer rejected — status failed_print).
  const prints: LiveErrorRow[] = [];
  const { data: printData, error: printErr } = await supabase
    .from('label_jobs')
    .select(
      'id, item_code, item_name, customer_display_name, last_error, is_test, updated_at',
    )
    .eq('status', 'failed_print')
    .order('updated_at', { ascending: false })
    .limit(LIMIT);
  if (printErr) return { ok: false, reason: printErr.message };

  for (const r of (printData ?? []) as Array<Record<string, unknown>>) {
    const code = (r.item_code as string | null) ?? '';
    const name = (r.item_name as string | null) ?? '';
    const cust = (r.customer_display_name as string | null) ?? '';
    const label = [code, name].filter(Boolean).join(' — ') || 'Label';
    prints.push({
      id: r.id as string,
      kind: 'print',
      title: cust ? `${label} · ${cust}` : label,
      detail: (r.last_error as string | null) ?? null,
      occurredAt: (r.updated_at as string | null) ?? null,
      orderId: null,
      isTest: Boolean(r.is_test),
    });
  }

  return { ok: true, messages, prints };
}
