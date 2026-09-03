'use client';

import { useEffect, useState } from 'react';

import {
  addOrderItemAction,
  removeOrderItemAction,
  removePaidOrderItemAction,
  splitOrderItemAction,
  requestOrderEditAction,
  searchCaptureItemsAction,
} from '@/lib/orders/actions';
import type { OrderLineItemDetail } from '@/lib/orders/detail-types';
import type { CaptureItem } from '@/lib/orders/service';
import { centavosToStr, rowTotalCentavos } from '@/lib/orders/item-pricing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';
import { formatPeso } from '@/lib/payments/format';
import { cn } from '@/lib/utils';

/**
 * Edit Items (Owner request 2026-08-09, extended 2026-08-13). Two modes on the SAME
 * controls:
 *   - OWNER ("direct"): Add / Remove / Split apply immediately.
 *   - ADMIN with initiate_high_risk_action ("request"): the same actions instead create a
 *     pending Owner-approval request (with a reason) — nothing changes until the Owner
 *     approves + executes it in /approvals. Everyone else sees nothing.
 * The database re-checks every rule; this panel just hides controls it knows would be
 * refused (locked status, or — for Remove/Split — the last item).
 */

/** Mirror of app_private.order_items_locked() — the DB is the real gate. */
const LOCKED_STATUSES = new Set([
  'cancelled',
  'for_cancel',
  'dispatched_or_picked_up',
  'completed',
  'closed',
  'delivered',
  'picked_up',
  'released',
]);

type Pending = { kind: 'remove' | 'split'; item: OrderLineItemDetail };

