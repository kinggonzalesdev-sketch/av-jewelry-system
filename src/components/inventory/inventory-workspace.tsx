'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createInventoryItemAction,
  deleteAllInventoryItemsAction,
  loadCompletedInventoryPageAction,
  loadInventoryActivePageAction,
  loadInventoryForExportAction,
  loadInventoryGramsTotalsAction,
  returnCompletedItemAction,
  returnCompletedItemToInventoryAction,
} from '@/lib/inventory/actions';
import type { InventoryActionState } from '@/lib/inventory/action-state';
import { EMPTY_INVENTORY_STATE } from '@/lib/inventory/action-state';
import type { InventoryPageResult, InventoryRow } from '@/lib/inventory/service';
import type { InventoryGramsTotals } from '@/lib/inventory/grams-totals';
import { formatGrams } from '@/lib/inventory/grams-format';
import type { CompletedInventoryRow } from '@/lib/inventory/completed';
import { parseInventoryCode } from '@/lib/inventory/code-parser';
import { inventoryGroup } from '@/lib/inventory/group';
import { downloadCsv } from '@/lib/export/csv';
import { InventoryImportButton } from '@/components/inventory/inventory-import-modal';
import { InventoryItemActions } from '@/components/inventory/inventory-item-actions';
import { Button } from '@/components/ui/button';
import { ReadError, StatusBadge, type BadgeTone } from '@/components/ui/page-primitives';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Select } from '@/components/ui/select';
import { Pagination } from '@/components/ui/pagination';
import { MoneyInput } from '@/components/ui/money-input';
import { Money } from '@/components/shell/privacy';
import { Label } from '@/components/ui/label';
import { Modal, ModalFieldFull, ModalFormGrid } from '@/components/ui/modal';
import { Card, CardContent } from '@/components/ui/card';

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

/** Availability status → unified tone (Active Inventory table). Same colour
 *  language as Orders: green = sellable stock, blue = returned to the pool. */
function availabilityTone(status: string): BadgeTone {
  if (status === 'available') return 'success'; // green
  if (status === 'returned_to_available') return 'info'; // blue — back in stock
  return 'neutral';
}

