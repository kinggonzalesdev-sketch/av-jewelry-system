'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useActionState, useEffect, useMemo, useRef, useState } from 'react';

import {
  createInventoryItemAction,
  returnCompletedItemAction,
} from '@/lib/inventory/actions';
import type { InventoryActionState } from '@/lib/inventory/action-state';
import { EMPTY_INVENTORY_STATE } from '@/lib/inventory/action-state';
import type { InventoryListResult } from '@/lib/inventory/service';
import type { CompletedInventoryRow } from '@/lib/inventory/completed';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { downloadCsv } from '@/lib/export/csv';
import { InventoryImportButton } from '@/components/inventory/inventory-import-modal';
import { InventoryItemActions } from '@/components/inventory/inventory-item-actions';
import { EmptyState } from '@/components/states/empty-state';
import { Button } from '@/components/ui/button';
import { ReadError } from '@/components/ui/page-primitives';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Label } from '@/components/ui/label';
import { Modal, ModalFieldFull, ModalFormGrid } from '@/components/ui/modal';

/**
 * Inventory Ops, Returned-to-Stock, Customers & Migration (Bible §19, §10).
 *
 * The screen states exactly what the database enforces:
 *   - Stock returns only via an APPROVED review; eligibility is not approval.
 *   - A review DECIDES; it never promotes a miner or allocates a waitlist.
 *   - A forfeited item is excluded from automatic return.
 *   - Judging two customers duplicates merges NOTHING.
 */

const TABS = ['Active Inventory', 'Completed Items'] as const;

type Tab = (typeof TABS)[number];

/** Inventory availability statuses that mean the item is SOLD / RELEASED — it is
 *  historical, not operationally active. Completed items must never appear as
 *  available (spec §4). One inventory source of truth, split by status (§6). */
const COMPLETED_INVENTORY_STATUSES = new Set(['completed', 'released']);

/** "Date Encoded" for the table — a short local date, or a dash. */
function fmtEncoded(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString();
}