export function OrderItemEditControls({
  orderId,
  status,
  items,
  isOwner,
  canRequestEdit = false,
  onRefresh,
}: {
  orderId: string;
  status: string;
  items: OrderLineItemDetail[];
  isOwner: boolean;
  /** Admin (non-owner) holding initiate_high_risk_action — edits go via Owner approval. */
  canRequestEdit?: boolean;
  onRefresh: () => void;
}) {
  const [target, setTarget] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  // A settled/paid order (LOCKED) is normally uneditable. Only the SUPER ADMIN may still remove an item
  // from it — the paid-order removal (restock + preserve payments + overpayment credit). No add/split.
  if (LOCKED_STATUSES.has(status)) {
    return isOwner ? (
      <PaidOrderRemovalControls orderId={orderId} items={items} onRefresh={onRefresh} />
    ) : null;
  }

  // Owner edits directly; an approval-capable admin requests; anyone else sees nothing.
  const mode: 'direct' | 'request' | null = isOwner
    ? 'direct'
    : canRequestEdit
      ? 'request'
      : null;
  if (!mode) return null;
  const isRequest = mode === 'request';

  const label = (it: OrderLineItemDetail) => it.itemCode ?? it.claimReference;

  const run = async () => {
    if (!target || busy) return;
    if (isRequest && reason.trim().length === 0) {
      setError('Add a reason for the Owner.');
      return;
    }
    setBusy(true);
    setError(null);
    const name = label(target.item);

    if (target.kind === 'remove') {
      if (isRequest) {
        const res = await requestOrderEditAction(
          'order_remove_item',
          orderId,
          { claim_id: target.item.claimId },
          reason,
        );
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setNote(`Requested removing ${name} — sent to the Owner for approval.`);
      } else {
        const res = await removeOrderItemAction(orderId, target.item.claimId);
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setNote(`Removed ${name} — returned to Active inventory.`);
      }
    } else if (isRequest) {
      const res = await requestOrderEditAction(
        'order_split_item',
        orderId,
        { claim_id: target.item.claimId },
        reason,
      );
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(`Requested splitting ${name} — sent to the Owner for approval.`);
    } else {
      const res = await splitOrderItemAction(orderId, target.item.claimId);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote(`Split into a new order.`);
    }

    setTarget(null);
    setReason('');
    onRefresh();
  };

  return (
    <div className="rounded-lg border border-border p-3" data-testid="order-edit-items">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
          Edit Items
        </p>
        <span className="rounded-full bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-strong">
          {isRequest ? 'Needs approval' : 'Super Admin'}
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
        {isRequest
          ? 'Request to add an item, remove a piece, or split it to a new order — the Owner approves before anything changes.'
          : 'Add an item (the order total rises), remove a piece (returns to Active inventory, the total drops), or split it into its own new order.'}
      </p>
      {note ? (
        <p
          className="mb-2 text-xs font-medium text-emerald-600"
          data-testid="order-edit-items-note"
        >
          {note}
        </p>
      ) : null}

      {items.length > 1 ? (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li
              key={it.claimId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
            >
              <span className="font-mono text-xs">{label(it)}</span>
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setReason('');
                    setTarget({ kind: 'split', item: it });
                  }}
                  data-testid={`order-item-split-${it.claimId}`}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                >
                  {isRequest ? 'Request split' : 'Split to new order'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setReason('');
                    setTarget({ kind: 'remove', item: it });
                  }}
                  data-testid={`order-item-remove-${it.claimId}`}
                  className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                >
                  {isRequest ? 'Request remove' : 'Remove'}
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          This order has one item — add another below, or use Cancel Order to void it.
        </p>
      )}

      <AddItemPanel
        orderId={orderId}
        isRequest={isRequest}
        onDone={(msg) => {
          setNote(msg);
          onRefresh();
        }}
      />

      <Modal
        open={target !== null}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        critical
        size="sm"
        title={
          target?.kind === 'remove'
            ? isRequest
              ? 'Request to remove item'
              : 'Remove item from order'
            : isRequest
              ? 'Request to split item'
              : 'Split item to a new order'
        }
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTarget(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            {target?.kind === 'remove' && !isRequest ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void run()}
                disabled={busy}
                data-testid="order-item-edit-confirm"
              >
                {busy ? 'Removing…' : 'Remove item'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void run()}
                disabled={busy}
                data-testid="order-item-edit-confirm"
              >
                {busy
                  ? isRequest
                    ? 'Sending…'
                    : 'Splitting…'
                  : isRequest
                    ? 'Send request'
                    : 'Split to new order'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-mono">{target ? label(target.item) : ''}</p>
          {target?.kind === 'remove' ? (
            <p className="text-muted-foreground">
              This piece returns to Active inventory (sellable again) and the order total
              drops by its price. Payments already made stay on this order — if that
              leaves the order overpaid, it shows a credit (never auto-refunded).
            </p>
          ) : (
            <p className="text-muted-foreground">
              This piece moves to a brand-new For-Invoice order (same customer, unpaid) so
              it can be paid and delivered on its own. This order keeps the remaining
              items and all its payments.
            </p>
          )}
          {isRequest ? (
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="edit-reason">
                Reason (for the Owner)
              </label>
              <Input
                id="edit-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                autoComplete="off"
                placeholder="Why should this change be made?"
                className="mt-1 h-9"
                data-testid="order-item-edit-reason"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Nothing changes yet — the Owner approves this in Approvals.
              </p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

/**
 * PAID-ORDER item removal (Owner 2026-09-03) — the SUPER ADMIN removes an item from a Fully-Paid /
 * settled (locked) order. Stronger confirmation + a MANDATORY reason. The item returns to Active
 * inventory, the order total recalculates, payments are preserved, and any overpayment shows as a
 * credit (never auto-refunded). Only shown to the Owner on a locked order (the parent gates it).
 */
function PaidOrderRemovalControls({
  orderId,
  items,
  onRefresh,
}: {
  orderId: string;
  items: OrderLineItemDetail[];
  onRefresh: () => void;
}) {
  const [target, setTarget] = useState<OrderLineItemDetail | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const label = (it: OrderLineItemDetail) => it.itemCode ?? it.claimReference;

  const run = async () => {
    if (!target || busy) return;
    if (reason.trim().length === 0) {
      setError('A reason is required to remove a paid item.');
      return;
    }
    setBusy(true);
    setError(null);
    const name = label(target);
    const res = await removePaidOrderItemAction(orderId, target.claimId, reason);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const s = res.snapshot;
    const overpay = Number(s.overpaymentCredit);
    setNote(
      `Removed ${name} — returned to Active inventory. New total ${formatPeso(s.newTotal)}, paid ${formatPeso(s.paid)}` +
        (overpay > 0
          ? ` → the order is now overpaid: ${formatPeso(s.overpaymentCredit)} credit (payments unchanged, never auto-refunded).`
          : '.'),
    );
    setTarget(null);
    setReason('');
    onRefresh();
  };

  const header = (
    <div className="flex items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
        Remove Paid Item
      </p>
      <span className="rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-destructive">
        Super Admin
      </span>
    </div>
  );

  if (items.length <= 1) {
    return (
      <div className="rounded-lg border border-destructive/40 p-3" data-testid="order-paid-remove">
        {header}
        <p className="mt-1 text-[11px] text-muted-foreground">
          This paid order has one item — use Cancel Order to void the whole order instead.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/40 p-3" data-testid="order-paid-remove">
      {header}
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
        This order is settled/paid. Removing a piece returns it to Active inventory and recalculates
        the total — payments stay (any overpayment shows as a credit, never auto-refunded).
      </p>
      {note ? (
        <p className="mb-2 text-xs font-medium text-emerald-600" data-testid="order-paid-remove-note">
          {note}
        </p>
      ) : null}
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.claimId}
            className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs">{label(it)}</span>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setReason('');
                setTarget(it);
              }}
              data-testid={`order-paid-remove-${it.claimId}`}
              className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={target !== null}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        critical
        size="sm"
        title="Remove paid item?"
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void run()}
              disabled={busy}
              data-testid="order-paid-remove-confirm"
            >
              {busy ? 'Removing…' : 'Remove Item & Return to Stock'}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-mono">{target ? label(target) : ''}</p>
          <p className="text-muted-foreground">
            This item will return to available Inventory. Existing payment records will remain
            unchanged and the order totals will be recalculated. If that leaves the order overpaid, it
            shows a credit — never auto-refunded.
          </p>
          <div>
            <label className="text-xs text-muted-foreground" htmlFor="paid-remove-reason">
              Reason for removal
            </label>
            <Input
              id="paid-remove-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoComplete="off"
              placeholder="Why is this paid item being removed?"
              className="mt-1 h-9"
              data-testid="order-paid-remove-reason"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}

/**
 * Add items to an existing order — SAME multi-item format as New Order Entry (Owner
 * request 2026-08-13): Item 1 / Item 2 / … with unlimited "+ Add Item", a live Number of
 * Items / Subtotal / Total Amount summary, and per-row Remove. Owner adds directly; an
 * admin with initiate_high_risk_action sends ONE approval request per row (with a reason).
 * Each picked row is added via addOrderItemAction; the DB re-checks every rule.
 */
// SAME pricing shape as New Order Entry: each row is ONE unique piece priced either as a
// Fixed Price or Price Per Gram (grams × rate). The centavo math is the shared module's,
// so this panel and the New-Order form compute an item's price identically.
// Exported (with newAddRow / pickedGrams / AddItemSearchRow below) so the Layaway account
// modal's "Add Item" reuses the exact same row UI + math instead of duplicating it.
export type AddRow = {
  key: string;
  picked: CaptureItem | null;
  priceMode: 'fixed' | 'per_gram';
  /** Fixed-price amount (raw). */
  price: string;
  /** Price-per-gram rate (raw); the total is grams × rate. */
  perGram: string;
  /** Grams (raw) — prefilled from the picked item, editable. Empty = the item's own grams. */
  grams: string;
};

let addRowSeq = 0;
export function newAddRow(): AddRow {
  addRowSeq += 1;
  return {
    key: `add-${addRowSeq}-${Date.now()}`,
    picked: null,
    priceMode: 'fixed',
    price: '',
    perGram: '',
    grams: '',
  };
}

/** Grams override input mask — digits, optional dot, up to 3 decimals (matches New Entry). */
const GRAMS_RE = /^\d{0,6}(\.\d{0,3})?$/;

/** Normalize a picked capture item to the grams-carrier shape the pricing helpers read
 *  (CaptureItem exposes `gramsPerPiece`, the helpers want `grams`). */
export function pickedGrams(it: CaptureItem | null): { grams: string | null } | null {
  return it ? { grams: it.gramsPerPiece } : null;
}

/** One row: search Active Inventory → pick → price (Fixed or Per Gram). SAME format as
 *  New Order Entry. Owns its own debounced search. Exported + reused by the Layaway
 *  account modal's Add Item so the row UI is byte-identical. */
export function AddItemSearchRow({
  index,
  row,
  canRemove,
  onPick,
  onPatch,
  onRemove,
  searchTestId,
}: {
  index: number;
  row: AddRow;
  canRemove: boolean;
  /** Select (or clear, with null) the row's item — prefills price + grams on select. */
  onPick: (item: CaptureItem | null) => void;
  /** Patch any pricing field (mode / grams / price / per-gram). */
  onPatch: (next: Partial<AddRow>) => void;
  onRemove: () => void;
  /** Override the search input's test id (defaults to `add-item-search-{index}`). Layaway
   *  passes `layaway-add-item-search` on its first row; the Order form passes nothing, so
   *  its markup stays byte-identical. */
  searchTestId?: string | undefined;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CaptureItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (row.picked || q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setSearching(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const t = setTimeout(() => {
      void searchCaptureItemsAction(q.trim())
        .then((r) => {
          if (alive) setResults(r);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, row.picked]);

  // Per-row line total via the SHARED centavo math (identical to New Order Entry).
  const itemTotal = formatPeso(centavosToStr(rowTotalCentavos(row, pickedGrams(row.picked))));
  const perGram = row.priceMode === 'per_gram';

  const modeBtn = (m: 'fixed' | 'per_gram', label: string) => (
    <button
      type="button"
      onClick={() => onPatch({ priceMode: m })}
      data-testid={`add-item-mode-${m}-${index}`}
      className={cn(
        'rounded-md px-2 py-1 text-[11px] font-semibold',
        row.priceMode === m
          ? 'bg-gold text-black'
          : 'text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      className="rounded-md border border-border bg-background p-2"
      data-testid={`add-item-row-${index}`}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Item {index + 1}
        </span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            data-testid={`add-item-remove-${index}`}
            className="text-[11px] text-destructive underline"
          >
            Remove
          </button>
        ) : null}
      </div>
      {row.picked ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs">
              {row.picked.itemCode}
              {row.picked.gramsPerPiece ? ` · ${row.picked.gramsPerPiece}g` : ''}
            </span>
            <button
              type="button"
              onClick={() => {
                onPick(null);
                setQ('');
              }}
              className="text-[11px] text-muted-foreground underline"
            >
              change
            </button>
          </div>

          {/* PRICING toggle (Fixed Price | Price Per Gram) — mirrors New Order Entry. */}
          <div className="flex items-center gap-1">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pricing
            </span>
            <div
              className="inline-flex items-center gap-1 rounded-md border border-border p-0.5"
              data-testid={`add-item-pricing-${index}`}
            >
              {modeBtn('fixed', 'Fixed Price')}
              {modeBtn('per_gram', 'Price Per Gram')}
            </div>
          </div>

          {/* GRAMS + PRICE (or Price / Gram). */}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Grams
              </span>
              <input
                inputMode="decimal"
                value={row.grams}
                placeholder={row.picked.gramsPerPiece ?? '0'}
                data-testid={`add-item-grams-${index}`}
                onChange={(e) => {
                  const v = e.target.value;
                  if (GRAMS_RE.test(v)) onPatch({ grams: v });
                }}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-right text-sm tabular-nums outline-none focus:border-gold"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {perGram ? 'Price / Gram' : 'Price'}
              </span>
              {perGram ? (
                <MoneyInput
                  value={row.perGram}
                  onValueChange={(v) => onPatch({ perGram: v })}
                  placeholder="0.00"
                  className="h-8 w-full text-right tabular-nums"
                  data-testid={`add-item-pergram-${index}`}
                />
              ) : (
                <MoneyInput
                  value={row.price}
                  onValueChange={(v) => onPatch({ price: v })}
                  placeholder="0.00"
                  className="h-8 w-full text-right tabular-nums"
                  data-testid={`add-item-price-${index}`}
                />
              )}
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-1">
            <span className="text-[11px] text-muted-foreground">Total</span>
            <span
              className="text-xs font-semibold tabular-nums"
              data-testid={`add-item-line-${index}`}
            >
              {itemTotal}
            </span>
          </div>
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Active Inventory (code / name)…"
            data-testid={searchTestId ?? `add-item-search-${index}`}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          />
          {results.length > 0 ? (
            <ul className="absolute z-30 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-background shadow-lg">
              {results.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(it);
                      setResults([]);
                      setQ(it.itemCode);
                    }}
                    data-testid={`order-add-item-pick-${it.id}`}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    <span className="font-mono">{it.itemCode}</span>
                    <span className="text-muted-foreground">
                      {it.gramsPerPiece ? `${it.gramsPerPiece}g` : ''}
                      {it.unitPrice ? ` · ₱${it.unitPrice}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {searching && q.trim().length >= 2 ? (
            <p className="mt-1 text-[11px] text-muted-foreground">Searching…</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AddItemPanel({
  orderId,
  isRequest,
  onDone,
}: {
  orderId: string;
  isRequest: boolean;
  onDone: (msg: string) => void;
}) {
  const [rows, setRows] = useState<AddRow[]>([newAddRow()]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (key: string, next: Partial<AddRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...next } : r)));
  // Select an item → prefill Fixed price from the catalogue and grams from the item's
  // per-piece weight (like New Entry), so switching to Per Gram already has grams. A null
  // clears the row back to an unpicked, Fixed-price blank.
  const pick = (key: string, item: CaptureItem | null) =>
    patch(key, {
      picked: item,
      priceMode: 'fixed',
      price: item?.unitPrice ?? '',
      perGram: '',
      grams: item?.gramsPerPiece ?? '',
    });

  const pickedRows = rows.filter((r) => r.picked);
  // Display-only running total, computed with the SHARED centavo math (the DB is
  // authoritative on each add). Fixed rows use the price; Per-Gram rows use grams × rate.
  const subtotalCentavos = rows.reduce(
    (c, r) => (r.picked ? c + rowTotalCentavos(r, pickedGrams(r.picked)) : c),
    0n,
  );
  const subtotalStr = formatPeso(centavosToStr(subtotalCentavos));

  const submit = async () => {
    if (busy) return;
    if (pickedRows.length === 0) {
      setErr('Pick at least one item from Active Inventory.');
      return;
    }
    const seen = new Set<string>();
    for (const r of pickedRows) {
      // Validate the COMPUTED total (not the raw price) so Per-Gram rows are checked on
      // grams × rate, exactly as they will be added.
      if (rowTotalCentavos(r, pickedGrams(r.picked)) <= 0n) {
        setErr(
          r.priceMode === 'per_gram'
            ? `Enter grams and a price per gram greater than zero for ${r.picked!.itemCode}.`
            : `Enter a price greater than zero for ${r.picked!.itemCode}.`,
        );
        return;
      }
      if (seen.has(r.picked!.id)) {
        setErr(`${r.picked!.itemCode} was added more than once. Remove the duplicate.`);
        return;
      }
      seen.add(r.picked!.id);
    }
    if (isRequest && reason.trim().length === 0) {
      setErr('Add a reason for the Owner.');
      return;
    }

    setBusy(true);
    setErr(null);
    const done: string[] = [];
    for (const r of pickedRows) {
      // The unit price IS the row's computed total (Fixed Price, or grams × price-per-gram)
      // — the SAME value the New-Order form sends, so the two forms never disagree.
      const unitPrice = centavosToStr(rowTotalCentavos(r, pickedGrams(r.picked)));
      const res = isRequest
        ? await requestOrderEditAction(
            'order_add_item',
            orderId,
            { item_id: r.picked!.id, price: unitPrice },
            reason,
          )
        : await addOrderItemAction(orderId, r.picked!.id, unitPrice, 1);
      if (!res.ok) {
        setBusy(false);
        // Some rows before this one may already be added (each add is its own action);
        // report which failed so the operator sees exactly where it stopped.
        setErr(
          done.length > 0
            ? `Added ${done.join(', ')}, but ${r.picked!.itemCode} failed: ${res.error}`
            : `${r.picked!.itemCode}: ${res.error}`,
        );
        return;
      }
      done.push(r.picked!.itemCode);
    }
    setBusy(false);
    onDone(
      isRequest
        ? `Requested adding ${done.length} item${done.length === 1 ? '' : 's'} — sent to the Owner for approval.`
        : `Added ${done.length} item${done.length === 1 ? '' : 's'} — order total updated.`,
    );
    setRows([newAddRow()]);
    setReason('');
  };

  return (
    <div className="mt-3 space-y-2 rounded-md border border-gold/40 bg-gold/5 p-2.5">
      <p className="text-[11px] font-semibold text-gold-strong">
        {isRequest ? '＋ Request to add items' : '＋ Add items to this order'}
      </p>

      {rows.map((r, i) => (
        <AddItemSearchRow
          key={r.key}
          index={i}
          row={r}
          canRemove={rows.length > 1}
          onPick={(item) => pick(r.key, item)}
          onPatch={(next) => patch(r.key, next)}
          onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
        />
      ))}

      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, newAddRow()])}
        data-testid="order-add-item-add-row"
        className="w-full rounded-md border border-dashed border-border py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent"
      >
        ＋ Add Item
      </button>

      {/* Live summary — updates as items are picked / priced / removed. */}
      <div className="rounded-md border border-border bg-background px-3 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Number of Items</span>
          <span className="tabular-nums" data-testid="add-item-count">
            {pickedRows.length}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums" data-testid="add-item-subtotal">
            {subtotalStr}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-semibold">
          <span>Total Amount</span>
          <span className="tabular-nums" data-testid="add-item-total">
            {subtotalStr}
          </span>
        </div>
      </div>

      {isRequest ? (
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          autoComplete="off"
          placeholder="Reason for the Owner"
          className="h-8"
          data-testid="order-add-item-reason"
        />
      ) : null}

      <Button
        type="button"
        size="sm"
        onClick={() => void submit()}
        disabled={busy}
        data-testid="order-add-item-confirm"
        className="w-full"
      >
        {busy
          ? isRequest
            ? 'Sending…'
            : 'Adding…'
          : isRequest
            ? 'Send request'
            : `Add ${pickedRows.length || ''} item${pickedRows.length === 1 ? '' : 's'}`.replace(
                '  ',
                ' ',
              )}
      </Button>

      {err ? (
        <p role="alert" className="text-xs text-destructive">
          {err}
        </p>
      ) : null}
    </div>
  );
}