/** Payment-status pill for the Completed Items table (label + unified tone). */
const PAYMENT_META: Record<string, { label: string; tone: BadgeTone }> = {
  paid_in_full: { label: 'Paid in Full', tone: 'success' }, // green
  partial: { label: 'Partial', tone: 'warning' }, // amber
  unpaid: { label: 'Unpaid', tone: 'danger' }, // red
};
function paymentMeta(status: string | null): { label: string; tone: BadgeTone } {
  if (!status) return { label: '—', tone: 'neutral' };
  return PAYMENT_META[status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' };
}

/** Current Stage → unified tone: settled (green), stopped (red), or in flight (blue). */
function stageTone(stage: string): BadgeTone {
  if (stage === 'Completed' || stage === 'Released') return 'success'; // green
  if (stage === 'Cancelled') return 'danger'; // red
  if (stage === '—') return 'neutral';
  return 'info'; // blue — still processing
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
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Today as YYYY-MM-DD, for the New Entry date default. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}


export function InventoryWorkspace({
  initialPage,
  initialGramsTotals,
  canMonitor,
  canCreate = false,
  canEdit = false,
  canDelete = false,
  isOwner = false,
  canDeleteAll = false,
  canForceDelete = false,
  canReturnCompleted = false,
  canImportExport = false,
}: {
  initialPage: InventoryPageResult;
  /** Total Grams cards (Super Admin + Admin only). `undefined` hides them entirely (Staff);
   *  an object shows the values; `null` means the read failed (the cards show "—"). */
  initialGramsTotals?: InventoryGramsTotals | null | undefined;
  canMonitor: boolean;
  /** Super Admin (owner) — per-row Edit/Delete execute directly; an Admin only requests. */
  isOwner?: boolean;
  /** Holds `post_live_item_entry` — shows the "New Entry" (Add Item) control. When
   *  false the button is hidden (the server also blocks the action). */
  canCreate?: boolean;
  /** Owner OR Admin — shows the per-row Edit action (role-based: the Owner edits
   *  directly; an Admin's Edit becomes an approval request). */
  canEdit?: boolean;
  /** Owner OR Admin — shows the per-row Delete action (role-based: the Owner deletes
   *  directly; an Admin's Delete becomes an approval request). Supersedes the old
   *  per-user `inventory_delete` grant model (incl. Cynthia). */
  canDelete?: boolean;
  /** SUPER ADMIN (owner) only — shows the bulk "Delete All" control. */
  canDeleteAll?: boolean;
  /** SUPER ADMIN (owner) only — enables the per-row "Force delete" override for an
   *  item blocked by resolved records (the DB still protects real/active links). */
  canForceDelete?: boolean;
  /** SUPER ADMIN (owner) only — per-row "return to inventory" on Completed Items
   *  (mistake fix: removes the order info, keeps the item as available stock). */
  canReturnCompleted?: boolean;
  /** SUPER ADMIN only — Excel/CSV import and export (Owner request). */
  canImportExport?: boolean;
}) {
  const router = useRouter();
  // Bumped after a create/edit/delete so the client-fetched Active page RE-FETCHES. The
  // list is loaded via a server action (below), so router.refresh() — which only re-runs
  // the RSC — would otherwise leave a just-deleted row on screen until a full reload.
  const [reloadToken, setReloadToken] = useState(0);
  const reloadActive = useCallback(() => setReloadToken((t) => t + 1), []);

  // ── Total Grams summary cards (Super Admin + Admin) ────────────────────────────────
  // GLOBAL, database-backed totals. `undefined` prop = Staff → hide the cards entirely.
  // Two update paths, NO new polling / realtime:
  //   1) prop re-sync — every inventory mutation revalidates /orders/inventory, re-running
  //      the server page with fresh totals (covers CSV import + Completed↔Active returns,
  //      which refresh via the RSC, not the reload token).
  //   2) reloadToken  — New Entry / Edit / Delete also bump the client reload token; refetch
  //      the totals via the same server action the table uses, so they update instantly.
  const canViewTotals = initialGramsTotals !== undefined;
  const [gramsTotals, setGramsTotals] = useState<InventoryGramsTotals | null>(
    initialGramsTotals ?? null,
  );
  // Adopt a fresher SERVER total when the RSC re-renders with new props — CSV import and
  // Completed↔Active returns refresh via router.refresh/revalidate, not the reload token.
  // React's "adjust state when a prop changes" pattern, done in RENDER (guarded by a seed
  // signature so it runs once per change and never loops) — not an effect, so no lag frame.
  const seedActiveGrams = initialGramsTotals?.activeGrams ?? null;
  const seedCompletedGrams = initialGramsTotals?.completedGrams ?? null;
  const seedSig = canViewTotals ? `${seedActiveGrams}|${seedCompletedGrams}` : 'off';
  const [lastSeedSig, setLastSeedSig] = useState(seedSig);
  if (seedSig !== lastSeedSig) {
    setLastSeedSig(seedSig);
    // Skip a failed read (both null) so a transient error never blanks a good total.
    if (canViewTotals && (seedActiveGrams !== null || seedCompletedGrams !== null)) {
      setGramsTotals({
        activeGrams: seedActiveGrams ?? 0,
        completedGrams: seedCompletedGrams ?? 0,
      });
    }
  }
  const firstTotals = useRef(true);
  useEffect(() => {
    if (!canViewTotals) return;
    if (firstTotals.current) {
      // The server-seeded totals are already fresh on first render — no wasted round-trip.
      firstTotals.current = false;
      return;
    }
    let alive = true;
    void loadInventoryGramsTotalsAction().then((res) => {
      if (alive && res) setGramsTotals(res);
    });
    return () => {
      alive = false;
    };
  }, [reloadToken, canViewTotals]);

  const [tab, setTab] = useState<Tab>('Active Inventory');
  // Completed Items is SERVER-PAGINATED (Owner request — the view must scale past 1,000 with
  // an EXACT total, never a "999 of 999" cap). It stays off the initial load so Inventory
  // opens fast; opening the tab arms the fetch effect below, which loads ONE page + the exact
  // server counts and refetches on every search / completion-type / page change.
  type CompletedPage = {
    rows: CompletedInventoryRow[];
    total: number;
    searchTotal: number;
    typeCounts: Record<string, number>;
  };
  const [completed, setCompleted] = useState<CompletedPage>({
    rows: [],
    total: 0,
    searchTotal: 0,
    typeCounts: {},
  });
  const [completedActive, setCompletedActive] = useState(false);
  const [completedLoaded, setCompletedLoaded] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const openCompletedTab = () => {
    setTab('Completed Items');
    setCompletedActive(true);
  };
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
      reloadActive();
    }
  }, [createState.success, reloadActive]);

  // --- Active Inventory: search + status/group filter + pagination — SERVER-SIDE now.
  // The current page's rows + total + group counts + status options come from ONE SQL RPC
  // so the browser never loads all 2,000+ rows. The list SEEDS from the server-rendered
  // page 1 (initialPage), then refetches on any search/filter/page change.
  const [invSearch, setInvSearch] = useState('');
  const [invStatus, setInvStatus] = useState('all');
  const [invGroup, setInvGroup] = useState('all');
  const [invPage, setInvPage] = useState(1);
  const [invPageSize, setInvPageSize] = useState(25);
  const [compPage, setCompPage] = useState(1);
  const [compPageSize, setCompPageSize] = useState(25);

  type ActivePage = {
    rows: InventoryRow[];
    total: number;
    groupCounts: Record<string, number>;
    statusOptions: string[];
  };
  const [active, setActive] = useState<ActivePage>(
    initialPage.ok
      ? {
          rows: initialPage.rows,
          total: initialPage.total,
          groupCounts: initialPage.groupCounts,
          statusOptions: initialPage.statusOptions,
        }
      : { rows: [], total: 0, groupCounts: {}, statusOptions: [] },
  );
  const [activeLoading, setActiveLoading] = useState(false);
  const activeError = initialPage.ok ? null : initialPage.reason;

  // Debounce the search box so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(invSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [invSearch]);

  // Refetch the page whenever the query changes. Skips the FIRST run while the state still
  // matches the server-rendered page 1 (no wasted round-trip on load).
  const firstFetch = useRef(true);
  useEffect(() => {
    if (firstFetch.current) {
      firstFetch.current = false;
      if (
        debouncedSearch === '' &&
        invStatus === 'all' &&
        invGroup === 'all' &&
        invPage === 1 &&
        invPageSize === 25
      ) {
        return;
      }
    }
    let alive = true;
    setActiveLoading(true);
    void loadInventoryActivePageAction({
      search: debouncedSearch,
      status: invStatus,
      group: invGroup,
      page: invPage,
      size: invPageSize,
    })
      .then((res) => {
        if (!alive || !res.ok) return;
        setActive({
          rows: res.rows,
          total: res.total,
          groupCounts: res.groupCounts,
          statusOptions: res.statusOptions,
        });
      })
      .finally(() => {
        if (alive) setActiveLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debouncedSearch, invStatus, invGroup, invPage, invPageSize, reloadToken]);

  const groupCounts = active.groupCounts;
  const groupOptions = useMemo(() => Object.keys(groupCounts).sort(), [groupCounts]);
  const statusOptions = active.statusOptions;

  // Completed Items — SERVER-PAGINATED (§5, §12). The rows, the EXACT total, and the
  // per-completion-type counts all come from the server; the browser only ever holds the
  // current page. Debounce the search so typing doesn't fire a request per keystroke.
  const [debouncedCompSearch, setDebouncedCompSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCompSearch(compSearch.trim()), 300);
    return () => clearTimeout(t);
  }, [compSearch]);
  useEffect(() => {
    if (!completedActive) return;
    let alive = true;
    // The loading flag + fetch live in an async callback (not the effect body) so a page
    // load never sets state synchronously during render.
    void (async () => {
      setCompletedLoading(true);
      try {
        const res = await loadCompletedInventoryPageAction({
          search: debouncedCompSearch,
          type: compType,
          page: compPage,
          size: compPageSize,
        });
        if (alive && res.ok) {
          setCompleted({
            rows: res.rows,
            total: res.total,
            searchTotal: res.searchTotal,
            typeCounts: res.typeCounts,
          });
          setCompletedLoaded(true);
        }
      } finally {
        if (alive) setCompletedLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [completedActive, debouncedCompSearch, compType, compPage, compPageSize]);

  // Completion-type dropdown options come from the EXACT server counts (every type for the
  // current search) — so switching filters shows real totals, not loaded-row guesses.
  const completionTypeOptions = useMemo(
    () => Object.keys(completed.typeCounts).sort(),
    [completed.typeCounts],
  );

  // Window the filtered lists to the current page (clamped so a filter that shrinks the
  // list never strands the user past the last page).
  const invPageCount = Math.max(1, Math.ceil(active.total / invPageSize));
  const invPageSafe = Math.min(invPage, invPageCount);
  // The server already returned exactly this page's rows (ordered by item_code).
  const pagedInventory = active.rows;
  // The server returns exactly this page's rows (ordered by item_code); `completed.total` is
  // the EXACT count of matching records, so pagination scales to any size (never 999/1000).
  const compPageCount = Math.max(1, Math.ceil(completed.total / compPageSize));
  const compPageSafe = Math.min(compPage, compPageCount);
  const pagedCompleted = completed.rows;
  // Export = ALL records matching the ACTIVE filter, built SERVER-SIDE in chunks and streamed
  // as a file — the browser never loads 10k–50k rows to build the CSV. Respects search + type.
  const exportCompleted = () => {
    const params = new URLSearchParams();
    if (debouncedCompSearch) params.set('search', debouncedCompSearch);
    if (compType !== 'all') params.set('type', compType);
    const qs = params.toString();
    window.location.href = `/api/inventory/completed/export${qs ? `?${qs}` : ''}`;
  };

  // Export the CURRENTLY FILTERED inventory (respects search + filters) with the
  // parsed columns (§18/D). Never exports mock data — these are the real rows.
  const exportInventory = async () => {
    const res = await loadInventoryForExportAction();
    if (!res.ok) return;
    const q = invSearch.trim().toLowerCase();
    // Export = ALL filtered rows (not just the visible page): apply the SAME active +
    // search + status + group filter the server uses, over the full list fetched on demand.
    const filtered = res.rows.filter((row) => {
      if (!ACTIVE_INVENTORY_STATUSES.has(row.availabilityStatus)) return false;
      if (invStatus !== 'all' && row.availabilityStatus !== invStatus) return false;
      if (invGroup !== 'all' && inventoryGroup(row.itemCode, row.itemName) !== invGroup) {
        return false;
      }
      if (!q) return true;
      return `${row.itemCode} ${row.itemName ?? ''}`.toLowerCase().includes(q);
    });
    downloadCsv(
      `inventory-${new Date().toISOString().slice(0, 10)}`,
      [
        { header: 'Inventory Code', value: (i) => i.itemCode },
        { header: 'Item', value: (i) => i.itemName ?? '' },
        {
          header: 'Condition',
          value: (i) => parseInventoryCode(i.itemCode).condition ?? '',
        },
        {
          header: 'Item Type',
          value: (i) => parseInventoryCode(i.itemCode).itemType ?? '',
        },
        { header: 'Grams', value: (i) => parseInventoryCode(i.itemCode).grams ?? '' },
        { header: 'Size', value: (i) => parseInventoryCode(i.itemCode).size ?? '' },
        { header: 'Status', value: (i) => i.availabilityStatus.replace(/_/g, ' ') },
        { header: 'Total', value: (i) => i.quantityTotal },
        { header: 'Available', value: (i) => i.availableQuantity },
        { header: 'Reserved', value: (i) => i.reservedQuantity },
        { header: 'Custody Holder', value: (i) => i.custodyHolder ?? '' },
        { header: 'Storage Location', value: (i) => i.storageLocation ?? '' },
      ],
      filtered,
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
        {canImportExport && !activeError && active.total > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void exportInventory()}
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
          onClick={openCompletedTab}
        >
          Completed Items
        </Button>

        {canDeleteAll && !activeError && active.total > 0 ? (
          <span className="ml-auto">
            <DeleteAllInventoryButton count={active.total} />
          </span>
        ) : null}
      </div>

      {/* Total Grams summary cards (Super Admin + Admin only) — GLOBAL, database-backed
          totals of the grams shown in each tab's Grams column. Independent of the current
          search / filter / page. Below the action buttons, above the search + filters.
          Side-by-side on desktop, stacked on mobile. */}
      {canViewTotals ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="inventory-grams-cards">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg"
                style={{ backgroundColor: '#16A34A22', color: '#16A34A' }}
                aria-hidden
              >
                ⚖️
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Active Inventory Total Grams
                </p>
                <p
                  className="truncate text-xl font-bold tabular-nums"
                  style={{ color: '#16A34A' }}
                  data-testid="active-total-grams"
                >
                  {formatGrams(gramsTotals?.activeGrams)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg"
                style={{ backgroundColor: '#D4AF6722', color: '#D4AF67' }}
                aria-hidden
              >
                ⚖️
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Completed Items Total Grams
                </p>
                <p
                  className="truncate text-xl font-bold tabular-nums"
                  style={{ color: '#D4AF67' }}
                  data-testid="completed-total-grams"
                >
                  {formatGrams(gramsTotals?.completedGrams)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

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
            Item Code is required and must be unique. Date Encoded defaults to today and
            can be changed.
          </p>
          {createState.error ? (
            <p role="alert" className="text-sm text-destructive">
              {createState.error}
            </p>
          ) : null}
        </form>
      </Modal>

      {tab === 'Active Inventory' ? (
        activeError ? (
          // A FAILED read, not an empty result — say so, never a false "no items".
          <ReadError title="Inventory could not be loaded" detail={activeError} />
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
                {activeLoading
                  ? 'Loading…'
                  : `${active.total} item${active.total === 1 ? '' : 's'}`}
              </span>
            </div>

            {/* The table (headers + container) stays fixed even with no rows — the
                empty message sits inside the body so the layout never collapses. */}
            <div className="table-scroll rounded-xl border border-border bg-card">
              <table className="data-table w-full min-w-[720px] text-left text-xs">
                {/* Intentional column widths (Owner spec). HINTS, not table-fixed — a
                  column can still grow to fit a long code, nothing is clipped. */}
                <colgroup>
                  <col style={{ width: '20%' }} /> {/* Unique Code */}
                  <col style={{ width: '15%' }} /> {/* Status */}
                  <col style={{ width: '15%' }} /> {/* Grams */}
                  <col style={{ width: '15%' }} /> {/* Date Encoded */}
                  <col style={{ width: '20%' }} /> {/* Notes */}
                  <col style={{ width: '15%' }} /> {/* Actions */}
                </colgroup>
                <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 text-center">Unique Code</th>
                    <th className="px-3 py-2.5 text-left">Status</th>
                    <th className="col-num px-3 py-2.5">Grams</th>
                    <th className="col-center px-3 py-2.5">Date Encoded</th>
                    <th className="px-3 py-2.5 text-left">Notes</th>
                    <th className="col-actions px-3 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {active.total === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        {invSearch.trim() === '' &&
                        invStatus === 'all' &&
                        invGroup === 'all'
                          ? 'No inventory items.'
                          : 'No items match these filters.'}
                      </td>
                    </tr>
                  ) : (
                    pagedInventory.map((i) => (
                      <tr key={i.inventoryItemId}>
                        <td
                          className="truncate px-3 py-2.5 text-center font-mono"
                          title={i.itemCode}
                        >
                          {i.itemCode}
                        </td>
                        <td className="px-3 py-2.5 text-left">
                          <StatusBadge
                            label={i.availabilityStatus.replace(/_/g, ' ')}
                            tone={availabilityTone(i.availabilityStatus)}
                            className="capitalize"
                          />
                        </td>
                        <td className="col-num px-3 py-2.5">
                          {i.gramsPerPiece ?? parseInventoryCode(i.itemCode).grams ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-center">
                          {fmtEncoded(i.createdAt)}
                        </td>
                        <td className="col-clip truncate px-3 py-2.5 text-muted-foreground">
                          {i.inRtsReview ? 'In RTS review' : ''}
                          {i.isForfeited
                            ? ' · forfeited (excluded from auto-return)'
                            : ''}
                        </td>
                        <td className="col-actions px-3 py-2.5">
                          <InventoryItemActions
                            row={i}
                            canEdit={canEdit}
                            canDelete={canDelete}
                            isOwner={isOwner}
                            canForceDelete={canForceDelete}
                            onMutated={reloadActive}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {active.total > invPageSize ? (
              <Pagination
                page={invPageSafe}
                pageCount={invPageCount}
                total={active.total}
                pageSize={invPageSize}
                onPageChange={setInvPage}
                onPageSizeChange={(n) => {
                  setInvPageSize(n);
                  setInvPage(1);
                }}
                sticky
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
              <option value="all">
                All completion types ({completed.searchTotal.toLocaleString()})
              </option>
              {completionTypeOptions.map((t) => (
                <option key={t} value={t}>
                  {t} ({(completed.typeCounts[t] ?? 0).toLocaleString()})
                </option>
              ))}
            </Select>
            <span className="text-xs text-muted-foreground" data-testid="completed-count">
              {completedLoading
                ? 'Loading…'
                : completed.total === 0
                  ? '0 of 0'
                  : `${((compPageSafe - 1) * compPageSize + 1).toLocaleString()}–${Math.min(
                      compPageSafe * compPageSize,
                      completed.total,
                    ).toLocaleString()} of ${completed.total.toLocaleString()}`}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={exportCompleted}>
              ⭳ Export CSV
            </Button>
          </div>

          <div className="table-scroll rounded-xl border border-border bg-card">
            <table
              className="data-table table-fixed w-full min-w-[960px] text-left text-xs"
              data-testid="completed-items"
            >
              {/* FIXED percentage column widths (Owner request) — sums to 100%. The order
                  MUST match the 9 columns below; long cells (Inventory Code, Customer)
                  truncate within their width. */}
              <colgroup>
                {['15%', '10%', '10%', '15%', '10%', '10%', '10%', '10%', '10%'].map((w, i) => (
                  <col key={i} style={{ width: w }} />
                ))}
              </colgroup>
              <thead className="border-b bg-muted/50 text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-center">Inventory Code</th>
                  <th className="col-center px-3 py-2.5">Type</th>
                  <th className="col-num px-3 py-2.5">Grams</th>
                  <th className="px-3 py-2.5 text-left">Customer</th>
                  <th className="col-num px-3 py-2.5">Sale Amount</th>
                  <th className="col-center px-3 py-2.5">Payment</th>
                  <th className="col-center px-3 py-2.5">Current Stage</th>
                  <th className="col-center px-3 py-2.5">Completion Date</th>
                  <th className="col-actions px-3 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pagedCompleted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-10 text-center text-muted-foreground"
                    >
                      {completedLoading || !completedLoaded
                        ? 'Loading completed items…'
                        : debouncedCompSearch || compType !== 'all'
                          ? 'No items match these filters.'
                          : 'No completed items yet.'}
                    </td>
                  </tr>
                ) : (
                  pagedCompleted.map((c) => {
                    const parsed = parseInventoryCode(c.itemCode);
                    return (
                      <tr key={c.inventoryItemId}>
                        <td
                          className="truncate px-3 py-2.5 text-center font-mono"
                          title={c.itemCode}
                        >
                          {c.itemCode}
                        </td>
                        <td className="truncate px-3 py-2.5 text-center text-muted-foreground">
                          {parsed.itemType ?? '—'}
                        </td>
                        <td className="col-num px-3 py-2.5">{parsed.grams ?? '—'}</td>
                        <td
                          className="truncate px-3 py-2.5"
                          title={c.customerName ?? undefined}
                        >
                          {c.customerName ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                          {c.finalSale ? <Money amount={c.finalSale} /> : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {c.paymentStatus ? (
                            (() => {
                              const p = paymentMeta(c.paymentStatus);
                              return <StatusBadge label={p.label} tone={p.tone} />;
                            })()
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        {/* Current Stage — derived live from the linked order. */}
                        <td className="px-3 py-2.5 text-center">
                          {c.currentStage === '—' ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <StatusBadge
                              label={c.currentStage}
                              tone={stageTone(c.currentStage)}
                            />
                          )}
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
                            {canReturnCompleted ? <CompletedItemReturn row={c} /> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {completed.total > compPageSize ? (
              <Pagination
                page={compPageSafe}
                pageCount={compPageCount}
                total={completed.total}
                pageSize={compPageSize}
                onPageChange={setCompPage}
                onPageSizeChange={(n) => {
                  setCompPageSize(n);
                  setCompPage(1);
                }}
                sticky
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
                <div
                  key={label}
                  className="flex justify-between gap-3 border-b border-border py-1.5"
                >
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right font-medium">{value}</span>
                </div>
              ))}
            </dl>

            {/* Return to Stock Review (§10) — never marks the item available; opens
              an in-review record for inspection + approval. Gated on monitoring. */}
            {canMonitor ? (
              <form
                action={returnCompletedAction}
                className="mt-4 space-y-2 border-t border-border pt-3"
              >
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
                  <Button
                    type="submit"
                    variant="destructive"
                    size="sm"
                    disabled={returningItem}
                  >
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
            Remove the order/customer info for{' '}
            <span className="font-mono">{row.itemCode}</span>
            {row.customerName ? ` (${row.customerName})` : ''} and return the item to{' '}
            <strong>Active Inventory</strong>? The item itself is <strong>not</strong>{' '}
            deleted — it goes back to available stock.
          </p>
          <p className="text-xs text-muted-foreground">
            {row.orderNumber ? (
              <>
                If <span className="font-mono">{row.orderNumber}</span> has no other
                items, the whole order is removed too; otherwise only this item’s line is
                removed.{' '}
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
                Skipped <strong>{done.skipped}</strong> item(s) linked to an order or
                other record — those are kept safe and cannot be bulk-deleted.
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