/** Today as YYYY-MM-DD, for the New Entry date default. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export function InventoryWorkspace({
  inventory,
  completed = [],
  canMonitor,
}: {
  inventory: InventoryListResult;
  completed?: CompletedInventoryRow[];
  canMonitor: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('Active Inventory');
  const [showNewEntry, setShowNewEntry] = useState(false);
  // Completed Items: search + completion-type filter (§12) + read-only detail (§5).
  const [compSearch, setCompSearch] = useState('');
  const [compType, setCompType] = useState('all');
  const [compView, setCompView] = useState<CompletedInventoryRow | null>(null);
  const [returnCompState, returnCompletedAction, returningItem] = useActionState<
    InventoryActionState,
    FormData
  >(returnCompletedItemAction, EMPTY_INVENTORY_STATE);
  // Close the detail + refresh once a return-to-review succeeds.
  const lastReturn = useRef<string | null>(null);
  useEffect(() => {
    if (returnCompState.success && returnCompState.success !== lastReturn.current) {
      lastReturn.current = returnCompState.success;
      setCompView(null);
      router.refresh();
    }
  }, [returnCompState.success, router]);
  const [createState, createAction, creating] = useActionState<
    InventoryActionState,
    FormData
  >(createInventoryItemAction, EMPTY_INVENTORY_STATE);

  // Close the New Entry dialog once a create succeeds (once per new success).
  const lastCreate = useRef<string | null>(null);
  useEffect(() => {
    if (createState.success && createState.success !== lastCreate.current) {
      lastCreate.current = createState.success;
      setShowNewEntry(false);
    }
  }, [createState.success]);

  // --- Inventory search + status filter — client-side over the loaded rows.
  const [invSearch, setInvSearch] = useState('');
  const [invStatus, setInvStatus] = useState('all');

  const invRows = useMemo(() => (inventory.ok ? inventory.rows : []), [inventory]);
  // Active statuses only in the filter dropdown — completed/released live under
  // the Completed Items tab, never offered as an "available" filter (§4).
  const statusOptions = useMemo(
    () =>
      [
        ...new Set(
          invRows
            .map((r) => r.availabilityStatus)
            .filter((s) => !COMPLETED_INVENTORY_STATUSES.has(s)),
        ),
      ].sort(),
    [invRows],
  );
  const filteredInventory = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return invRows.filter((row) => {
      // Active Inventory NEVER shows completed/released items (§4).
      if (COMPLETED_INVENTORY_STATUSES.has(row.availabilityStatus)) return false;
      if (invStatus !== 'all' && row.availabilityStatus !== invStatus) return false;
      if (!q) return true;
      return `${row.itemCode} ${row.itemName ?? ''}`.toLowerCase().includes(q);
    });
  }, [invRows, invSearch, invStatus]);

  // Completed Items — historical sold/released inventory with order/customer
  // context (§5), searchable + filterable by completion type (§12).
  const completionTypeOptions = useMemo(
    () => [...new Set(completed.map((c) => c.completionType))].sort(),
    [completed],
  );
  const filteredCompleted = useMemo(() => {
    const q = compSearch.trim().toLowerCase();
    return completed.filter((c) => {
      if (compType !== 'all' && c.completionType !== compType) return false;
      if (!q) return true;
      return `${c.itemCode} ${c.itemName ?? ''} ${c.customerName ?? ''} ${c.orderNumber ?? ''} ${c.invoiceNumber ?? ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [completed, compSearch, compType]);
  const exportCompleted = () => {
    downloadCsv(
      `completed-items-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Inventory Code', value: (c) => c.itemCode },
        { header: 'Item', value: (c) => c.itemName ?? '' },
        { header: 'Condition', value: (c) => parseInventoryCode(c.itemCode).condition ?? '' },
        { header: 'Item Type', value: (c) => parseInventoryCode(c.itemCode).itemType ?? '' },
        { header: 'Grams', value: (c) => parseInventoryCode(c.itemCode).grams ?? '' },
        { header: 'Size', value: (c) => parseInventoryCode(c.itemCode).size ?? '' },
        { header: 'Customer', value: (c) => c.customerName ?? '' },
        { header: 'Order Number', value: (c) => c.orderNumber ?? '' },
        { header: 'Invoice Number', value: (c) => c.invoiceNumber ?? '' },
        { header: 'Completion Type', value: (c) => c.completionType },
        { header: 'Courier', value: (c) => c.courier ?? '' },
        { header: 'Tracking Number', value: (c) => c.trackingNumber ?? '' },
        { header: 'Completed Date', value: (c) => c.completedDate?.slice(0, 10) ?? '' },
        { header: 'Final Holder', value: (c) => c.currentHolder ?? '' },
      ],
      filteredCompleted,
    );
  };

  // Export the CURRENTLY FILTERED inventory (respects search + filters) with the
  // parsed columns (§18/D). Never exports mock data — these are the real rows.
  const exportInventory = () => {
    downloadCsv(
      `inventory-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Inventory Code', value: (i) => i.itemCode },
        { header: 'Item', value: (i) => i.itemName ?? '' },
        { header: 'Condition', value: (i) => parseInventoryCode(i.itemCode).condition ?? '' },
        { header: 'Item Type', value: (i) => parseInventoryCode(i.itemCode).itemType ?? '' },
        { header: 'Grams', value: (i) => parseInventoryCode(i.itemCode).grams ?? '' },
        { header: 'Size', value: (i) => parseInventoryCode(i.itemCode).size ?? '' },
        { header: 'Status', value: (i) => i.availabilityStatus.replace(/_/g, ' ') },
        { header: 'Total', value: (i) => i.quantityTotal },
        { header: 'Available', value: (i) => i.availableQuantity },
        { header: 'Reserved', value: (i) => i.reservedQuantity },
        { header: 'Custody Holder', value: (i) => i.custodyHolder ?? '' },
        { header: 'Storage Location', value: (i) => i.storageLocation ?? '' },
      ],
      filteredInventory,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {TABS.map((t) => (
          <Fragment key={t}>
            <Button
              type="button"
              role="tab"
              aria-selected={tab === t}
              size="sm"
              variant={tab === t ? 'default' : 'outline'}
              onClick={() => setTab(t)}
            >
              {t}
            </Button>
            {/* New Entry · Upload · Export sit under Active Inventory — all open
                the standard centered dialogs. */}
            {t === 'Active Inventory' ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowNewEntry(true)}
                  data-testid="inventory-new-entry"
                >
                  ＋ New Entry
                </Button>
                <InventoryImportButton
                  existingCodes={inventory.ok ? inventory.rows.map((r) => r.itemCode) : []}
                />
                {inventory.ok && inventory.rows.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={exportInventory}
                    data-testid="inventory-export"
                  >
                    ⭳ Export CSV
                  </Button>
                ) : null}
              </>
            ) : null}
          </Fragment>
        ))}
      </div>

      {/* New Entry — create an inventory item in the standard modal. Permission is
          enforced server-side (post_live_item_entry) + RLS. */}
      <Modal
        open={showNewEntry}
        onClose={() => setShowNewEntry(false)}
        title="New inventory entry"
        description="Add an item to available stock. Its price sets the catalogue price."
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowNewEntry(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="inventory-new-entry-form" disabled={creating}>
              {creating ? 'Adding…' : 'Add item'}
            </Button>
          </>
        }
      >
        <form id="inventory-new-entry-form" action={createAction} className="space-y-3">
          <ModalFormGrid>
            <ModalFieldFull>
              <Label htmlFor="ne-code" className="text-xs">
                Item Code
              </Label>
              <Input
                id="ne-code"
                name="itemCode"
                required
                placeholder="e.g. SBA-N-3017"
                className="mt-1 h-9"
              />
            </ModalFieldFull>
            <div>
              <Label htmlFor="ne-price" className="text-xs">
                Price
              </Label>
              <MoneyInput
                id="ne-price"
                name="unitPrice"
                placeholder="0.00"
                className="mt-1 h-9"
              />
            </div>
            <div>
              <Label htmlFor="ne-date" className="text-xs">
                Date Encoded
              </Label>
              <Input
                id="ne-date"
                name="dateEncoded"
                type="date"
                defaultValue={todayISO()}
                className="mt-1 h-9"
              />
            </div>
          </ModalFormGrid>
          <p className="text-[11px] text-muted-foreground">
            Item Code is required and must be unique. Date Encoded defaults to today
            and can be changed.
          </p>
          {createState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {createState.error}
            </p>
          ) : null}
        </form>
      </Modal>

      {tab === 'Active Inventory' ? (
        !inventory.ok ? (
          // A FAILED read, not an empty result — say so, never a false "no items".
          <ReadError title="Inventory could not be loaded" detail={inventory.reason} />
        ) : inventory.rows.length === 0 ? (
          <EmptyState title="No inventory items" />
        ) : (
          <div className="space-y-3">
            {/* Spreadsheet-style search + filters over the loaded items. */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
              <input
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                placeholder="Search code or item…"
                aria-label="Search inventory"
                data-testid="inventory-search"
                className="h-9 flex-1 min-w-[10rem] rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
              />
              <select
                value={invStatus}
                onChange={(e) => setInvStatus(e.target.value)}
                aria-label="Filter by status"
                data-testid="inventory-filter-status"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {filteredInventory.length} of {inventory.rows.length}
              </span>
            </div>

            {filteredInventory.length === 0 ? (
              <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
                No items match these filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2.5 py-2">Unique Code</th>
                  <th className="px-2.5 py-2">Facebook Name</th>
                  <th className="px-2.5 py-2">Status</th>
                  <th className="px-2.5 py-2 text-right">Grams</th>
                  <th className="px-2.5 py-2">Date Encoded</th>
                  <th className="px-2.5 py-2">Notes</th>
                  <th className="px-2.5 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredInventory.map((i) => (
                  <tr key={i.inventoryItemId}>
                    <td className="px-2.5 py-2 font-mono">{i.itemCode}</td>
                    <td className="px-2.5 py-2">
                      {i.facebookName ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2">
                      {i.availabilityStatus.replace(/_/g, ' ')}
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums">
                      {i.gramsPerPiece ?? parseInventoryCode(i.itemCode).grams ?? '—'}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      {fmtEncoded(i.createdAt)}
                    </td>
                    <td className="px-2.5 py-2 text-muted-foreground">
                      {i.inRtsReview ? 'In RTS review' : ''}
                      {i.isForfeited ? ' · forfeited (excluded from auto-return)' : ''}
                    </td>
                    <td className="px-2.5 py-2">
                      <InventoryItemActions row={i} canMonitor={canMonitor} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
              </div>
            )}
          </div>
        )
      ) : null}

      {tab === 'Completed Items' ? (
        completed.length === 0 ? (
          <EmptyState
            title="No completed items yet"
            description="Sold and released items appear here (historical). The record is never deleted — it moves here by status when an order completes."
          />
        ) : (
          <div className="space-y-3">
            {/* Search + completion-type filter + export (§12). */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
              <input
                value={compSearch}
                onChange={(e) => setCompSearch(e.target.value)}
                placeholder="Search code, item, customer, order…"
                aria-label="Search completed items"
                data-testid="completed-search"
                className="h-9 flex-1 min-w-[12rem] rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
              />
              <select
                value={compType}
                onChange={(e) => setCompType(e.target.value)}
                aria-label="Filter by completion type"
                data-testid="completed-filter-type"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
              >
                <option value="all">All completion types</option>
                {completionTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {filteredCompleted.length} of {completed.length}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={exportCompleted}>
                ⭳ Export CSV
              </Button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table
                className="w-full min-w-[960px] text-left text-xs"
                data-testid="completed-items"
              >
                <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-2">Inventory Code</th>
                    <th className="px-2.5 py-2">Type</th>
                    <th className="px-2.5 py-2 text-right">Grams</th>
                    <th className="px-2.5 py-2">Customer</th>
                    <th className="px-2.5 py-2">Order</th>
                    <th className="px-2.5 py-2">Invoice</th>
                    <th className="px-2.5 py-2">Completion</th>
                    <th className="px-2.5 py-2">Completed</th>
                    <th className="px-2.5 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCompleted.map((c) => {
                    const parsed = parseInventoryCode(c.itemCode);
                    return (
                      <tr key={c.inventoryItemId}>
                        <td className="px-2.5 py-2 font-mono">{c.itemCode}</td>
                        <td className="px-2.5 py-2 text-muted-foreground">
                          {parsed.itemType ?? '—'}
                        </td>
                        <td className="px-2.5 py-2 text-right tabular-nums">
                          {parsed.grams ?? '—'}
                        </td>
                        <td className="px-2.5 py-2">{c.customerName ?? '—'}</td>
                        <td className="px-2.5 py-2 font-mono">{c.orderNumber ?? '—'}</td>
                        <td className="px-2.5 py-2 font-mono">{c.invoiceNumber ?? '—'}</td>
                        <td className="px-2.5 py-2">
                          <span className="font-medium text-gold-strong">
                            {c.completionType}
                          </span>
                        </td>
                        <td className="px-2.5 py-2">
                          {c.completedDate ? c.completedDate.slice(0, 10) : '—'}
                        </td>
                        <td className="px-2.5 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setCompView(c)}
                            data-testid={`completed-view-${c.inventoryItemId}`}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                Historical sold/released inventory — one source of truth, split by status.
                Records are never deleted or copied.
              </p>
            </div>
          </div>
        )
      ) : null}

      {/* Read-only Completed Item detail (§5). */}
      <Modal
        open={compView !== null}
        onClose={() => setCompView(null)}
        title="Completed item"
        description="Read-only historical record. Correcting a completion is a separate controlled action."
        size="md"
      >
        {compView ? (
          <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {(
              [
                ['Inventory Code', compView.itemCode],
                ['Item', compView.itemName ?? '—'],
                ['Condition', parseInventoryCode(compView.itemCode).condition ?? '—'],
                ['Item Type', parseInventoryCode(compView.itemCode).itemType ?? '—'],
                ['Grams', parseInventoryCode(compView.itemCode).grams ?? '—'],
                ['Size', parseInventoryCode(compView.itemCode).size ?? '—'],
                ['Customer', compView.customerName ?? '—'],
                ['Order Number', compView.orderNumber ?? '—'],
                ['Invoice Number', compView.invoiceNumber ?? '—'],
                ['Completion Type', compView.completionType],
                ['Courier', compView.courier ?? '—'],
                ['Tracking Number', compView.trackingNumber ?? '—'],
                ['Completed Date', compView.completedDate?.slice(0, 10) ?? '—'],
                ['Final Holder', compView.currentHolder ?? '—'],
                ['Final Location', compView.currentLocation ?? '—'],
                ['Status', compView.availabilityStatus.replace(/_/g, ' ')],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-border py-1.5">
                <span className="text-muted-foreground">{label}</span>
                <span className="text-right font-medium">{value}</span>
              </div>
            ))}
          </dl>

          {/* Return to Stock Review (§10) — never marks the item available; opens
              an in-review record for inspection + approval. Gated on monitoring. */}
          {canMonitor ? (
            <form action={returnCompletedAction} className="mt-4 space-y-2 border-t border-border pt-3">
              <input
                type="hidden"
                name="inventoryItemId"
                value={compView.inventoryItemId}
              />
              <Label htmlFor="ret-note" className="text-xs">
                Return reason / condition note (optional)
              </Label>
              <Input id="ret-note" name="note" className="h-9" />
              <div className="flex items-center gap-2">
                <Button type="submit" variant="destructive" size="sm" disabled={returningItem}>
                  {returningItem ? 'Sending…' : 'Return to Stock Review'}
                </Button>
                {returnCompState.error ? (
                  <span role="alert" className="text-xs text-destructive">
                    {returnCompState.error}
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-muted-foreground">
                This does NOT make the item available. It goes through Returned-to-Stock
                Review (inspection + authorized approval) first.
              </p>
            </form>
          ) : null}
          </>
        ) : null}
      </Modal>

    </div>
  );
}
