'use client';

import { useState } from 'react';

import {
  addLayawayItemAction,
  removeLayawayItemAction,
  splitLayawayItemToOrderAction,
} from '@/lib/payments/actions';
import { searchCaptureItemsAction } from '@/lib/orders/actions';
import type { CaptureItem } from '@/lib/orders/service';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';
import { formatPeso } from '@/lib/payments/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Modal } from '@/components/ui/modal';

/**
 * Multi-item layaway editing (Owner request 2026-08-09). Owner / Selected Admin only
 * (the DB re-checks). Add a piece from Active inventory, remove one (it returns to
 * stock), or split it into its own new Order — every change recomputes the account's
 * grams → interest → grand total → balance from the item list.
 */
type Item = LayawayLedgerDetail['items'][number];

export function LayawayEditItems({
  ledgerId,
  items,
  canManage,
  onRefresh,
}: {
  ledgerId: string;
  items: Item[];
  canManage: boolean;
  onRefresh: () => void;
}) {
  // Add Item (search Active Inventory → pick → price → add).
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaptureItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<CaptureItem | null>(null);
  const [pricing, setPricing] = useState<'fixed' | 'per_gram'>('fixed');
  const [price, setPrice] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Remove / Split.
  const [target, setTarget] = useState<{ kind: 'remove' | 'split'; item: Item } | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (!canManage) return null;

  const runSearch = async (q: string) => {
    setQuery(q);
    setPicked(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const res = await searchCaptureItemsAction(q.trim());
    setSearching(false);
    setResults(res);
  };

  const add = async () => {
    if (!picked || adding) return;
    if (!(Number(price) > 0)) {
      setAddError('Enter a price greater than zero.');
      return;
    }
    setAdding(true);
    setAddError(null);
    const res = await addLayawayItemAction(ledgerId, picked.id, pricing, price);
    setAdding(false);
    if (!res.ok) {
      setAddError(res.error);
      return;
    }
    setNote(`Added ${picked.itemCode}. Grams, interest and grand total recomputed.`);
    setPicked(null);
    setQuery('');
    setResults([]);
    setPrice('');
    setPricing('fixed');
    onRefresh();
  };

  const runRowAction = async () => {
    if (!target?.item.id || busy) return;
    setBusy(true);
    setRowError(null);
    if (target.kind === 'remove') {
      const res = await removeLayawayItemAction(ledgerId, target.item.id);
      setBusy(false);
      if (!res.ok) {
        setRowError(res.error);
        return;
      }
      setNote(`Removed ${target.item.itemCode ?? 'the item'} — returned to Active inventory.`);
    } else {
      const res = await splitLayawayItemToOrderAction(ledgerId, target.item.id);
      setBusy(false);
      if (!res.ok) {
        setRowError(res.error);
        return;
      }
      setNote(`Split into new order ${res.orderNumber}.`);
    }
    setTarget(null);
    onRefresh();
  };

  // A real (persisted) item can be removed/split only when the account keeps more
  // than one — the DB enforces the same rule.
  const canEditRows = items.filter((i) => i.id).length > 1;

  return (
    <div className="rounded-lg border border-border p-3" data-testid="layaway-edit-items">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gold-strong">
          Edit Items
        </p>
        <span className="rounded-full bg-gold/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-gold-strong">
          Owner / Admin
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted-foreground">
        Add a piece (grams, interest and grand total recompute), remove one (returns to Active
        inventory), or split it into its own order to pay and deliver on its own.
      </p>
      {note ? (
        <p className="mb-2 text-xs font-medium text-emerald-600" data-testid="layaway-edit-items-note">
          {note}
        </p>
      ) : null}

      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li
            key={it.id ?? `synth-${i}`}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-xs"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{it.itemCode ?? '—'}</span>
              {it.grams ? <span className="text-muted-foreground">{it.grams}g</span> : null}
              <span className="text-muted-foreground">
                {it.itemAmount ? formatPeso(it.itemAmount) : '—'}
              </span>
            </span>
            {it.id && canEditRows ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRowError(null);
                    setTarget({ kind: 'split', item: it });
                  }}
                  data-testid={`layaway-item-split-${it.id}`}
                  className="rounded-md border border-border px-2 py-1 text-[11px] font-medium hover:bg-accent"
                >
                  Split to new order
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRowError(null);
                    setTarget({ kind: 'remove', item: it });
                  }}
                  data-testid={`layaway-item-remove-${it.id}`}
                  className="rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                >
                  Remove
                </button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-2 rounded-md border border-border/60 p-2.5">
        <p className="text-[11px] font-semibold text-foreground">＋ Add Item</p>
        {picked ? (
          <div className="space-y-2">
            <p className="text-xs">
              Selected: <span className="font-mono">{picked.itemCode}</span>
              {picked.gramsPerPiece ? ` · ${picked.gramsPerPiece}g` : ''}
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="ml-2 text-[11px] text-muted-foreground hover:underline"
              >
                change
              </button>
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <Label className="text-[10px]">Pricing</Label>
                <select
                  value={pricing}
                  onChange={(e) => setPricing(e.target.value as 'fixed' | 'per_gram')}
                  className="mt-1 h-9 rounded-md border border-border bg-background px-2 text-sm"
                >
                  <option value="fixed">Fixed Price</option>
                  <option value="per_gram">Price Per Gram</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px]">
                  {pricing === 'per_gram' ? 'Price / gram (₱)' : 'Price (₱)'}
                </Label>
                <MoneyInput value={price} onValueChange={setPrice} className="mt-1 h-9 w-32" />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => void add()}
                disabled={adding}
                data-testid="layaway-add-item-confirm"
              >
                {adding ? 'Adding…' : 'Add'}
              </Button>
            </div>
            {addError ? (
              <p role="alert" className="text-xs text-destructive">
                {addError}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1">
            <Input
              value={query}
              onChange={(e) => void runSearch(e.target.value)}
              placeholder="Search Active Inventory by code…"
              autoComplete="off"
              className="h-9"
              data-testid="layaway-add-item-search"
            />
            {searching ? (
              <p className="text-[11px] text-muted-foreground">Searching…</p>
            ) : null}
            {results.length > 0 ? (
              <ul className="max-h-40 overflow-auto rounded-md border border-border">
                {results.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setPicked(it);
                        setPrice(it.unitPrice ?? '');
                        setResults([]);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
                    >
                      <span className="font-mono">{it.itemCode}</span>
                      <span className="text-muted-foreground">
                        {it.gramsPerPiece ? `${it.gramsPerPiece}g` : ''}{' '}
                        {it.unitPrice ? formatPeso(it.unitPrice) : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= 2 && !searching ? (
              <p className="text-[11px] text-muted-foreground">No matching available items.</p>
            ) : null}
          </div>
        )}
      </div>

      <Modal
        open={target !== null}
        onClose={() => {
          if (!busy) setTarget(null);
        }}
        critical
        size="sm"
        title={target?.kind === 'remove' ? 'Remove item from layaway' : 'Split item to a new order'}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            {target?.kind === 'remove' ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => void runRowAction()}
                disabled={busy}
                data-testid="layaway-item-edit-confirm"
              >
                {busy ? 'Removing…' : 'Remove item'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={() => void runRowAction()}
                disabled={busy}
                data-testid="layaway-item-edit-confirm"
              >
                {busy ? 'Splitting…' : 'Split to new order'}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="font-mono">{target?.item.itemCode ?? ''}</p>
          {target?.kind === 'remove' ? (
            <p className="text-muted-foreground">
              This piece returns to Active inventory and the layaway&apos;s grams, interest,
              grand total and balance recompute. Payments already made stay on the account.
            </p>
          ) : (
            <p className="text-muted-foreground">
              This piece moves to a brand-new For-Invoice order (same customer, unpaid). The
              layaway keeps its other items and all payments; its money recomputes.
            </p>
          )}
          {rowError ? (
            <p role="alert" className="text-sm text-destructive">
              {rowError}
            </p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
