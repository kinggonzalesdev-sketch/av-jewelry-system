import 'server-only';

import { requirePermission } from '@/lib/authz/guard';
import { conversationBelongsToPage, getActivePancakePageId } from '@/lib/integrations/pancake';
import {
  getTemplateBody,
  invoiceMissingTokens,
  renderOrderMessage,
} from '@/lib/messaging/templates';
import {
  claimSkipReason,
  invoiceEligibility,
  invoiceSendState,
  matchesInvoiceFilter,
  reminderEligibility,
  type BulkRowOutcome,
  type InvoiceFilter,
  type InvoiceRowFacts,
  type InvoiceSendState,
  type Verdict,
} from '@/lib/orders/bulk-invoice-rules';
import { sendOrderInvoice, sendOrderReminder } from '@/lib/orders/for-invoice';
import { computeOrderGramsPricing } from '@/lib/orders/grams-pricing';
import { getOrderLineItemsByOrder } from '@/lib/orders/service';
import { getOrderBalances } from '@/lib/payments/balances';
import { createClient } from '@/lib/supabase/server';

/**
 * Orders → For Invoice → "Send Invoices" (Owner 2026-09-25): list the For Invoice orders with
 * their send state, chat link and readiness, and send / remind many at once.
 *
 * Reuse, not a second path: every send goes through sendOrderInvoice (the individual Send
 * Invoice: same message, same grams / price per gram / Fixed Price, same stored chat, text
 * only) and every reminder through sendOrderReminder (record_order_reminder's rules). This
 * module only adds the list (batched: a fixed handful of queries per page, never one per row)
 * and the database claim that makes a double click or a second tab unable to send twice.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The For Invoice card's orders: For Invoice + the retired For Reminder, not yet routed. */
const FOR_INVOICE_STATUSES = ['invoiced', 'awaiting_required_payment'];
/** A safety cap on one list read (the card normally holds tens of orders). */
const MAX_SCOPE = 2000;
export const INVOICE_LIST_PAGE_SIZE = 25;

type BaseRow = {
  orderId: string;
  orderStatus: string;
  customerId: string;
  customerName: string;
  chat: 'order' | 'customer' | null;
  messageStatus: string | null;
  sendState: InvoiceSendState;
  sentAt: string | null;
  sentManually: boolean;
};

export type InvoiceSendRow = {
  orderId: string;
  customerName: string;
  itemCount: number;
  /** The confirmed items' codes (what the operator recognises; searchable). */
  itemCodes: string[];
  chat: 'order' | 'customer' | null;
  sendState: InvoiceSendState;
  sentAt: string | null;
  sentManually: boolean;
  reminderCount: number;
  lastReminderAt: string | null;
  invoice: Verdict;
  reminder: Verdict & { nextNumber: number | null };
};

export type InvoiceSendList = {
  rows: InvoiceSendRow[];
  counts: Record<InvoiceFilter, number>;
  /** Rows matching the current filter + search (all pages). */
  total: number;
  page: number;
  pageSize: number;
};

function one<T>(value: unknown): T | undefined {
  if (Array.isArray(value)) return value[0] as T | undefined;
  return (value as T) ?? undefined;
}

