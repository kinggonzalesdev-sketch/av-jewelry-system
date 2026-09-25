/**
 * Was the invoice message prepared or sent BEFORE the order's items last changed? (Owner
 * 2026-09-26.) Adding an item to a For Invoice order must never let an old message pass for the
 * new order: a saved draft is rebuilt from the current order, and an invoice already sent is
 * flagged as needing a new Send Invoice — which only the Owner triggers; nothing sends by itself.
 *
 * Built from facts the database already records: each order line's `added_at`, the message row's
 * `updated_at` (refreshed on every edit and send by a trigger) and its send times
 * (`auto_sent_at` / `manually_sent_at`). No new state. Limitation: a Remove or Split leaves no
 * newer `added_at`, so it is not flagged here.
 */

/** Statuses of a message the customer (probably) already has. */
const SENT_STATUSES = new Set(['direct_sent', 'manually_sent', 'direct_send_pending']);

export type InvoiceEditState =
  /** No message yet, or it was written after the last item change. */
  | 'current'
  /** A saved, unsent message predates the last item change: rebuild it, never send it as is. */
  | 'draft_outdated'
  /** The invoice was sent before the last item change: the customer's copy is out of date. */
  | 'sent_outdated';

/** The newest `addedAt` among the order's lines, or null. */
export function latestItemAddedAt(
  items: ReadonlyArray<{ addedAt?: string | null }>,
): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const i of items) {
    const ms = i.addedAt ? Date.parse(i.addedAt) : NaN;
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = i.addedAt ?? null;
    }
  }
  return latest;
}

/**
 * A SENT invoice is judged by when it was actually sent (`lastSentAt`), not by its last edit: saving
 * a rebuilt text over a sent invoice must not clear "sent before the item was added" — the customer
 * still has the old one until Send Invoice runs again. A draft is judged by its last write.
 */
export function invoiceEditState(
  itemsChangedAt: string | null,
  message: {
    status: string | null;
    updatedAt: string | null;
    lastSentAt?: string | null;
  } | null,
): InvoiceEditState {
  if (!message || !itemsChangedAt) return 'current';
  const sent = SENT_STATUSES.has(message.status ?? '');
  const reference = sent ? (message.lastSentAt ?? message.updatedAt) : message.updatedAt;
  if (!reference) return 'current';
  const changed = Date.parse(itemsChangedAt);
  const written = Date.parse(reference);
  if (!Number.isFinite(changed) || !Number.isFinite(written) || changed <= written)
    return 'current';
  return sent ? 'sent_outdated' : 'draft_outdated';
}
