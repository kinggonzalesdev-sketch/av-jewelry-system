'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useRef, useState } from 'react';

import {
  createInventoryItemAction,
  deleteAllInventoryItemsAction,
  returnCompletedItemAction,
  returnCompletedItemToInventoryAction,
} from '@/lib/inventory/actions';
import type { InventoryActionState } from '@/lib/inventory/action-state';
import { EMPTY_INVENTORY_STATE } from '@/lib/inventory/action-state';
import type { InventoryListResult } from '@/lib/inventory/service';
import type { CompletedInventoryRow } from '@/lib/inventory/completed';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { inventoryGroup } from '@/lib/inventory/group';
import { downloadCsv } from '@/lib/export/csv';
import { InventoryImportButton } from '@/components/inventory/inventory-import-modal';
import { InventoryItemActions } from '@/components/inventory/inventory-item-actions';
import { Button } from '@/components/ui/button';
import { ReadError } from '@/components/ui/page-primitives';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';
import { MoneyInput } from '@/components/ui/money-input';
import { Money } from '@/components/shell/privacy';
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

type Tab = 'Active Inventory' | 'Completed Items';

/** Payment-status pill for the Completed Items table. Null → an honest "—". */
const PAYMENT_LABEL: Record<string, { label: string; cls: string }> = {
  paid_in_full: { label: 'Paid in Full', cls: 'text-green-700' },
  partial: { label: 'Partial', cls: 'text-amber-600' },
  unpaid: { label: 'Unpaid', cls: 'text-destructive' },
};
function paymentText(status: string | null): { label: string; cls: string } {
  return status ? (PAYMENT_LABEL[status] ?? { label: status, cls: '' }) : { label: '—', cls: 'text-muted-foreground' };
}

/** Colour for the Current Stage badge: settled, stopped, or still in flight. */
function stageClass(stage: string): string {
  if (stage === 'Completed' || stage === 'Released') {
    return 'border-green-600/40 bg-green-600/10 text-green-700';
  }
  if (stage === 'Cancelled') {
    return 'border-destructive/40 bg-destructive/10 text-destructive';
  }
  if (stage === '—') return 'border-border text-muted-foreground';
  return 'border-gold/40 bg-gold/10 text-gold-strong';
}


/**
 * Statuses that still count as ACTIVE, sellable stock. An item consumed by ANY
 * transaction — Walk-In sale, New Order, layaway, manual entry — leaves Active
 * Inventory immediately and appears under Completed Items instead. An allowlist (not
 * a blocklist) so a newly added status can never silently leak back into Active.
 * One inventory record remains the source of truth; nothing is copied or deleted.
 */