/** The For Invoice orders (or just `ids`), with their chat link and send state. 2 queries. */
async function loadBaseRows(
  supabase: Supabase,
  ids?: ReadonlyArray<string>,
): Promise<BaseRow[]> {
  let q = supabase
    .from('official_orders')
    .select(
      'id, status, customer_id, fb_pancake_conversation_id, customers ( display_name, pancake_conversation_id )',
    )
    .in('status', FOR_INVOICE_STATUSES)
    .is('fulfillment_destination', null);
  if (ids) q = q.in('id', [...ids]);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(MAX_SCOPE);
  if (error || !data) return [];
  const orders = data as Array<{
    id: string;
    status: string;
    customer_id: string;
    fb_pancake_conversation_id: string | null;
    customers: unknown;
  }>;
  if (orders.length === 0) return [];

  const { data: msgData } = await supabase
    .from('customer_messages')
    .select('official_order_id, status, updated_at, auto_sent_at, manually_sent_at, created_at')
    .in(
      'official_order_id',
      orders.map((o) => o.id),
    )
    .order('created_at', { ascending: false });
  const latest = new Map<
    string,
    { status: string | null; updated_at: string | null; auto_sent_at: string | null; manually_sent_at: string | null }
  >();
  for (const m of (msgData ?? []) as Array<{
    official_order_id: string;
    status: string | null;
    updated_at: string | null;
    auto_sent_at: string | null;
    manually_sent_at: string | null;
  }>) {
    if (!latest.has(m.official_order_id)) latest.set(m.official_order_id, m);
  }

  const activePage = await getActivePancakePageId();
  const now = Date.now();
  return orders.map((o) => {
    const c = one<{ display_name: string | null; pancake_conversation_id: string | null }>(
      o.customers,
    );
    const msg = latest.get(o.id);
    // The SAME stored-chat choice Send Invoice makes: the order's own chat, else the
    // customer's default link — only on the active page, never a name match.
    const chat = conversationBelongsToPage(o.fb_pancake_conversation_id, activePage)
      ? ('order' as const)
      : conversationBelongsToPage(c?.pancake_conversation_id, activePage)
        ? ('customer' as const)
        : null;
    const sendState = invoiceSendState(msg?.status ?? null, msg?.updated_at ?? null, now);
    return {
      orderId: o.id,
      orderStatus: o.status,
      customerId: o.customer_id,
      customerName: (c?.display_name ?? '').trim() || 'Unknown customer',
      chat,
      messageStatus: msg?.status ?? null,
      sendState,
      sentAt:
        sendState === 'sent' ? (msg?.auto_sent_at ?? msg?.manually_sent_at ?? null) : null,
      sentManually: msg?.status === 'manually_sent',
    };
  });
}

/** Characters that would change a PostgREST ilike filter's meaning. */
const UNSAFE_FOR_ILIKE = /[%_*\\"]/;

/** How many OTHER active customers share each customer's exact name (case-insensitive). One
 *  query for the whole page. A name that cannot be matched safely maps to null (unchecked). */
async function sameNameCounts(
  supabase: Supabase,
  rows: ReadonlyArray<BaseRow>,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const safe = rows.filter((r) => {
    const ok = r.customerName !== 'Unknown customer' && !UNSAFE_FOR_ILIKE.test(r.customerName);
    if (!ok) out.set(r.customerId, null);
    return ok;
  });
  if (safe.length === 0) return out;
  const names = [...new Set(safe.map((r) => r.customerName))];
  const { data, error } = await supabase
    .from('customers')
    .select('id, display_name')
    .eq('is_active', true)
    .or(names.map((n) => `display_name.ilike."${n}"`).join(','))
    .limit(1000);
  if (error || !data) {
    for (const r of safe) out.set(r.customerId, null);
    return out;
  }
  const people = data as Array<{ id: string; display_name: string | null }>;
  for (const r of safe) {
    const key = r.customerName.toLowerCase();
    out.set(
      r.customerId,
      people.filter(
        (p) => p.id !== r.customerId && (p.display_name ?? '').trim().toLowerCase() === key,
      ).length,
    );
  }
  return out;
}

/** Everything a verdict needs for these rows, in batched reads (items, template, balances,
 *  reminders, same-name) — a fixed number of queries whatever the page size. */
async function enrich(
  supabase: Supabase,
  rows: ReadonlyArray<BaseRow>,
): Promise<Array<{ base: BaseRow; facts: InvoiceRowFacts; row: InvoiceSendRow }>> {
  const ids = rows.map((r) => r.orderId);
  const [itemsByOrder, invoiceBody, balances, reminderData, sameName] = await Promise.all([
    getOrderLineItemsByOrder(ids),
    getTemplateBody('invoice'),
    getOrderBalances(ids).catch(() => new Map()),
    supabase
      .from('order_reminders')
      .select('official_order_id, reminder_number, sent_at')
      .in('official_order_id', ids),
    sameNameCounts(
      supabase,
      rows.filter((r) => r.chat === 'customer'),
    ),
  ]);
  const reminders = new Map<string, { count: number; last: string | null }>();
  for (const r of (reminderData.data ?? []) as Array<{
    official_order_id: string;
    sent_at: string | null;
  }>) {
    const cur = reminders.get(r.official_order_id) ?? { count: 0, last: null };
    cur.count += 1;
    if (r.sent_at && (!cur.last || r.sent_at > cur.last)) cur.last = r.sent_at;
    reminders.set(r.official_order_id, cur);
  }

  return rows.map((base) => {
    const items = itemsByOrder.get(base.orderId) ?? [];
    const missing =
      invoiceBody === null ? null : invoiceMissingTokens(invoiceBody, computeOrderGramsPricing(items));
    const balance = balances.get(base.orderId) as
      | { ok: true; balance: { paidInFull: boolean } }
      | { ok: false }
      | undefined;
    const rem = reminders.get(base.orderId) ?? { count: 0, last: null };
    const facts: InvoiceRowFacts = {
      orderStatus: base.orderStatus,
      sendState: base.sendState,
      chat: base.chat,
      sameNameCount: base.chat === 'customer' ? (sameName.get(base.customerId) ?? null) : 0,
      missing,
      itemCount: items.length,
      reminderCount: rem.count,
      paidInFull: balance && balance.ok ? balance.balance.paidInFull : null,
    };
    return {
      base,
      facts,
      row: {
        orderId: base.orderId,
        customerName: base.customerName,
        itemCount: items.length,
        itemCodes: items.map((i) => (i.itemCode ?? '').trim()).filter(Boolean),
        chat: base.chat,
        sendState: base.sendState,
        sentAt: base.sentAt,
        sentManually: base.sentManually,
        reminderCount: rem.count,
        lastReminderAt: rem.last,
        invoice: invoiceEligibility(facts),
        reminder: reminderEligibility(facts),
      },
    };
  });
}

/** Orders whose confirmed items carry this Inventory Unique Code text (one query). */
async function ordersWithItemCode(
  supabase: Supabase,
  ids: ReadonlyArray<string>,
  term: string,
): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0 || !term) return found;
  const { data } = await supabase
    .from('official_order_claims')
    .select('official_order_id, claims!inner ( inventory_items!inner ( item_code ) )')
    .in('official_order_id', [...ids])
    .ilike('claims.inventory_items.item_code', `%${term}%`);
  for (const r of (data ?? []) as Array<{ official_order_id: string }>) found.add(r.official_order_id);
  return found;
}

