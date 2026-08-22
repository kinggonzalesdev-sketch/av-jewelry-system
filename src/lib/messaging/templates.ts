import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  EDITABLE_TEMPLATE_KEYS,
  renderTemplate,
  SUPPORTED_TOKENS,
  tokensUsed,
  unsupportedTokens,
  type TemplateKey,
} from '@/lib/messaging/template-vars';
import { AUTO_TEXT_KEY, AUTO_TEXT_TOKENS } from '@/lib/messaging/auto-text';
import { getOrderDetail } from '@/lib/orders/detail';
import { formatPeso } from '@/lib/payments/format';

/** The shop name used by {shop_name}. */
const SHOP_NAME = 'A.V. Jewelry';

const PAYMENT_STATUS_WORD: Record<string, string> = {
  paid_in_full: 'Paid in Full',
  partial: 'Partially paid',
  awaiting: 'Awaiting payment',
  unavailable: '',
};

/**
 * Message templates (Owner request) — the four customer-facing messages, stored in
 * the database so wording changes need no deploy.
 *
 * Two deliberately separate paths:
 *   - EDITING (read the raw body, save, reset, read history) is Super Admin only.
 *   - RENDERING for an order is available to whoever may work that order, because
 *     an Admin must be able to SEND the message without being able to change it.
 */

export type MessageTemplate = {
  key: TemplateKey;
  label: string;
  body: string;
  defaultBody: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

export type TemplateHistoryEntry = {
  id: string;
  previousBody: string;
  updatedByName: string | null;
  updatedAt: string;
};

export type TemplateMutationResult = { ok: true } | { ok: false; error: string };

/** Resolve staff ids → names for the "Updated By" columns. */
async function namesFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => typeof v === 'string'))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await supabase
    .from('staff_profiles')
    .select('id, full_name')
    .in('id', unique);
  for (const row of (data ?? []) as Array<{ id: string; full_name: string | null }>) {
    names.set(row.id, row.full_name ?? '');
  }
  return names;
}

/** The editable templates. Super Admin only — this is the RAW wording. */
export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  await requireOwner();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('message_templates')
    .select('key, label, body, default_body, updated_at, updated_by')
    // Only the EDITABLE keys — so a retired row (reminder_2/3) or a key that is no
    // longer editable from Settings (reminder_1, Owner request 2026-08-05) never
    // resurfaces in the editor even if it lingers in the table.
    .in('key', [...EDITABLE_TEMPLATE_KEYS])
    .order('key');
  if (error || !data) return [];

  const rows = data as Array<Record<string, unknown>>;
  const names = await namesFor(
    supabase,
    rows.map((r) => (r.updated_by as string | null) ?? null),
  );

  return rows.map((r) => ({
    key: r.key as TemplateKey,
    label: (r.label as string) ?? (r.key as string),
    body: (r.body as string) ?? '',
    defaultBody: (r.default_body as string) ?? '',
    updatedAt: (r.updated_at as string | null) ?? null,
    updatedByName:
      typeof r.updated_by === 'string' ? (names.get(r.updated_by) ?? null) : null,
  }));
}

/** Previous versions of ONE template, newest first. Super Admin only. */
export async function getTemplateHistory(
  key: TemplateKey,
): Promise<TemplateHistoryEntry[]> {
  await requireOwner();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('message_template_history')
    .select('id, previous_body, updated_by, updated_at')
    .eq('template_key', key)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];

  const rows = data as Array<Record<string, unknown>>;
  const names = await namesFor(
    supabase,
    rows.map((r) => (r.updated_by as string | null) ?? null),
  );

  return rows.map((r) => ({
    id: r.id as string,
    previousBody: (r.previous_body as string) ?? '',
    updatedByName:
      typeof r.updated_by === 'string' ? (names.get(r.updated_by) ?? null) : null,
    updatedAt: r.updated_at as string,
  }));
}

/**
 * The BODY of one template for rendering a real message. Readable by any active
 * staff member — an Admin sends the message without being able to edit it. Returns
 * null when it cannot be read, so a caller never sends a half-built message.
 */
export async function getTemplateBody(key: TemplateKey): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('message_templates')
    .select('body')
    .eq('key', key)
    .maybeSingle();
  return (data?.body as string | undefined) ?? null;
}

/** Save a template (Super Admin). The database keeps the previous body in history. */
export async function saveMessageTemplate(
  key: TemplateKey,
  body: string,
): Promise<TemplateMutationResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  if (!body.trim()) return { ok: false, error: 'A message template cannot be blank.' };
  // Each template validates against its OWN variable whitelist — the AUTO TEXT set is different from
  // the Invoice/Reminder set, so a valid {price_per_gram} is never rejected as "unsupported".
  const supported = key === AUTO_TEXT_KEY ? AUTO_TEXT_TOKENS : SUPPORTED_TOKENS;
  const unknown = unsupportedTokens(body, supported);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unsupported variable${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. Use only the variables listed.`,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('save_message_template', {
    p_key: key,
    p_body: body,
  });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'message_template.save',
    entityType: 'message_template',
    entityId: key,
  });
  return { ok: true };
}

/** Restore a template to its shipped default (Super Admin). History is kept. */
export async function resetMessageTemplate(
  key: TemplateKey,
): Promise<TemplateMutationResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('reset_message_template', { p_key: key });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'message_template.reset',
    entityType: 'message_template',
    entityId: key,
  });
  return { ok: true };
}

/**
 * Render one template for a REAL order.
 *
 * Available to anyone who may read the order — an Admin sends the message without
 * being able to edit its wording. Returns the missing tokens alongside the text so
 * a caller can refuse to send a message with holes in it rather than shipping
 * "Balance: " to a customer.
 */
export async function renderOrderMessage(
  officialOrderId: string,
  key: TemplateKey,
): Promise<
  { ok: true; message: string; missing: string[] } | { ok: false; error: string }
> {
  const body = await getTemplateBody(key);
  if (body === null) {
    return { ok: false, error: 'That message template could not be read.' };
  }

  const detail = await getOrderDetail(officialOrderId);
  if (!detail.ok) return { ok: false, error: detail.reason };

  const d = detail.detail;
  const a = d.amounts;
  const items = d.items.map((i) => i.itemName ?? i.itemCode).filter(Boolean);
  const gramsTotal = d.items.reduce(
    (sum, i) => sum + (Number(i.gramsPerPiece) || 0) * (i.quantity || 0),
    0,
  );

  const values: Record<string, string> = {
    '{customer_name}': d.customer.displayName,
    '{order_number}': d.orderNumber,
    '{invoice_number}': d.invoiceNumber,
    '{total_amount}': a.unavailable ? '' : formatPeso(a.totalAmountPayable),
    '{balance}': a.unavailable ? '' : formatPeso(a.outstandingBalance),
    '{due_date}': d.layaway?.finalDueDate ?? '',
    '{item_name}': items.join(', '),
    '{grams}': gramsTotal > 0 ? String(Math.round(gramsTotal * 1000) / 1000) : '',
    '{payment_status}': PAYMENT_STATUS_WORD[d.paymentStatus] ?? '',
    '{shop_name}': SHOP_NAME,
    '{contact_number}': d.customer.contactNumber ?? '',
  };

  // Tokens the template asks for but this order cannot fill.
  const missing = tokensUsed(body).filter((t) => !values[t]);

  return { ok: true, message: renderTemplate(body, values), missing };
}