const ACTIVE_INVENTORY_STATUSES = new Set(['available', 'returned_to_available']);

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
  canCreate = false,
  canEdit = false,
  canDelete = false,
  canDeleteAll = false,
  canReturnCompleted = false,
  canImportExport = false,
}: {
  inventory: InventoryListResult;
  completed?: CompletedInventoryRow[];
  canMonitor: boolean;
  /** Holds `post_live_item_entry` — shows the "New Entry" (Add Item) control. When
   *  false the button is hidden (the server also blocks the action). */
  canCreate?: boolean;
  /** Holds `inventory_edit` — shows the per-row Edit action. */
  canEdit?: boolean;
  /** Holds `inventory_delete` — shows the per-row Delete action. */
  canDelete?: boolean;
  /** SUPER ADMIN (owner) only — shows the bulk "Delete All" control. */
  canDeleteAll?: boolean;
  /** SUPER ADMIN (owner) only — per-row "return to inventory" on Completed Items
   *  (mistake fix: removes the order info, keeps the item as available stock). */
  canReturnCompleted?: boolean;
  /** SUPER ADMIN only — Excel/CSV import and export (Owner request). */
  canImportExport?: boolean;
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
  const [invGroup, setInvGroup] = useState('all');
  // Render pagination — only the current page of rows is put in the DOM (thousands of
  // rows would otherwise bloat memory + slow the browser). Filtering/search is
  // unchanged; the page just windows the already-filtered list.
  const [invPage, setInvPage] = useState(1);
  const [invPageSize, setInvPageSize] = useState(25);
  const [compPage, setCompPage] = useState(1);
  const [compPageSize, setCompPageSize] = useState(25);

  const invRows = useMemo(() => (inventory.ok ? inventory.rows : []), [inventory]);
  // Group counts (§16): BN / SB / HK ITEM / Other over the ACTIVE items, so a new or
  // edited item appears under the right group with an updated count on refresh.
  const groupCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of invRows) {
      if (!ACTIVE_INVENTORY_STATUSES.has(r.availabilityStatus)) continue;
      const g = inventoryGroup(r.itemCode, r.itemName);
      m[g] = (m[g] ?? 0) + 1;
    }
    return m;
  }, [invRows]);
  const groupOptions = useMemo(() => Object.keys(groupCounts).sort(), [groupCounts]);
  // Active statuses only in the filter dropdown — completed/released live under
  // the Completed Items tab, never offered as an "available" filter (§4).
  const statusOptions = useMemo(
    () =>
      [
        ...new Set(
          invRows
            .map((r) => r.availabilityStatus)
            .filter((s) => ACTIVE_INVENTORY_STATUSES.has(s)),
        ),
      ].sort(),
    [invRows],
  );
  const filteredInventory = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return invRows.filter((row) => {
      // Active Inventory shows ONLY sellable stock. Anything consumed by a
      // transaction lives under Completed Items instead (§4).
      if (!ACTIVE_INVENTORY_STATUSES.has(row.availabilityStatus)) return false;
      if (invStatus !== 'all' && row.availabilityStatus !== invStatus) return false;
      if (invGroup !== 'all' && inventoryGroup(row.itemCode, row.itemName) !== invGroup) {
        return false;
      }
      if (!q) return true;
      return `${row.itemCode} ${row.itemName ?? ''}`.toLowerCase().includes(q);
    });
  }, [invRows, invSearch, invStatus, invGroup]);

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

  // Window the filtered lists to the current page (clamped so a filter that shrinks the
  // list never strands the user past the last page).
  const invPageCount = Math.max(1, Math.ceil(filteredInventory.length / invPageSize));
  const invPageSafe = Math.min(invPage, invPageCount);
  const pagedInventory = filteredInventory.slice(
    (invPageSafe - 1) * invPageSize,
    invPageSafe * invPageSize,
  );
  const compPageCount = Math.max(1, Math.ceil(filteredCompleted.length / compPageSize));
  const compPageSafe = Math.min(compPage, compPageCount);
  const pagedCompleted = filteredCompleted.slice(
    (compPageSafe - 1) * compPageSize,
    compPageSafe * compPageSize,
  );
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
        { header: 'Sale Amount', value: (c) => c.finalSale ?? '' },
        { header: 'Payment', value: (c) => paymentText(c.paymentStatus).label },
        { header: 'Current Stage', value: (c) => c.currentStage },
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
      {/* Order (Owner request): Active Inventory · New Entry · Upload · Export ·
          Completed Items · Delete All. The destructive action is LAST, pushed right
          and behind a separator so it never sits among the everyday buttons.
          Wraps on small screens without overlapping. */}
      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        <Button
          type="button"
          role="tab"
          aria-selected={tab === 'Active Inventory'}
          size="sm"
          variant={tab === 'Active Inventory' ? 'default' : 'outline'}
          onClick={() => setTab('Active Inventory')}
        >
          Active Inventory
        </Button>

        {canCreate ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowNewEntry(true)}
            data-testid="inventory-new-entry"
          >
            ＋ New Entry
          </Button>
        ) : null}
        {canImportExport ? <InventoryImportButton /> : null}
        {canImportExport && inventory.ok && inventory.rows.length > 0 ? (
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

        <Button
          type="button"
          role="tab"
          aria-selected={tab === 'Completed Items'}
          size="sm"
          variant={tab === 'Completed Items' ? 'default' : 'outline'}
          onClick={() => setTab('Completed Items')}
        >
          Completed Items
        </Button>

        {canDeleteAll && inventory.ok && inventory.rows.length > 0 ? (
          <span className="ml-auto">
            <DeleteAllInventoryButton count={inventory.rows.length} />
          </span>
        ) : null}
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
        ) : (
          <div className="space-y-3">
            {/* Spreadsheet-style search + filters over the loaded items. */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
              <SearchInput
                value={invSearch}
                onChange={(v) => {
                  setInvSearch(v);
                  setInvPage(1);
                }}
                placeholder="Search code or item…"
                aria-label="Search inventory"
                data-testid="inventory-search"
                className="flex-1 min-w-[10rem]"
              />
              <Select
                value={invGroup}
                onChange={(e) => {
                  setInvGroup(e.target.value);
                  setInvPage(1);
                }}
                aria-label="Filter by group"
                data-testid="inventory-filter-group"
                className="w-auto"
              >
                <option value="all">All groups</option>
                {groupOptions.map((g) => (
                  <option key={g} value={g}>
                    {g} ({groupCounts[g]})
                  </option>
                ))}
              </Select>
              <Select
                value={invStatus}
                onChange={(e) => {
                  setInvStatus(e.target.value);
                  setInvPage(1);
                }}
                aria-label="Filter by status"
                data-testid="inventory-filter-status"
                className="w-auto"
              >
                <option value="all">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">
                {filteredInventory.length} of {inventory.rows.length}
              </span>
            </div>

            {/* The table (headers + container) stays fixed even with no rows — the
                empty message sits inside the body so the layout never collapses. */}
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="data-table w-full min-w-[720px] text-left text-xs">
              <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="col-grow px-3 py-2.5 text-left">Unique Code</th>
                  <th className="px-3 py-2.5 text-left">Status</th>
                  <th className="col-num px-3 py-2.5">Grams</th>
                  <th className="col-center px-3 py-2.5">Date Encoded</th>
                  <th className="px-3 py-2.5 text-left">Notes</th>
                  <th className="col-actions px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                      {inventory.rows.length === 0
                        ? 'No inventory items.'
                        : 'No items match these filters.'}
                    </td>
                  </tr>
                ) : (
                  pagedInventory.map((i) => (
                  <tr key={i.inventoryItemId}>
                    <td className="col-grow truncate px-3 py-2.5 font-mono" title={i.itemCode}>
                      {i.itemCode}
                    </td>
                    <td className="px-3 py-2.5 text-left capitalize">
                      {i.availabilityStatus.replace(/_/g, ' ')}
                    </td>
                    <td className="col-num px-3 py-2.5">
                      {i.gramsPerPiece ?? parseInventoryCode(i.itemCode).grams ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center">
                      {fmtEncoded(i.createdAt)}
                    </td>
                    <td className="col-clip truncate px-3 py-2.5 text-muted-foreground">
                      {i.inRtsReview ? 'In RTS review' : ''}
                      {i.isForfeited ? ' · forfeited (excluded from auto-return)' : ''}
                    </td>
                    <td className="col-actions px-3 py-2.5">
                      <InventoryItemActions row={i} canEdit={canEdit} canDelete={canDelete} />
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
            {filteredInventory.length > invPageSize ? (
              <Pagination
                page={invPageSafe}
                pageCount={invPageCount}
                total={filteredInventory.length}
                pageSize={invPageSize}
                onPageChange={setInvPage}
                onPageSizeChange={(n) => {
                  setInvPageSize(n);
                  setInvPage(1);
                }}
                className="px-1"
              />
            ) : null}
          </div>
        )
      ) : null}

      {tab === 'Completed Items' ? (
          <div className="space-y-3">
            {/* Search + completion-type filter + export (§12). */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
              <SearchInput
                value={compSearch}
                onChange={(v) => {
                  setCompSearch(v);
                  setCompPage(1);
                }}
                placeholder="Search code, item, customer, order…"
                aria-label="Search completed items"
                data-testid="completed-search"
                className="flex-1 min-w-[12rem]"
              />
              <Select
                value={compType}
                onChange={(e) => {
                  setCompType(e.target.value);
                  setCompPage(1);
                }}
                aria-label="Filter by completion type"
                data-testid="completed-filter-type"
                className="w-auto"
              >
                <option value="all">All completion types</option>
                {completionTypeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <span className="text-xs text-muted-foreground">
                {filteredCompleted.length} of {completed.length}
              </span>
              <Button type="button" size="sm" variant="outline" onClick={exportCompleted}>
                ⭳ Export CSV
              </Button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table
                className="data-table w-full min-w-[960px] text-left text-xs"
                data-testid="completed-items"
              >
                {/* Content-based sizing: Customer absorbs the slack (col-grow); the many
                    short columns (Type, Grams, Payment, Stage, dates) stay narrow. No
                    fixed equal percentages. */}
                <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 text-left">Inventory Code</th>
                    <th className="col-center px-3 py-2.5">Type</th>
                    <th className="col-num px-3 py-2.5">Grams</th>
                    <th className="col-grow px-3 py-2.5 text-left">Customer</th>
                    <th className="px-3 py-2.5 text-left">Order</th>
                    <th className="px-3 py-2.5 text-left">Invoice</th>
                    <th className="col-num px-3 py-2.5">Sale Amount</th>
                    <th className="col-center px-3 py-2.5">Payment</th>
                    <th className="col-center px-3 py-2.5">Current Stage</th>
                    <th className="col-center px-3 py-2.5">Completion Date</th>
                    <th className="col-actions px-3 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCompleted.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-4 py-10 text-center text-muted-foreground">
                        {completed.length === 0
                          ? 'No completed items yet.'
                          : 'No items match these filters.'}
                      </td>
                    </tr>
                  ) : (
                    pagedCompleted.map((c) => {
                      const parsed = parseInventoryCode(c.itemCode);
                      return (
                        <tr key={c.inventoryItemId}>
                          <td className="truncate px-3 py-2.5 font-mono" title={c.itemCode}>
                            {c.itemCode}
                          </td>
                          <td className="truncate px-3 py-2.5 text-center text-muted-foreground">
                            {parsed.itemType ?? '—'}
                          </td>
                          <td className="col-num px-3 py-2.5">
                            {parsed.grams ?? '—'}
                          </td>
                          <td className="truncate px-3 py-2.5" title={c.customerName ?? undefined}>
                            {c.customerName ?? '—'}
                          </td>
                          <td className="truncate px-3 py-2.5 font-mono">{c.orderNumber ?? '—'}</td>
                          <td className="truncate px-3 py-2.5 font-mono">
                            {c.invoiceNumber ?? '—'}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                            {c.finalSale ? <Money amount={c.finalSale} /> : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            {(() => {
                              const p = paymentText(c.paymentStatus);
                              return (
                                <span className={`whitespace-nowrap font-medium ${p.cls}`}>
                                  {p.label}
                                </span>
                              );
                            })()}
                          </td>
                          {/* Current Stage — derived live from the linked order. */}
                          <td className="px-3 py-2.5 text-center">
                            <span
                              className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${stageClass(
                                c.currentStage,
                              )}`}
                            >
                              {c.currentStage}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-center">
                            {c.completedDate ? c.completedDate.slice(0, 10) : '—'}
                          </td>
                          <td className="col-actions px-3 py-2.5">
                            <div className="inline-flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => setCompView(c)}
                                data-testid={`completed-view-${c.inventoryItemId}`}
                                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                              >
                                View
                              </button>
                              {canReturnCompleted ? (
                                <CompletedItemReturn row={c} />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              {filteredCompleted.length > compPageSize ? (
                <Pagination
                  page={compPageSafe}
                  pageCount={compPageCount}
                  total={filteredCompleted.length}
                  pageSize={compPageSize}
                  onPageChange={setCompPage}
                  onPageSizeChange={(n) => {
                    setCompPageSize(n);
                    setCompPage(1);
                  }}
                  className="px-3 py-2"
                />
              ) : null}
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                Historical sold/released inventory — one source of truth, split by status.
                Records are never deleted or copied.
              </p>
            </div>
          </div>
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
                ['Current Stage', compView.currentStage],
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

/**
 * SUPER ADMIN (Owner) per-row correction on a Completed item — for fixing mistakes.
 * It DELETES the order/customer info but RETURNS the item to Active Inventory as
 * available stock (the item itself is kept). "type DELETE" confirmation. The server
 * action + DB function are the real gate: Owner-only, a linked order is deleted only
 * when it becomes empty (siblings kept), and the action is REFUSED when a linked
 * order has recorded payments or the item is in a layaway — surfaced as an error.
 */
function CompletedItemReturn({ row }: { row: CompletedInventoryRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [state, action, pending] = useActionState<InventoryActionState, FormData>(
    returnCompletedItemToInventoryAction,
    EMPTY_INVENTORY_STATE,
  );
  const lastDone = useRef<string | null>(null);
  useEffect(() => {
    if (state.success && state.success !== lastDone.current) {
      lastDone.current = state.success;
      setOpen(false);
      router.refresh();
    }
  }, [state.success, router]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setConfirm('');
          setOpen(true);
        }}
        data-testid={`completed-delete-${row.inventoryItemId}`}
        className="rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
      >
        Delete
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete order info & return item to inventory"
        description="Super Admin only."
        size="sm"
        critical
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              form={`completed-return-form-${row.inventoryItemId}`}
              disabled={pending || confirm !== 'DELETE'}
            >
              {pending ? 'Working…' : 'Delete info & return'}
            </Button>
          </>
        }
      >
        <form
          id={`completed-return-form-${row.inventoryItemId}`}
          action={action}
          className="space-y-3"
        >
          <input type="hidden" name="inventoryItemId" value={row.inventoryItemId} />
          <p className="text-sm">
            Remove the order/customer info for <span className="font-mono">{row.itemCode}</span>
            {row.customerName ? ` (${row.customerName})` : ''} and return the item to{' '}
            <strong>Active Inventory</strong>? The item itself is <strong>not</strong> deleted —
            it goes back to available stock.
          </p>
          <p className="text-xs text-muted-foreground">
            {row.orderNumber ? (
              <>
                If <span className="font-mono">{row.orderNumber}</span> has no other items,
                the whole order is removed too; otherwise only this item’s line is removed.{' '}
              </>
            ) : null}
            An order with recorded payment(s), or an item in a layaway account, is{' '}
            <strong>protected</strong> — resolve it first.
          </p>
          <div>
            <Label htmlFor={`comp-del-${row.inventoryItemId}`} className="text-xs">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </Label>
            <Input
              id={`comp-del-${row.inventoryItemId}`}
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              placeholder="DELETE"
              className="mt-1 h-9"
            />
          </div>
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
        </form>
      </Modal>
    </>
  );
}

/**
 * Owner/Admin bulk permanent delete of Active Inventory. Irreversible "type DELETE"
 * confirmation; the DB skips any item linked to a business record (order/claim) and
 * reports how many were deleted vs skipped. The server action + DB function gate it.
 */
function DeleteAllInventoryButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ deleted: number; skipped: number } | null>(null);

  const run = async () => {
    if (pending || confirm !== 'DELETE') return;
    setPending(true);
    setError(null);
    const res = await deleteAllInventoryItemsAction(confirm);
    if (!res.ok) {
      setPending(false);
      setError(res.error);
      return;
    }
    setPending(false);
    setDone({ deleted: res.deleted, skipped: res.skipped });
    router.refresh();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => {
          setConfirm('');
          setError(null);
          setDone(null);
          setOpen(true);
        }}
        data-testid="inventory-delete-all"
      >
        🗑 Delete All
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Permanently delete all Active Inventory"
        description="This cannot be undone."
        size="sm"
        critical
        footer={
          done ? (
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => void run()}
                disabled={pending || confirm !== 'DELETE'}
              >
                {pending ? 'Deleting…' : 'Delete all permanently'}
              </Button>
            </>
          )
        }
      >
        {done ? (
          <div className="space-y-2" data-testid="inventory-delete-all-done">
            <p className="text-sm">
              Deleted <strong>{done.deleted}</strong> item(s).
            </p>
            {done.skipped > 0 ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700">
                Skipped <strong>{done.skipped}</strong> item(s) linked to an order or other
                record — those are kept safe and cannot be bulk-deleted.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Permanently delete the <strong>{count}</strong> Active Inventory item(s)?
              Items linked to an order or other business record are automatically{' '}
              <strong>skipped</strong>. This removes only unlinked stock and cannot be
              undone.
            </p>
            <div>
              <Label htmlFor="inv-delete-all-confirm" className="text-xs">
                Type <span className="font-mono font-semibold">DELETE</span> to confirm
              </Label>
              <Input
                id="inv-delete-all-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                placeholder="DELETE"
                className="mt-1 h-9"
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </Modal>
    </>
  );
}