/**
 * The Send Invoices list: one page of the For Invoice orders matching a filter chip and an
 * optional search (Customer Name or Inventory Unique Code — never a hidden id or a retired
 * Invoice/Order Number), with the count behind every chip. Server-side paging; the verdict for
 * each row comes from the same rules the send re-checks.
 */
export async function listInvoiceSendRows(opts: {
  filter?: InvoiceFilter;
  search?: string;
  page?: number;
}): Promise<InvoiceSendList> {
  await requirePermission('invoice_preparation');
  const supabase = await createClient();
  const filter = opts.filter ?? 'not_sent';
  const pageSize = INVOICE_LIST_PAGE_SIZE;

  let scope = await loadBaseRows(supabase);
  // Letters, digits, spaces, dots and dashes only: safe inside ilike, enough for names and codes.
  const term = (opts.search ?? '').replace(/[^\p{L}\p{N}\s.-]/gu, '').trim();
  if (term) {
    const lower = term.toLowerCase();
    const byCode = await ordersWithItemCode(
      supabase,
      scope.map((r) => r.orderId),
      term,
    );
    scope = scope.filter(
      (r) => r.customerName.toLowerCase().includes(lower) || byCode.has(r.orderId),
    );
  }

  const counts: Record<InvoiceFilter, number> = { not_sent: 0, sent: 0, no_link: 0, all: 0 };
  for (const r of scope) {
    for (const key of Object.keys(counts) as InvoiceFilter[]) {
      if (matchesInvoiceFilter(r, key)) counts[key] += 1;
    }
  }
  const matching = scope.filter((r) => matchesInvoiceFilter(r, filter));
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pages);
  const slice = matching.slice((page - 1) * pageSize, page * pageSize);
  const enriched = slice.length ? await enrich(supabase, slice) : [];

  return { rows: enriched.map((e) => e.row), counts, total: matching.length, page, pageSize };
}

/** A missing database function (the migration is not applied yet). */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    ['PGRST202', '42883'].includes(error.code ?? '') ||
    /could not find the function|does not exist/i.test(error.message ?? '')
  );
}

