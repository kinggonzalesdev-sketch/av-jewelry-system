import { parseInventoryCode } from '@/lib/inventory/code-parser';

/**
 * CANONICAL INVENTORY SEARCH ALLOWLIST (Owner 2026-09-13).
 *
 * Inventory search must be VISIBLE AND EXPLAINABLE: if a row appears for a term, that term must sit
 * inside a business field the user can inspect on that row. The server enforces this in SQL
 * (supabase/migrations/20260913120000_inventory_search_visible_fields_only.sql); this module is the
 * readable statement of the same rule plus a diagnostic that names the field that matched — used by
 * the tests to stop a hidden field from ever creeping back into search.
 *
 * WHY IT EXISTS: a Completed Items search for "1124" returned SBA-E-6486 and SBA-E-6490 because the
 * query also matched the order's retired Order Number (ORD-2026-001124), which the user can never see.
 *
 * Keep this list and the SQL predicate in lock-step. Adding a field here without adding it to the SQL
 * (or vice versa) is exactly the drift the tests are there to catch.
 */

/** A searchable field: the label the user sees, and how to read its value off a row. */
export type SearchField<Row> = {
  /** The label shown in the UI — what we would tell the user "this matched on". */
  label: string;
  value: (row: Row) => string | null | undefined;
};

/** The subset of a Completed Items row that search is allowed to look at. */
export type CompletedSearchRow = {
  itemCode: string;
  itemName: string | null;
  availabilityStatus: string;
  customerName: string | null;
  courier: string | null;
  trackingNumber: string | null;
  completionType: string;
  currentStage: string;
  currentHolder: string | null;
  currentLocation: string | null;
};

/** The subset of an Active Inventory row that search is allowed to look at. */
export type ActiveSearchRow = {
  itemCode: string;
  itemName: string | null;
  availabilityStatus: string;
  custodyHolder: string | null;
  storageLocation: string | null;
};

/**
 * The condition + item-type labels derived from a code, exactly as the UI displays them
 * ("Subasta Earrings"). Mirrors app_private.inventory_code_labels in SQL — the word "Earrings" is not
 * in "SBA-E-6486 0.83g"; the parser produces it for display, so search has to derive it too.
 */
export function inventoryCodeLabels(code: string): string {
  const parsed = parseInventoryCode(code);
  return [parsed.condition, parsed.itemType].filter((v): v is string => !!v).join(' ');
}

/** Status exactly as rendered: `sold_released` -> `sold released`. */
function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

/** Shared core — the item's own visible fields, identical for Active and Completed. */
function coreFields<Row extends { itemCode: string; itemName: string | null; availabilityStatus: string }>(): SearchField<Row>[] {
  return [
    // Also carries the visible Grams, Size and raw condition/type codes: the UI parses them out of it.
    { label: 'Inventory Code', value: (r) => r.itemCode },
    { label: 'Item', value: (r) => r.itemName },
    { label: 'Condition / Item Type', value: (r) => inventoryCodeLabels(r.itemCode) },
    { label: 'Status', value: (r) => statusLabel(r.availabilityStatus) },
  ];
}

export const COMPLETED_SEARCH_FIELDS: SearchField<CompletedSearchRow>[] = [
  ...coreFields<CompletedSearchRow>(),
  { label: 'Customer', value: (r) => r.customerName },
  { label: 'Courier', value: (r) => r.courier },
  { label: 'Tracking Number', value: (r) => r.trackingNumber },
  { label: 'Completion Type', value: (r) => r.completionType },
  { label: 'Current Stage', value: (r) => r.currentStage },
  { label: 'Final Holder', value: (r) => r.currentHolder },
  { label: 'Final Location', value: (r) => r.currentLocation },
];

export const ACTIVE_SEARCH_FIELDS: SearchField<ActiveSearchRow>[] = [
  ...coreFields<ActiveSearchRow>(),
  {
    label: 'Custody Holder',
    value: (r) => (r.custodyHolder === 'financer' ? 'Financer' : 'A.V. Jewelry'),
  },
  { label: 'Storage Location', value: (r) => r.storageLocation },
];

/**
 * Identifiers that must NEVER be searchable, whatever the surface. Retired from the UI, or internal.
 * The tests assert none of these appears in either allowlist.
 */
export const NEVER_SEARCHED = [
  'orderNumber',
  'invoiceNumber',
  'inventoryItemId',
  'id',
  'officialOrderId',
  'customerId',
  'paymentId',
] as const;

/**
 * Diagnostic: which visible field made this row match `query`? Returns the field label, or null when
 * nothing visible matches — meaning the row must NOT be in the results. Case-insensitive substring,
 * the same semantics as the SQL `ilike '%q%'`.
 *
 *   explainMatch(COMPLETED_SEARCH_FIELDS, row, 'Santos')  -> 'Customer'
 *   explainMatch(COMPLETED_SEARCH_FIELDS, row, '1124')    -> null   (it was only in the order number)
 *
 * Development/test aid only; not exposed in the production UI.
 */
export function explainMatch<Row>(
  fields: readonly SearchField<Row>[],
  row: Row,
  query: string,
): string | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 'All (empty search)';
  for (const f of fields) {
    const v = f.value(row);
    if (v && v.toLowerCase().includes(q)) return f.label;
  }
  return null;
}
