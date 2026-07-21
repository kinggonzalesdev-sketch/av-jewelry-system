'use client';

import { useActionState, useState } from 'react';

import { updateItemCustodyAction } from '@/lib/inventory/actions';
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState,
} from '@/lib/inventory/action-state';
import type { CustodyHolder } from '@/lib/inventory/service';
import { cn } from '@/lib/utils';

/**
 * Compact per-item custody control (business requirement F): who holds the item
 * (A.V. Jewelry vs financer) and where. Read-only for staff without inventory
 * monitoring; the domain module + RLS re-check the permission regardless.
 */
export function ItemCustodyEditor({
  inventoryItemId,
  custodyHolder,
  storageLocation,
  handlerName,
  canEdit,
}: {
  inventoryItemId: string;
  custodyHolder: CustodyHolder;
  storageLocation: string | null;
  handlerName: string | null;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<InventoryActionState, FormData>(
    updateItemCustodyAction,
    EMPTY_INVENTORY_STATE,
  );
  const [open, setOpen] = useState(false);

  const badge = (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
        custodyHolder === 'financer'
          ? 'border-amber-300 bg-amber-100 text-amber-800'
          : 'border-gold/30 bg-gold/15 text-gold-strong',
      )}
    >
      {custodyHolder === 'financer' ? 'Financer' : 'On-hand'}
    </span>
  );

  const summary = (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        {badge}
        {storageLocation ? (
          <span className="text-[11px] text-muted-foreground">📍 {storageLocation}</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">No location set</span>
        )}
      </span>
      {handlerName ? (
        <span className="text-[10px] text-muted-foreground">Held by {handlerName}</span>
      ) : null}
    </div>
  );

  if (!canEdit) return summary;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={`custody-edit-${inventoryItemId}`}
        className="text-left"
        title="Set custody & location"
      >
        {summary}
        <span className="mt-0.5 block text-[10px] font-medium text-gold-strong">
          Set custody →
        </span>
      </button>
    );
  }

  return (
    <form action={action} className="space-y-1.5" data-testid="custody-form">
      <input type="hidden" name="inventoryItemId" value={inventoryItemId} />
      <select
        name="custodyHolder"
        defaultValue={custodyHolder}
        aria-label="Custody holder"
        className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px]"
      >
        <option value="av_jewelry">On-hand (A.V. Jewelry)</option>
        <option value="financer">Financer</option>
      </select>
      <input
        name="storageLocation"
        defaultValue={storageLocation ?? ''}
        placeholder="Location (shelf / vault / ref)"
        aria-label="Storage location"
        className="h-7 w-full rounded border border-border bg-background px-1.5 text-[11px]"
      />
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-gold px-2 py-0.5 text-[11px] font-semibold text-black disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-border px-2 py-0.5 text-[11px]"
        >
          Cancel
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-[10px] text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="text-[10px] text-muted-foreground">{state.success}</p>
      ) : null}
    </form>
  );
}