/** Keep a reason short and human (never a raw API dump). */
function shortReason(text: string | null | undefined, fallback: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

/**
 * Send ONE order's invoice for the bulk window. Re-checks the row on the server, claims the
 * send in the database (so a double click, a second tab or a second admin cannot send it
 * again), then calls the individual Send Invoice (sendOrderInvoice) unchanged. A claim that
 * sent nothing is handed back; one that reached Pancake is closed as Sent / Failed.
 */
export async function sendInvoiceInBulk(orderId: string): Promise<BulkRowOutcome> {
  await requirePermission('invoice_preparation');
  const supabase = await createClient();
  const skipped = (reason: string): BulkRowOutcome => ({ orderId, outcome: 'skipped', reason });

  const [base] = await loadBaseRows(supabase, [orderId]);
  if (!base) return skipped('No longer in For Invoice');
  const [checked] = await enrich(supabase, [base]);
  if (!checked) return skipped('Could not check this order');
  if (!checked.row.invoice.eligible) {
    return skipped(checked.row.invoice.reason ?? 'Not ready to send');
  }

  // An operator-prepared message (saved from View / Edit Message, never sent) is what the
  // individual Send Invoice sends after that edit; otherwise it renders fresh from Settings.
  const { data: saved } = await supabase
    .from('customer_messages')
    .select('status, body')
    .eq('official_order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const savedRow = saved as { status?: string | null; body?: string | null } | null;
  const savedBody =
    savedRow?.status === 'ready_to_copy_or_send' && (savedRow.body ?? '').trim()
      ? (savedRow.body as string)
      : null;
  const restore =
    savedRow?.status === 'direct_send_failed' || savedRow?.status === 'ready_to_copy_or_send'
      ? savedRow.status
      : 'message_draft';

  const claim = await supabase.rpc('claim_order_invoice_send', { p_order_id: orderId });
  if (claim.error) {
    return skipped(
      isMissingFunction(claim.error)
        ? 'Bulk sending needs the database update first'
        : 'Could not start the send',
    );
  }
  if (claim.data !== 'claimed') return skipped(claimSkipReason(String(claim.data)));

  const release = () =>
    supabase.rpc('release_order_invoice_send', { p_order_id: orderId, p_restore: restore });

  const result = await sendOrderInvoice(orderId, savedBody);
  if (!result.ok) {
    await release();
    return skipped(shortReason(result.error, 'Not sent'));
  }
  if (!result.pancake.attempted) {
    await release();
    return skipped(
      result.pancake.reason === 'test_session'
        ? 'Test session active — not sent'
        : 'No Facebook link',
    );
  }
  await supabase.rpc('finalize_order_invoice_send', {
    p_order_id: orderId,
    p_delivered: result.pancake.delivered,
    p_body: null,
  });
  return result.pancake.delivered
    ? { orderId, outcome: 'sent', reason: null }
    : {
        orderId,
        outcome: 'failed',
        reason: shortReason(result.pancake.error, 'Pancake did not deliver it'),
      };
}

/**
 * Send ONE order's next reminder (1..3) for the bulk window. Re-checks the row, renders the
 * Reminder template from Settings, and records + delivers it through sendOrderReminder
 * (record_order_reminder refuses a duplicate number, an unsent invoice, a paid-in-full order).
 */
export async function sendReminderInBulk(orderId: string): Promise<BulkRowOutcome> {
  await requirePermission('invoice_preparation');
  const supabase = await createClient();
  const skipped = (reason: string): BulkRowOutcome => ({ orderId, outcome: 'skipped', reason });

  const [base] = await loadBaseRows(supabase, [orderId]);
  if (!base) return skipped('No longer in For Invoice');
  const [checked] = await enrich(supabase, [base]);
  const verdict = checked?.row.reminder;
  if (!verdict?.eligible || !verdict.nextNumber) {
    return skipped(verdict?.reason ?? 'Reminder not available');
  }
  const rendered = await renderOrderMessage(orderId, 'reminder_1');
  if (!rendered.ok) return skipped('The reminder message could not be prepared');

  const res = await sendOrderReminder(orderId, verdict.nextNumber, rendered.message);
  if (!res.ok) return skipped(shortReason(res.error, 'Reminder not sent'));
  const p = res.pancake;
  if (p?.delivered) return { orderId, outcome: 'sent', reason: null };
  return {
    orderId,
    outcome: 'failed',
    reason: p?.attempted
      ? `Reminder ${verdict.nextNumber} recorded, but Pancake did not deliver it`
      : `Reminder ${verdict.nextNumber} recorded, not delivered — send it from the chat`,
  };
}
