/**
 * The records linked to an inventory item, as the delete popup lists them (Owner 2026-09-26).
 *
 * The database decides everything here (migration 20260926120000,
 * app_private.inventory_item_link_rows): which records link to the item, which ones are closed
 * history, and which ones PROTECT it. The Super Admin force delete reads the same list, so the
 * popup can never offer an override the database would refuse. This module only shapes the rows
 * for display — it never decides whether an item may be deleted.
 */

export type ItemDeleteLink = {
  kind: string;
  recordId: string | null;
  /** The order to open for this record, when there is one. */
  orderId: string | null;
  /** The layaway account to open for this record, when there is one. */
  ledgerId: string | null;
  label: string;
  /** The record's own status, e.g. "cancelled", "approved_return". */
  state: string;
  /** Protected: a force delete is refused while this record exists. */
  blocks: boolean;
  /** Why it protects the item, or why it is closed history. */
  reason: string | null;
};

export type ItemDeleteLinksResult =
  | {
      ok: true;
      links: ItemDeleteLink[];
      /** False when read from the older list (before the migration): no links, no reasons. */
      exact: boolean;
    }
  | { ok: false; error: string };

const KIND_LABELS: Record<string, string> = {
  order: 'Order',
  claim: 'Claim',
  reservation: 'Hold',
  return_review: 'Return review',
  layaway: 'Layaway',
  miner: 'Miner queue',
  live_batch: 'Live batch',
  capture: 'Capture',
  capture_review: 'Capture review',
  waitlist: 'Waitlist',
  item_status: 'Item status',
  // Kinds of the older list (inventory_item_dependencies).
  rts_review: 'Return review',
  completed_sale: 'Sale',
};

/** "return_review" → "Return review"; an unknown kind is shown readably, never hidden. */
export function linkKindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? capitalizeWords(kind);
}

/** "for_preparation" → "For Preparation", "approved_return" → "Approved Return". */
export function linkStateLabel(state: string): string {
  return capitalizeWords(state);
}

function capitalizeWords(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The Orders page opens this order's details directly. */
export function orderHref(orderId: string): string {
  return `/orders?order=${encodeURIComponent(orderId)}`;
}

/** A force delete is possible only when the item has links and EVERY one is closed history. */
export function forceDeleteAllowed(links: readonly ItemDeleteLink[]): boolean {
  return links.length > 0 && links.every((l) => !l.blocks);
}
